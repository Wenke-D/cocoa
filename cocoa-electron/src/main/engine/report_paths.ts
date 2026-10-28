// Where a run's report lives (convention §7.3): `report/<run_id>.txt`,
// `report/<run_id>.html`, or both — a report writes at least one.

import fs from 'node:fs'
import path from 'node:path'
import type { ReportFormat } from '@shared/world'

/** The folder an experiment's reports are written to. */
export function report_dir(folder: string): string {
  return path.join(folder, 'report')
}

/** One report file of a run; the plain-text one unless `format` says otherwise. */
export function report_path(
  folder: string,
  run_id: number | string,
  format: ReportFormat = 'PlainText'
): string {
  return path.join(report_dir(folder), `${run_id}.${extension_of(format)}`)
}

/** The file extension a report format is written with. */
export function extension_of(format: ReportFormat): 'txt' | 'html' {
  return format === 'Html' ? 'html' : 'txt'
}

/** Whether the run's report landed: its `.txt`, its `.html`, or both (§11). */
export function report_on_disk(folder: string, run_id: number): boolean {
  return (
    is_file(report_path(folder, run_id, 'PlainText')) ||
    is_file(report_path(folder, run_id, 'Html'))
  )
}

/**
 * The one path handed out for a run's report, where one path is asked for — a
 * campaign member's in `members.json`, an agent's `location`: the plain text
 * when there is one, the HTML when that is all there is. With neither, the
 * plain text's, as the place a report is first looked for.
 */
export function primary_report_path(folder: string, run_id: number | string): string {
  const text = report_path(folder, run_id, 'PlainText')
  const html = report_path(folder, run_id, 'Html')
  return !is_file(text) && is_file(html) ? html : text
}

function is_file(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile()
}
