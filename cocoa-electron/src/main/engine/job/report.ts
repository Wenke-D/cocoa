// Reporting a job's run (convention §7.3, §11), automatically or by hand.

import fs from 'node:fs'
import type { Engine } from '../engine'
import { EngineError } from '../errors'
import * as invoke from '../invoke'
import type { Invocation } from '../invoke'
import { apply_status, now_stamp, report_owed } from '../record'
import type { RunRecord } from '../record'
import { report_dir, report_on_disk } from '../report_paths'
import type { Job } from './job'

export type ReportMode = 'auto' | 'manual'

/**
 * Whether `report_run` will take the run in `mode` (§7.3, §7.3.1). Automatic
 * means due: `COMPLETED`, `ANALYZING`, or a `FAILED` run's owed report. By
 * hand is any run whose cluster outcome was `COMPLETED` — including one left
 * at `ERROR` by its report — or `FAILED`.
 */
export function reportable(record: RunRecord, mode: ReportMode): boolean {
  if (mode === 'auto') {
    return record.status === 'COMPLETED' || record.status === 'ANALYZING' || report_owed(record)
  }
  return (
    record.status === 'COMPLETED' ||
    record.status === 'ANALYZING' ||
    record.status === 'SUCCEEDED' ||
    record.status === 'FAILED' ||
    (record.status === 'ERROR' && record.history.some((change) => change.status === 'COMPLETED'))
  )
}

/** Whether the run's report is due or running: `ANALYZING`, or owed (§7.3.1). */
export function report_in_flight(record: RunRecord): boolean {
  return record.status === 'ANALYZING' || report_owed(record)
}

/**
 * Asks for a run's report again, by hand (§7.3.2). Nothing runs here: the
 * report is marked due exactly as the automatic path marks it — `ANALYZING`,
 * or a `FAILED` run's report owed — and the refresh tick takes it from there,
 * so the outcome lands the way an automatic one does and a report is never
 * run twice at once. Refuses a run that cannot be reported by hand, and one
 * whose report is already due or running.
 */
export function request_report(job: Job, run_id: number): void {
  job.usable_manifest()
  const record = job.runs.record(run_id)
  if (report_in_flight(record)) {
    throw EngineError.validation(`the report of run ${run_id} is already running`)
  }
  if (!reportable(record, 'manual')) {
    throw EngineError.validation(`run ${run_id} (${record.status}) cannot be reported`)
  }
  if (record.status === 'FAILED') {
    record.report = { attempted: false }
  } else {
    apply_status(record, 'ANALYZING', now_stamp())
    // The last report's failure is not this one's; the outcome brings its own.
    delete record.error
  }
  job.runs.write(record)
}

/**
 * Runs the report script for one run (§7.3, §11). The record is the live
 * in-memory truth: a poll advancing the run while the (possibly long)
 * report script runs mutates the same object, so the outcomes compose.
 *
 * A `FAILED` run is reported beside its status, never on it (§7.3.1): it
 * stays `FAILED` whatever the script does, and the outcome lands in its
 * `report` field instead. `mode` decides only which runs are taken; the
 * outcome lands the same way either way (§7.3.2).
 */
export async function report_run(
  engine: Engine,
  job: Job,
  run_id: number,
  mode: ReportMode
): Promise<void> {
  const manifest = job.usable_manifest()
  const record = job.runs.record(run_id)
  const failed = record.status === 'FAILED'

  if (!reportable(record, mode)) {
    throw EngineError.validation(`run ${run_id} (${record.status}) cannot be reported`)
  }

  if (!failed && record.status !== 'ANALYZING') {
    apply_status(record, 'ANALYZING', now_stamp())
    job.runs.write(record)
  }

  const folder = report_dir(job.path)
  try {
    fs.mkdirSync(folder, { recursive: true })
  } catch (cause) {
    throw EngineError.io(folder, cause)
  }
  const argv = [
    ...manifest.report.words,
    '--run',
    String(run_id),
    '--submission',
    record.submission_id
  ]
  // The cluster's outcome, so one script can serve both (§6, §7.3.1).
  const env = { COCOA_RUN_STATUS: failed ? 'FAILED' : 'COMPLETED' }
  let invocation: Invocation
  try {
    invocation = await invoke.run(job.path, argv, engine.config.report_timeout, env)
  } catch (cause) {
    throw EngineError.io(job.path, cause)
  }

  const ok = invoke.invocation_ok(invocation) && report_on_disk(job.path, run_id)
  const detail = ok
    ? undefined
    : invoke.invocation_ok(invocation)
      ? `report script exited 0 but produced no report/${run_id}.txt`
      : invoke.invocation_output(invocation)

  if (failed) {
    // A failed run is finished, so it may have been deleted while its
    // report ran; the outcome lands only on the record it was taken for.
    if (job.runs.find(run_id) === record) {
      record.report = {
        attempted: true,
        at: now_stamp(),
        ...(detail !== undefined ? { error: detail } : {})
      }
      job.runs.write(record)
    }
  } else if (ok) {
    apply_status(record, 'SUCCEEDED', now_stamp())
    delete record.error
    job.runs.write(record)
  } else {
    apply_status(record, 'ERROR', now_stamp())
    record.error = detail
    job.runs.write(record)
  }

  if (detail !== undefined) {
    throw EngineError.invocation(
      manifest.report.display,
      invocation.exit,
      invocation.timed_out,
      detail
    )
  }
}
