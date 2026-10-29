import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Engine } from '../../../../src/main/engine/engine'
import { build_world } from '../../../../src/main/engine/world'
import type { CampaignMembersFile } from '../../../../src/main/engine/record'
import { engine, settle } from '../../../support/engine'
import { failure, throws } from '../../../support/failure'
import { exists, read_text, write } from '../../../support/files'
import { campaign_folder, job_folder } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

// §8.5: a call that did not succeed, run again in its place.
describe('running a campaign call again', () => {
  interface Sweep {
    good: string
    bad: string
    campaign: string
    cocoa: Engine
    run_id: number
  }

  /** A campaign over two jobs whose second call failed on the cluster. */
  async function failed_sweep(): Promise<Sweep> {
    const dir = temp_dir()
    const good = job_folder(dir, 'job-a')
    const bad = job_folder(dir, 'job-b')
    const campaign = campaign_folder(dir, 'nightly', ['job-a', 'job-b'])
    const cocoa = engine(dir)
    cocoa.register(good)
    cocoa.register(bad)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(good, 'poll-state', 'COMPLETED')
    write(bad, 'poll-state', 'FAILED diverged')
    await cocoa.refresh()
    await cocoa.refresh()
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('FAILED')
    return { good, bad, campaign, cocoa, run_id: start.run_id }
  }

  it('takes the call’s place, keeps the failed run, and lets the campaign report', async () => {
    const s = await failed_sweep()
    write(s.bad, 'poll-state', 'RUNNING')

    const new_id = await s.cocoa.replace_member(
      s.campaign,
      s.run_id,
      0,
      s.bad,
      { size: '512' },
      { gpu: '1' }
    )
    await settle(s.cocoa)
    expect(new_id).toBe(1)
    expect(s.cocoa.campaign(s.campaign).runs.record(s.run_id).members).toEqual([
      { run_id: 0, job: 'job-a' },
      { run_id: 1, job: 'job-b', attempts: [0] }
    ])
    const fresh = s.cocoa.job(s.bad).runs.record(1)
    expect(fresh.origin).toEqual({ by: 'campaign', run_id: s.run_id, name: 'nightly', call: 2 })
    expect(fresh.render).toEqual({ size: '512' })
    expect(s.cocoa.job(s.bad).runs.record(0).status).toBe('FAILED')
    expect(s.cocoa.campaign_status(s.campaign, s.run_id).status).not.toBe('FAILED')

    const step = build_world(s.cocoa, null).campaign_runs[s.campaign][String(s.run_id)].plan
      .steps[1]
    expect(step).toMatchObject({ run_id: '1', attempts: ['0'] })

    write(s.bad, 'poll-state', 'COMPLETED')
    await s.cocoa.refresh()
    await s.cocoa.refresh()
    expect(s.cocoa.campaign_status(s.campaign, s.run_id).status).toBe('SUCCEEDED')
    const members = JSON.parse(
      read_text(s.campaign, 'runs', String(s.run_id), 'members.json')
    ) as CampaignMembersFile
    expect(members.members.map((member) => [member.job, member.run_id])).toEqual([
      ['job-a', 0],
      ['job-b', 1]
    ])
  })

  it('refuses a call that succeeded, one still running, and an earlier attempt', async () => {
    const s = await failed_sweep()
    expect(await failure(s.cocoa.replace_member(s.campaign, s.run_id, 0, s.good, {}, {}))).toBe(
      'run 0 of `job-a` succeeded; only a call that did not succeed is run again'
    )

    write(s.bad, 'poll-state', 'RUNNING')
    await s.cocoa.replace_member(s.campaign, s.run_id, 0, s.bad, { size: '1' }, { gpu: '0' })
    await settle(s.cocoa)
    await s.cocoa.refresh()
    expect(await failure(s.cocoa.replace_member(s.campaign, s.run_id, 1, s.bad, {}, {}))).toBe(
      'run 1 of `job-b` (RUNNING) is not finished'
    )
    expect(await failure(s.cocoa.replace_member(s.campaign, s.run_id, 0, s.bad, {}, {}))).toBe(
      `run 0 of \`job-b\` is an earlier attempt in campaign run ${s.run_id}; only the call's current run is run again`
    )
  })

  // Run ids are per job: run 0 of job-a succeeded, run 0 of job-b failed.
  it('tells members apart by job, refuses a non-member and a locked report', async () => {
    const s = await failed_sweep()
    expect(await failure(s.cocoa.replace_member(s.campaign, s.run_id, 5, s.bad, {}, {}))).toBe(
      `run 5 of \`job-b\` is not a member of campaign run ${s.run_id}`
    )

    const record = s.cocoa.campaign(s.campaign).runs.record(s.run_id)
    record.report_locked = true
    expect(
      await failure(
        s.cocoa.replace_member(s.campaign, s.run_id, 0, s.bad, { size: '1' }, { gpu: '0' })
      )
    ).toBe(`the report of campaign run ${s.run_id} is locked; unlock it to run a call again`)
  })

  it('leaves the campaign as it was when the start itself is refused', async () => {
    const s = await failed_sweep()
    const before = structuredClone(s.cocoa.campaign(s.campaign).runs.record(s.run_id))
    expect(
      await failure(s.cocoa.replace_member(s.campaign, s.run_id, 0, s.bad, { size: '1' }, {}))
    ).toContain('gpu')
    expect(s.cocoa.campaign(s.campaign).runs.record(s.run_id)).toEqual(before)
    expect(s.cocoa.replacing.size).toBe(0)
  })

  it('owes a new campaign report when the old one had been attempted', async () => {
    const s = await failed_sweep()
    s.cocoa.campaign(s.campaign).runs.record(s.run_id).report = {
      attempted: true,
      at: '2026-10-29T10:00:00.000+01:00'
    }
    await s.cocoa.replace_member(s.campaign, s.run_id, 0, s.bad, { size: '1' }, { gpu: '0' })
    expect(s.cocoa.campaign(s.campaign).runs.record(s.run_id).report).toEqual({
      attempted: false
    })
  })

  it('is deleted with the campaign run, earlier attempts included', async () => {
    const s = await failed_sweep()
    await s.cocoa.replace_member(s.campaign, s.run_id, 0, s.bad, { size: '1' }, { gpu: '0' })
    await settle(s.cocoa)
    await s.cocoa.refresh()
    expect(s.cocoa.job(s.bad).runs.record(1).status).toBe('FAILED')

    s.cocoa.set_report_lock(s.bad, 0, true)
    expect(throws(() => s.cocoa.delete_campaign_run(s.campaign, s.run_id))).toBe(
      'the report of member run 0 of `job-b` is locked; unlock it to delete the campaign run'
    )
    s.cocoa.set_report_lock(s.bad, 0, false)

    s.cocoa.delete_campaign_run(s.campaign, s.run_id)
    expect(s.cocoa.job(s.bad).runs.find(0)).toBeNull()
    expect(s.cocoa.job(s.bad).runs.find(1)).toBeNull()
    expect(exists(s.bad, 'runs', '0')).toBe(false)
    expect(fs.existsSync(path.join(s.bad, 'runs', '1'))).toBe(false)
  })
})
