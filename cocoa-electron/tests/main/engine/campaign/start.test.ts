import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { read_text, write, write_script } from '../../../support/files'
import { campaign_folder, deploys, job_folder, plan_lines } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('campaigns', () => {
  it('records members and launch failures across a fan-out', async () => {
    const dir = temp_dir()
    const good = job_folder(dir, 'good-job')
    const bad = job_folder(dir, 'bad-job')
    // A dispatch failure is a member that never spawned (§8.2). A script that
    // spawns and then fails is a member in ERROR, covered elsewhere.
    fs.rmSync(path.join(bad, 'launch.sh'))
    const campaign = campaign_folder(dir, 'sweep', ['good-job', 'bad-job'])

    const cocoa = engine(dir)
    cocoa.register(good)
    cocoa.register(bad)
    cocoa.register(campaign)

    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    expect(start.members).toHaveLength(1)
    expect(start.launch_failures).toHaveLength(1)
    expect(start.launch_failures[0].job).toBe('bad-job')

    // A dispatched run records which campaign run and which call dispatched it.
    const member = cocoa.job(good).runs.record(start.members[0].run_id)
    expect(member.origin).toEqual({
      by: 'campaign',
      run_id: start.run_id,
      name: 'sweep',
      call: 1
    })

    // The campaign never became what the plan asked for: ERROR, eventually.
    write(good, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(good)
    await cocoa.report_run(good, start.members[0].run_id, 'auto')
    const status = cocoa.campaign_status(campaign, start.run_id)
    expect(status.status).toBe('ERROR')
    expect(status.succeeded).toBe(1)
  })

  it('dispatches nothing when the plan is invalid', async () => {
    const dir = temp_dir()
    const campaign = campaign_folder(dir, 'broken-plan', [])
    plan_lines(campaign, ['{"job": "ghost", "params": {}}'])
    const cocoa = engine(dir)
    cocoa.register(campaign)

    const message = await failure(cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human'))
    expect(message).toContain('not a registered job')
    expect(cocoa.campaign(campaign).runs.all()).toEqual([])
  })
})

describe('a campaign start', () => {
  it('checks each job once and deploys a stale one once for all its members', async () => {
    const dir = temp_dir()
    const solver = job_folder(dir, 'solver')
    const other = job_folder(dir, 'other')
    const campaign = campaign_folder(dir, 'sweep', ['solver', 'other', 'solver'])
    const cocoa = engine(dir)
    for (const folder of [solver, other, campaign]) {
      cocoa.register(folder)
    }
    write(solver, 'check-state', 'STALE')
    write(solver, 'deploy-hold', '')
    write_script(other, 'check.sh', 'echo ran >> check-ran\necho "COCOA_RETURN: CURRENT"\n')

    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    expect(start.launch_failures).toEqual([])
    // Plan order is kept, whichever job was dispatched first.
    expect(start.members.map((member) => member.job)).toEqual(['solver', 'other', 'solver'])
    const [a, b, c] = start.members
    expect(cocoa.job(solver).runs.record(a.run_id).status).toBe('DEPLOYING')
    expect(cocoa.job(solver).runs.record(c.run_id).status).toBe('DEPLOYING')
    expect(cocoa.job(other).runs.record(b.run_id).deploy).toEqual({ check: 'CURRENT' })
    expect(read_text(other, 'check-ran').trim().split('\n')).toHaveLength(1)

    fs.rmSync(path.join(solver, 'deploy-hold'))
    expect(await settle(cocoa)).toEqual([])
    expect(deploys(solver)).toBe(1)
    for (const member of [a, c]) {
      const record = cocoa.job(solver).runs.record(member.run_id)
      expect(record.submission_id).toBe(`sub-${member.run_id}`)
      expect(record.origin).toMatchObject({ by: 'campaign', run_id: start.run_id })
    }
  })

  it('reads STARTING while its members wait on a deploy', async () => {
    const dir = temp_dir()
    const solver = job_folder(dir, 'solver')
    const campaign = campaign_folder(dir, 'sweep', ['solver', 'solver'])
    const cocoa = engine(dir)
    cocoa.register(solver)
    cocoa.register(campaign)
    write(solver, 'check-state', 'STALE')
    write(solver, 'deploy-hold', '')

    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('STARTING')

    // A cancel cannot pass over members that will launch later in silence.
    const cancels = await cocoa.cancel_campaign(campaign, start.run_id)
    expect(cancels.map((cancel) => cancel.ok)).toEqual([false, false])

    fs.rmSync(path.join(solver, 'deploy-hold'))
    await settle(cocoa)
  })

  it('refuses the whole campaign when any job’s check refuses, naming every one', async () => {
    const dir = temp_dir()
    const solver = job_folder(dir, 'solver')
    const other = job_folder(dir, 'other')
    const third = job_folder(dir, 'third')
    const campaign = campaign_folder(dir, 'sweep', ['solver', 'other', 'third'])
    const cocoa = engine(dir)
    for (const folder of [solver, other, third, campaign]) {
      cocoa.register(folder)
    }
    write(solver, 'check-state', 'CONFLICT run 4 is reading the binary')
    write(other, 'check-state', 'STALE')
    write_script(third, 'check.sh', 'exit 2\n')

    const message = await failure(cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human'))
    expect(message).toContain('the campaign cannot start, nothing was dispatched')
    expect(message).toContain('job `solver`: `solver` cannot start now')
    expect(message).toContain('run 4 is reading the binary')
    expect(message).toContain('job `third`: `./check.sh` exited 2')
    expect(message).not.toContain('`other`')

    for (const folder of [solver, other, third]) {
      expect(cocoa.job(folder).runs.all()).toEqual([])
    }
    expect(cocoa.campaign(campaign).runs.all()).toEqual([])
    expect(deploys(other)).toBe(0)

    // The refusal let every gate go: each job starts again at once.
    write(solver, 'check-state', 'CURRENT')
    await cocoa.start_job(solver, { size: '1' }, { gpu: '0' }, 'human')
    await cocoa.start_job(other, { size: '1' }, { gpu: '0' }, 'human')
    expect(await settle(cocoa)).toEqual([])
  })
})
