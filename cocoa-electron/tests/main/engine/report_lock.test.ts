import { afterEach, describe, expect, it } from 'vitest'
import type { Engine } from '../../../src/main/engine/engine'
import { engine, settle } from '../../support/engine'
import { throws } from '../../support/failure'
import { write } from '../../support/files'
import { campaign_folder, job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

/** A job with one run that has reported, and the engine that ran it. */
async function reported_run(): Promise<[Engine, string, number]> {
  const dir = temp_dir()
  const job = job_folder(dir, 'solver')
  const cocoa = engine(dir)
  cocoa.register(job)
  const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
  await settle(cocoa)
  write(job, 'poll-state', 'COMPLETED')
  await cocoa.refresh()
  expect(cocoa.job(job).runs.record(run_id).status).toBe('SUCCEEDED')
  return [cocoa, job, run_id]
}

// §7.3.3: a locked report is the one to keep — not regenerated, its run not
// deleted — until it is unlocked.
describe('a job run’s report lock', () => {
  it('refuses a regenerate and a delete while locked, and allows both once unlocked', async () => {
    const [cocoa, job, run_id] = await reported_run()

    cocoa.set_report_lock(job, run_id, true)
    expect(cocoa.job(job).runs.record(run_id).report_locked).toBe(true)
    expect(throws(() => cocoa.request_report(job, run_id))).toBe(
      `the report of run ${run_id} is locked; unlock it to regenerate it`
    )
    expect(throws(() => cocoa.delete_run(job, run_id))).toBe(
      `the report of run ${run_id} is locked; unlock it to delete the run`
    )

    cocoa.set_report_lock(job, run_id, false)
    expect(cocoa.job(job).runs.record(run_id).report_locked).toBeUndefined()
    cocoa.request_report(job, run_id)
    expect(cocoa.job(job).runs.record(run_id).status).toBe('ANALYZING')
  })

  it('needs a report to lock, and one that is not being written', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    expect(throws(() => cocoa.set_report_lock(job, run_id, true))).toBe(
      `run ${run_id} has no report to lock`
    )

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    cocoa.request_report(job, run_id)
    expect(throws(() => cocoa.set_report_lock(job, run_id, true))).toBe(
      `the report of run ${run_id} is being generated; lock it once it lands`
    )
  })

  it('takes a lock or an unlock that changes nothing as already done', async () => {
    const [cocoa, job, run_id] = await reported_run()
    cocoa.set_report_lock(job, run_id, false)
    cocoa.set_report_lock(job, run_id, true)
    cocoa.set_report_lock(job, run_id, true)
    expect(cocoa.job(job).runs.record(run_id).report_locked).toBe(true)
  })
})

describe('a campaign run’s report lock', () => {
  /** A campaign whose one member succeeded and whose own report landed. */
  async function reported_campaign(): Promise<[Engine, string, string, number, number]> {
    const dir = temp_dir()
    const job = job_folder(dir, 'sweep-job')
    const campaign = campaign_folder(dir, 'nightly', ['sweep-job'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    await cocoa.refresh()
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('SUCCEEDED')
    return [cocoa, job, campaign, start.run_id, start.members[0].run_id]
  }

  it('keeps the campaign’s report from a regenerate and the campaign run from a delete', async () => {
    const [cocoa, , campaign, run_id] = await reported_campaign()

    cocoa.set_report_lock(campaign, run_id, true)
    expect(throws(() => cocoa.request_report(campaign, run_id))).toBe(
      `the report of campaign run ${run_id} is locked; unlock it to regenerate it`
    )
    expect(throws(() => cocoa.delete_campaign_run(campaign, run_id))).toBe(
      `the report of campaign run ${run_id} is locked; unlock it to delete the campaign run`
    )
  })

  // Deleting a campaign run takes its members with it (§12.1).
  it('keeps the whole fan-out while a member’s report is locked', async () => {
    const [cocoa, job, campaign, run_id, member] = await reported_campaign()

    cocoa.set_report_lock(job, member, true)
    expect(throws(() => cocoa.delete_campaign_run(campaign, run_id))).toBe(
      `the report of member run ${member} of \`sweep-job\` is locked; ` +
        `unlock it to delete the campaign run`
    )

    cocoa.set_report_lock(job, member, false)
    cocoa.delete_campaign_run(campaign, run_id)
    expect(cocoa.campaign(campaign).runs.find(run_id)).toBeNull()
  })
})
