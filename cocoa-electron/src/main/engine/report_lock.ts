// Locking a run's report (convention §7.3.3): someone's word that this report
// is the one to keep. While it holds, the report is not regenerated and the
// run is not deleted — the two ways cocoa would otherwise replace or remove
// it. The record carries it, so it outlives the session and an agent reads it.

import { EngineError } from './errors'
import type { Runs } from './runs'
import { report_on_disk } from './report_paths'

/** What a record needs to be locked: a job run's and a campaign run's both are. */
interface Lockable {
  run_id: number
  report_locked?: true
}

/**
 * Locks or unlocks one run's report. Locking needs a report on disk that is
 * not being written — `in_flight` says whether it is — since there is nothing
 * to keep otherwise. Unlocking always succeeds, and asking for the state the
 * report is already in changes nothing.
 */
export function set_report_lock<R extends Lockable>(
  folder: string,
  runs: Runs<R>,
  run_id: number,
  locked: boolean,
  in_flight: (record: R) => boolean
): void {
  const record = runs.record(run_id)
  if (locked === (record.report_locked === true)) {
    return
  }
  if (locked) {
    if (in_flight(record)) {
      throw EngineError.validation(
        `the report of run ${run_id} is being generated; lock it once it lands`
      )
    }
    if (!report_on_disk(folder, run_id)) {
      throw EngineError.validation(`run ${run_id} has no report to lock`)
    }
    record.report_locked = true
  } else {
    delete record.report_locked
  }
  runs.write(record)
}

/** The refusal a locked report gives whatever would replace or remove it. */
export function locked_refusal(run: string, action: string): EngineError {
  return EngineError.validation(`the report of ${run} is locked; unlock it to ${action}`)
}
