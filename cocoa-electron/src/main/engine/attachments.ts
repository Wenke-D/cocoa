// A run's report attachments (convention §7.3, §8.3): the directory cocoa
// hands a report script as `--attachment-dir`, for whatever the script brings
// beside `report/<run_id>.txt` — plots, tables, whole output trees.

import fs from 'node:fs'
import path from 'node:path'
import { EngineError } from './errors'

/** The attachment directory relative to the experiment folder: the `--attachment-dir` value. */
export function attachment_arg(run_id: number | string): string {
  return path.join('runs', String(run_id), 'report', 'attachment')
}

/** The attachment directory of a run in `folder`, absolute. */
export function attachment_dir(folder: string, run_id: number | string): string {
  return path.join(folder, attachment_arg(run_id))
}

/**
 * Empties and creates the directory before a report script runs. A re-run
 * replaces the attachments as it replaces the report, so what a previous
 * attempt left never passes for this one's.
 */
export function prepare_attachments(folder: string, run_id: number): void {
  const dir = attachment_dir(folder, run_id)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  } catch (cause) {
    throw EngineError.io(dir, cause)
  }
}

/**
 * Drops the directory, and the `report/` around it, when the script left
 * them empty: a report with nothing attached leaves nothing behind. Best
 * effort — the report's outcome is the script's, never this tidying's.
 */
export function settle_attachments(folder: string, run_id: number): void {
  const dir = attachment_dir(folder, run_id)
  for (const empty of [dir, path.dirname(dir)]) {
    try {
      fs.rmdirSync(empty)
    } catch {
      return
    }
  }
}

/** How many entries the script attached, at the top of the directory; 0 when there is none. */
export function attachment_count(folder: string, run_id: number | string): number {
  try {
    return fs.readdirSync(attachment_dir(folder, run_id)).length
  } catch {
    return 0
  }
}
