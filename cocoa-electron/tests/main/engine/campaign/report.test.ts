import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../../support/engine'
import { failure, throws } from '../../../support/failure'
import { exists, is_file, write } from '../../../support/files'
import { campaign_folder, job_folder } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('campaigns', () => {
  it('refuses a campaign report unless every member succeeded', async () => {
    const dir = temp_dir()
    const good = job_folder(dir, 'ok-job')
    const campaign = campaign_folder(dir, 'nightly', ['ok-job'])
    const cocoa = engine(dir)
    cocoa.register(good)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)

    write(good, 'poll-state', 'FAILED no convergence')
    await cocoa.poll_job(good)
    const status = cocoa.campaign_status(campaign, start.run_id)
    expect(status.status).toBe('FAILED')
    expect(status.failed).toBe(1)

    expect(await failure(cocoa.campaign_report(campaign, start.run_id))).toContain(
      'no campaign report'
    )
    expect(exists(campaign, 'report', `${start.run_id}.txt`)).toBe(false)
  })

  it('reports when every member succeeded', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'sweep-job')
    const campaign = campaign_folder(dir, 'nightly', ['sweep-job'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)

    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('STARTING')

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, start.members[0].run_id, 'auto')
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('ANALYZING')

    await cocoa.campaign_report(campaign, start.run_id)
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('SUCCEEDED')
    expect(is_file(campaign, 'runs', String(start.run_id), 'members.json')).toBe(true)
    expect(is_file(campaign, 'report', `${start.run_id}.txt`)).toBe(true)
  })

  // §8.3: due again, run by the tick, and the campaign's end left where it was.
  it('regenerates a report by hand, keeping the campaign’s end', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'sweep-job')
    const campaign = campaign_folder(dir, 'nightly', ['sweep-job'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)

    expect(throws(() => cocoa.request_report(campaign, start.run_id))).toContain(
      'no campaign report'
    )

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    await cocoa.refresh()
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('SUCCEEDED')
    const ended = cocoa.campaign(campaign).runs.record(start.run_id).report?.at

    cocoa.request_report(campaign, start.run_id)
    expect(cocoa.campaign(campaign).runs.record(start.run_id).report).toEqual({
      attempted: false,
      at: ended
    })
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('ANALYZING')
    expect(throws(() => cocoa.request_report(campaign, start.run_id))).toBe(
      `the report of campaign run ${start.run_id} is already running`
    )

    await cocoa.refresh()
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('SUCCEEDED')
    expect(cocoa.campaign(campaign).runs.record(start.run_id).report).toEqual({
      attempted: true,
      at: ended
    })
  })
})
