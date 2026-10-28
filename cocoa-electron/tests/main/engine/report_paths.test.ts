import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  primary_report_path,
  report_on_disk,
  report_path
} from '../../../src/main/engine/report_paths'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

function write_report(folder: string, name: string, contents: string): void {
  fs.mkdirSync(path.join(folder, 'report'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'report', name), contents)
}

// A report writes `.txt`, `.html`, or both (§11).
describe('report paths', () => {
  it('counts a report as landed with either file, and not with none', () => {
    const folder = temp_dir()
    expect(report_on_disk(folder, 1)).toBe(false)
    write_report(folder, '1.html', '<p>read</p>')
    expect(report_on_disk(folder, 1)).toBe(true)
    write_report(folder, '2.txt', 'ok')
    expect(report_on_disk(folder, 2)).toBe(true)
  })

  it('hands out the plain text when there is one, else the HTML', () => {
    const folder = temp_dir()
    expect(primary_report_path(folder, 1)).toBe(report_path(folder, 1, 'PlainText'))
    write_report(folder, '1.html', '<p>read</p>')
    expect(primary_report_path(folder, 1)).toBe(report_path(folder, 1, 'Html'))
    write_report(folder, '1.txt', 'ok')
    expect(primary_report_path(folder, 1)).toBe(report_path(folder, 1, 'PlainText'))
  })
})
