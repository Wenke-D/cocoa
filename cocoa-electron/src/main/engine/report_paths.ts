// Where a run's report lives (convention §7.3): `report/<run_id>.txt`, which
// every report writes, and `report/<run_id>.html`, which it may add.

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

/** Whether `report/<run_id>.txt` exists in the folder (§11). */
export function report_on_disk(folder: string, run_id: number): boolean {
  const file = report_path(folder, run_id)
  return fs.existsSync(file) && fs.statSync(file).isFile()
}
