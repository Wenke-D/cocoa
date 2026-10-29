import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Engine } from '../../../../src/main/engine/engine'
import { build_world } from '../../../../src/main/engine/world'
import { engine, settle } from '../../../support/engine'
import { failure, throws } from '../../../support/failure'
import { exists, is_file, read_text, write, write_script } from '../../../support/files'
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

// §8.3: every member's report, then the campaign's, in one asking.
describe('regenerating a campaign’s members first', () => {
  interface Sweep {
    dir: string
    jobs: [string, string]
    campaign: string
    cocoa: Engine
    run_id: number
    /** Each report script appends a line here as it runs, so order shows. */
    log: string
  }

  /** A campaign over two jobs, settled `SUCCEEDED` with every report landed. */
  async function sweep(): Promise<Sweep> {
    const dir = temp_dir()
    const jobs: [string, string] = [job_folder(dir, 'job-a'), job_folder(dir, 'job-b')]
    const campaign = campaign_folder(dir, 'nightly', ['job-a', 'job-b'])
    const cocoa = engine(dir)
    jobs.forEach((job) => cocoa.register(job))
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    jobs.forEach((job) => write(job, 'poll-state', 'COMPLETED'))
    await cocoa.refresh()
    await cocoa.refresh()
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('SUCCEEDED')
    return { dir, jobs, campaign, cocoa, run_id: start.run_id, log: path.join(dir, 'log') }
  }

  /** Rewrites every report script to write `v2` and log that it ran. */
  function rewrite_scripts(s: Sweep): void {
    for (const job of s.jobs) {
      write_script(
        job,
        'report.sh',
        `mkdir -p report\necho "v2 $2" > "report/$2.txt"\n` +
          `echo "${path.basename(job)} $2" >> "${s.log}"\n`
      )
    }
    write_script(
      s.campaign,
      'report.sh',
      `mkdir -p report\necho "campaign v2 $2" > "report/$2.txt"\necho "campaign $2" >> "${s.log}"\n`
    )
  }

  function log_lines(s: Sweep): string[] {
    return fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8').trim().split('\n') : []
  }

  it('re-runs every member’s report, then the campaign’s, keeping its end', async () => {
    const s = await sweep()
    rewrite_scripts(s)
    const ended = s.cocoa.campaign(s.campaign).runs.record(s.run_id).report?.at

    s.cocoa.request_members_report(s.campaign, s.run_id)
    for (const job of s.jobs) {
      expect(s.cocoa.job(job).runs.record(0).status).toBe('ANALYZING')
    }
    const waiting = build_world(s.cocoa, null).campaign_runs[s.campaign][String(s.run_id)]
    expect(waiting.status).toBe('Analyzing')
    expect(waiting.report).toBe('Generating')
    expect(waiting.members_regenerating).toEqual({ done: 0, total: 2 })
    expect(waiting.report_rerunnable).toBe(false)
    expect(waiting.members_rerunnable).toBe(false)
    expect(throws(() => s.cocoa.request_members_report(s.campaign, s.run_id))).toBe(
      `the report of campaign run ${s.run_id} is already running`
    )
    expect(throws(() => s.cocoa.request_report(s.campaign, s.run_id))).toBe(
      `the report of campaign run ${s.run_id} is already running`
    )
    expect(throws(() => s.cocoa.set_report_lock(s.campaign, s.run_id, true))).toContain(
      'is being generated'
    )

    const tick = await s.cocoa.refresh()
    expect(tick.report_errors).toEqual([])
    expect(log_lines(s)).toEqual(['job-a 0', 'job-b 0', `campaign ${s.run_id}`])
    for (const job of s.jobs) {
      expect(read_text(job, 'report', '0.txt').trim()).toBe('v2 0')
    }
    expect(read_text(s.campaign, 'report', `${s.run_id}.txt`).trim()).toBe(
      `campaign v2 ${s.run_id}`
    )
    expect(s.cocoa.campaign_status(s.campaign, s.run_id).status).toBe('SUCCEEDED')
    expect(s.cocoa.campaign(s.campaign).runs.record(s.run_id).report).toEqual({
      attempted: true,
      at: ended
    })
    const done = build_world(s.cocoa, null).campaign_runs[s.campaign][String(s.run_id)]
    expect(done.members_regenerating).toBeNull()
    expect(done.members_rerunnable).toBe(true)
  })

  it('refuses the whole asking for any locked report, touching no member', async () => {
    const s = await sweep()
    s.cocoa.set_report_lock(s.jobs[1], 0, true)
    expect(throws(() => s.cocoa.request_members_report(s.campaign, s.run_id))).toBe(
      'the report of member `job-b` run 0 is locked; unlock it to regenerate it'
    )
    s.cocoa.set_report_lock(s.jobs[1], 0, false)
    s.cocoa.set_report_lock(s.campaign, s.run_id, true)
    expect(throws(() => s.cocoa.request_members_report(s.campaign, s.run_id))).toBe(
      `the report of campaign run ${s.run_id} is locked; unlock it to regenerate it`
    )
    for (const job of s.jobs) {
      expect(s.cocoa.job(job).runs.record(0).status).toBe('SUCCEEDED')
    }
    expect(s.cocoa.awaiting_members.all()).toEqual([])
  })

  it('stops at a member report that fails, leaving the campaign’s as it was', async () => {
    const s = await sweep()
    rewrite_scripts(s)
    write_script(s.jobs[1], 'report.sh', 'echo "member broke" >&2\nexit 1\n')
    const before = s.cocoa.campaign(s.campaign).runs.record(s.run_id).report

    s.cocoa.request_members_report(s.campaign, s.run_id)
    const tick = await s.cocoa.refresh()
    const messages = tick.report_errors.map((error) => error.message)
    expect(messages).toContain(
      `the report of campaign run ${s.run_id} was not regenerated: member \`job-b\` run 0 ended ERROR`
    )
    expect(log_lines(s)).toEqual(['job-a 0'])
    expect(read_text(s.jobs[0], 'report', '0.txt').trim()).toBe('v2 0')
    expect(read_text(s.campaign, 'report', `${s.run_id}.txt`).trim()).toBe(
      `campaign report ${s.run_id}`
    )
    expect(s.cocoa.campaign(s.campaign).runs.record(s.run_id).report).toEqual(before)
    expect(s.cocoa.campaign_status(s.campaign, s.run_id).status).toBe('ERROR')
    expect(s.cocoa.awaiting_members.all()).toEqual([])
  })

  it('gives a campaign its report once a member’s failed report is fixed', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'job-a')
    const campaign = campaign_folder(dir, 'nightly', ['job-a'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)

    expect(throws(() => cocoa.request_members_report(campaign, start.run_id))).toBe(
      "cannot regenerate the members' reports: member `job-a` run 0 (STARTING) is not finished"
    )

    write(job, 'report-state', 'fail')
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    await cocoa.refresh()
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('ERROR')
    expect(cocoa.campaign(campaign).runs.record(start.run_id).report).toBeUndefined()
    expect(throws(() => cocoa.request_report(campaign, start.run_id))).toContain(
      'no campaign report'
    )
    const world = build_world(cocoa, null).campaign_runs[campaign][String(start.run_id)]
    expect(world.report_rerunnable).toBe(false)
    expect(world.members_rerunnable).toBe(true)

    fs.rmSync(path.join(job, 'report-state'))
    cocoa.request_members_report(campaign, start.run_id)
    await cocoa.refresh()
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('SUCCEEDED')
    expect(is_file(campaign, 'report', `${start.run_id}.txt`)).toBe(true)
  })

  it('refuses a campaign whose member failed on the cluster', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'job-a')
    const campaign = campaign_folder(dir, 'nightly', ['job-a'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'FAILED no convergence')
    await cocoa.refresh()
    await cocoa.refresh()

    expect(throws(() => cocoa.request_members_report(campaign, start.run_id))).toBe(
      "cannot regenerate the members' reports: member `job-a` run 0 ended FAILED"
    )
    expect(cocoa.job(job).runs.record(0).status).toBe('FAILED')
  })
})
