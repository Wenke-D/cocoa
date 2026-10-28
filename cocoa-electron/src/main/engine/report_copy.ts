// Saving a copy of a run's report somewhere of the person's choosing: the
// report files and the attachments, out of cocoa's reach, so a later
// regenerate or delete leaves the copy as it was.

import fs from 'node:fs'
import path from 'node:path'
import { attachment_arg, attachment_count } from './attachments'
import { EngineError } from './errors'
import { report_on_disk, report_path } from './report_paths'

/**
 * Copies run `run_id`'s report from `folder` into a new directory
 * `destination`, at the same relative paths as in the folder —
 * `report/<id>.txt`, `report/<id>.html`, `runs/<id>/report/attachment/` — so
 * an HTML report's links into its attachments still resolve in the copy.
 * Refuses a run with no report, and a destination that already exists: a
 * save never writes into, or over, something that was there.
 */
export function copy_report(folder: string, run_id: number, destination: string): void {
  if (!report_on_disk(folder, run_id)) {
    throw EngineError.validation(`run ${run_id} has no report to save`)
  }
  if (fs.existsSync(destination)) {
    throw EngineError.validation(`${destination} already exists; save the report under a new name`)
  }
  const parts = [
    path.relative(folder, report_path(folder, run_id, 'PlainText')),
    path.relative(folder, report_path(folder, run_id, 'Html')),
    ...(attachment_count(folder, run_id) > 0 ? [attachment_arg(run_id)] : [])
  ]
  try {
    for (const part of parts) {
      const source = path.join(folder, part)
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(destination, part), { recursive: true })
      }
    }
  } catch (cause) {
    throw EngineError.io(destination, cause)
  }
}
