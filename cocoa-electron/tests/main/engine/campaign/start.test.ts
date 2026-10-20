import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { write } from '../../../support/files'
import { campaign_folder, job_folder, plan_lines } from '../../../support/fixtures'
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
