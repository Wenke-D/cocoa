import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../../../src/main/engine/config'
import type { Engine } from '../../../../src/main/engine/engine'
import { build_world } from '../../../../src/main/engine/world'
import type { RunRecord } from '../../../../src/main/engine/record'
import { engine, settle } from '../../../support/engine'
import { failure, throws } from '../../../support/failure'
import { exists, hand_edit, is_file, read_text, write, write_script } from '../../../support/files'
import { campaign_folder, job_folder } from '../../../support/fixtures'
import { record_path } from '../../../support/run_paths'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('reports', () => {
  it('heals a failed auto report when asked again by hand', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'flaky-report')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)

    write(job, 'report-state', 'fail')
    expect(await failure(cocoa.report_run(job, run_id, 'auto'))).toContain('exploded')
    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('exploded')

    fs.rmSync(path.join(job, 'report-state'))
    await cocoa.report_run(job, run_id, 'manual')
    expect(cocoa.job(job).runs.record(run_id).status).toBe('SUCCEEDED')
    expect(is_file(job, 'report', `${run_id}.txt`)).toBe(true)
  })
})

/**
 * Swaps in a report script that writes what it was told — `COCOA_RUN_STATUS`
 * and its argv — as the report, so a test can read both back.
 */
function telling_report(job: string): void {
  write_script(job, 'report.sh', 'mkdir -p report\necho "$COCOA_RUN_STATUS $*" > "report/$2.txt"\n')
}

// A FAILED run is reported beside its status, never on it (§7.3.1): the
// cluster's verdict stands, and the report has its own state.
describe('failed runs', () => {
  it('reports a failed run and leaves it FAILED', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'cfd-solver')
    telling_report(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write(job, 'poll-state', 'FAILED mesh stage diverged')
    await cocoa.poll_job(job)
    // The report is owed with the verdict, in the same write.
    expect(cocoa.job(job).runs.record(run_id).report).toEqual({ attempted: false })
    const on_disk = JSON.parse(read_text(record_path(job, run_id))) as RunRecord
    expect(on_disk.report).toEqual({ attempted: false })

    const tick = await cocoa.refresh()
    expect(tick.reports_run).toBe(1)
    expect(tick.report_errors).toEqual([])

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.reason).toBe('mesh stage diverged')
    expect(record.history.map((change) => change.status)).toEqual(['STARTING', 'FAILED'])
    expect(record.report?.attempted).toBe(true)
    expect(record.report?.at).toBeDefined()
    expect(record.report?.error).toBeUndefined()
    // The arguments a completed run's report gets; the outcome in the env.
    expect(read_text(job, 'report', `${run_id}.txt`)).toBe(
      `FAILED --run ${run_id} --submission sub-${run_id}\n`
    )

    // Terminal: no more polls, and no second report.
    write(job, 'poll-state', 'COMPLETED')
    const again = await cocoa.refresh()
    expect(again.reports_run).toBe(0)
    expect((await cocoa.poll_job(job)).polled).toBe(0)
    expect(cocoa.job(job).runs.record(run_id).status).toBe('FAILED')
  })

  it("tells a completed run's report COMPLETED", async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'healthy')
    telling_report(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('SUCCEEDED')
    expect(record.report).toBeUndefined()
    expect(read_text(job, 'report', `${run_id}.txt`)).toMatch(/^COMPLETED --run /)
  })

  it('records a failed report and keeps the run FAILED, not ERROR', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'broken-report')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write(job, 'report-state', 'fail')
    write(job, 'poll-state', 'FAILED node fell over')
    const tick = await cocoa.refresh()
    expect(tick.report_errors.map((error) => error.message).join()).toContain('exploded')

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.error).toBeUndefined()
    expect(record.report?.attempted).toBe(true)
    expect(record.report?.error).toContain('exploded')

    // Attempted is attempted: the next tick does not try again.
    expect((await cocoa.refresh()).reports_run).toBe(0)
  })

  it('takes a timed-out report the same way', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'slow-report')
    write_script(job, 'report.sh', 'sleep 5\n')
    const cocoa = engine(dir, { ...DEFAULT_CONFIG, report_timeout: 200 })
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write(job, 'poll-state', 'FAILED')
    await cocoa.poll_job(job)
    expect(await failure(cocoa.report_run(job, run_id, 'auto'))).toContain('timed out')
    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.report?.attempted).toBe(true)
  })

  it("re-runs a failed run's report by hand, overwriting it, status untouched", async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'rerun')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write(job, 'report-state', 'fail')
    write(job, 'poll-state', 'FAILED')
    await cocoa.refresh()
    expect(cocoa.job(job).runs.record(run_id).report?.error).toContain('exploded')

    fs.rmSync(path.join(job, 'report-state'))
    await cocoa.report_run(job, run_id, 'manual')
    let record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.report?.error).toBeUndefined()
    expect(read_text(job, 'report', `${run_id}.txt`)).toBe(`report for run ${run_id}\n`)

    telling_report(job)
    await cocoa.report_run(job, run_id, 'manual')
    record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.history.map((change) => change.status)).toEqual(['STARTING', 'FAILED'])
    expect(read_text(job, 'report', `${run_id}.txt`)).toMatch(/^FAILED --run /)

    // A failing re-run records its error, and still moves nothing.
    write_script(job, 'report.sh', 'echo "still broken" >&2\nexit 3\n')
    expect(await failure(cocoa.report_run(job, run_id, 'manual'))).toContain('still broken')
    record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.report?.error).toContain('still broken')
  })

  it('does not report a run that was FAILED before the rule, until asked', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'old-failure')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    // A record as an earlier cocoa wrote it: FAILED, and no report owed.
    const old = { ...cocoa.job(job).runs.record(run_id) }
    old.history = [...old.history, { status: 'FAILED' as const, at: old.history[0].at }]
    old.status = 'FAILED'
    hand_edit(record_path(job, run_id), JSON.stringify(old, null, 2))

    const reopened = engine(dir)
    expect((await reopened.refresh()).reports_run).toBe(0)
    expect(exists(job, 'report', `${run_id}.txt`)).toBe(false)
    expect(await failure(reopened.report_run(job, run_id, 'auto'))).toContain('cannot be reported')

    await reopened.report_run(job, run_id, 'manual')
    const record = reopened.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.report?.attempted).toBe(true)
    expect(is_file(job, 'report', `${run_id}.txt`)).toBe(true)
  })

  it('takes up an owed report after a close, as it does ANALYZING', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'closed-mid-report')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'FAILED')
    await cocoa.poll_job(job)

    const reopened = engine(dir)
    expect((await reopened.refresh()).reports_run).toBe(1)
    expect(reopened.job(job).runs.record(run_id).report?.attempted).toBe(true)
    expect(is_file(job, 'report', `${run_id}.txt`)).toBe(true)
  })

  it('refuses to delete a failed run until its report lands', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'owed')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'FAILED')
    await cocoa.poll_job(job)

    expect(throws(() => cocoa.delete_run(job, run_id))).toContain('report is still running')
    await cocoa.refresh()
    cocoa.delete_run(job, run_id)
    expect(exists(job, 'runs', String(run_id))).toBe(false)
    expect(exists(job, 'report', `${run_id}.txt`)).toBe(false)
  })

  it('gives a CANCELLED run no report, automatic or by hand', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'stopped')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write(job, 'poll-state', 'CANCELLED')
    const tick = await cocoa.refresh()
    expect(tick.reports_run).toBe(0)
    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('CANCELLED')
    expect(record.report).toBeUndefined()
    expect(await failure(cocoa.report_run(job, run_id, 'manual'))).toContain('cannot be reported')
    expect(exists(job, 'report', `${run_id}.txt`)).toBe(false)
  })

  // Only the member's own report is new: the campaign still settles FAILED,
  // with no campaign report (§8.3, §9.1).
  it("reports a campaign's failed member, and the campaign still settles without one", async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const campaign = campaign_folder(dir, 'nightly', ['member-job'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    const member = start.members[0].run_id

    write(job, 'poll-state', 'FAILED no convergence')
    await cocoa.refresh()
    await cocoa.refresh()

    const member_record = cocoa.job(job).runs.record(member)
    expect(member_record.status).toBe('FAILED')
    expect(member_record.report?.attempted).toBe(true)
    expect(is_file(job, 'report', `${member}.txt`)).toBe(true)

    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('FAILED')
    expect(cocoa.campaign(campaign).runs.record(start.run_id).report).toBeUndefined()
    expect(exists(campaign, 'report', `${start.run_id}.txt`)).toBe(false)
    expect(await failure(cocoa.campaign_report(campaign, start.run_id))).toContain(
      'no campaign report'
    )
  })
})

// A re-run by hand marks the report due, as poll does, and the refresh tick
// runs it: one path for the outcome, and never two scripts at once (§7.3.2).
describe('re-running a report by hand', () => {
  async function at(status: string, name: string): Promise<[string, Engine, number]> {
    const dir = temp_dir()
    const job = job_folder(dir, name)
    telling_report(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', status)
    await cocoa.refresh()
    return [job, cocoa, run_id]
  }

  it('re-runs a succeeded run through ANALYZING, overwriting its report', async () => {
    const [job, cocoa, run_id] = await at('COMPLETED', 'rerun-ok')
    write_script(job, 'report.sh', 'mkdir -p report\necho "second" > "report/$2.txt"\n')

    cocoa.request_report(job, run_id)
    let record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('ANALYZING')
    let run = build_world(cocoa, null).job_runs[job][String(run_id)]
    expect(run).toMatchObject({ report: 'Generating', report_rerunnable: false })
    expect(throws(() => cocoa.request_report(job, run_id))).toContain('already running')

    expect((await cocoa.refresh()).reports_run).toBe(1)
    record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('SUCCEEDED')
    expect(read_text(job, 'report', `${run_id}.txt`)).toBe('second\n')
    run = build_world(cocoa, null).job_runs[job][String(run_id)]
    expect(run.report_rerunnable).toBe(true)
    // The run ended when it first succeeded; a re-run does not move that.
    const first = record.history.find((change) => change.status === 'SUCCEEDED')
    expect(record.history.filter((change) => change.status === 'SUCCEEDED')).toHaveLength(2)
    expect(run.ended_at).toBe(first?.at)
  })

  it('takes a failed re-run as the automatic path does: ERROR, healable again', async () => {
    const [job, cocoa, run_id] = await at('COMPLETED', 'rerun-breaks')
    write_script(job, 'report.sh', 'echo "new script broke" >&2\nexit 1\n')

    cocoa.request_report(job, run_id)
    const tick = await cocoa.refresh()
    expect(tick.report_errors.map((error) => error.message).join()).toContain('new script broke')
    let record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('new script broke')

    telling_report(job)
    cocoa.request_report(job, run_id)
    expect(cocoa.job(job).runs.record(run_id).error).toBeUndefined()
    await cocoa.refresh()
    record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('SUCCEEDED')
    expect(read_text(job, 'report', `${run_id}.txt`)).toMatch(/^COMPLETED --run /)
  })

  it('re-runs a failed run beside its status', async () => {
    const [job, cocoa, run_id] = await at('FAILED', 'rerun-failed')
    write_script(
      job,
      'report.sh',
      'mkdir -p report\necho "$COCOA_RUN_STATUS again" > "report/$2.txt"\n'
    )

    cocoa.request_report(job, run_id)
    expect(cocoa.job(job).runs.record(run_id)).toMatchObject({
      status: 'FAILED',
      report: { attempted: false }
    })
    expect(build_world(cocoa, null).job_runs[job][String(run_id)].report).toBe('Generating')

    await cocoa.refresh()
    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('FAILED')
    expect(record.report?.attempted).toBe(true)
    expect(read_text(job, 'report', `${run_id}.txt`)).toBe('FAILED again\n')
  })

  it('refuses what the engine would not report by hand', async () => {
    const [job, cocoa, run_id] = await at('RUNNING', 'rerun-refused')
    expect(throws(() => cocoa.request_report(job, run_id))).toContain('cannot be reported')
    expect(build_world(cocoa, null).job_runs[job][String(run_id)].report_rerunnable).toBe(false)

    write(job, 'poll-state', 'CANCELLED')
    await cocoa.refresh()
    expect(throws(() => cocoa.request_report(job, run_id))).toContain('cannot be reported')

    // An ERROR that never completed has nothing to report on.
    const orphan = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    cocoa.abandon_launches()
    await cocoa.refresh()
    expect(cocoa.job(job).runs.record(orphan).status).toBe('ERROR')
    expect(throws(() => cocoa.request_report(job, orphan))).toContain('cannot be reported')
  })
})
