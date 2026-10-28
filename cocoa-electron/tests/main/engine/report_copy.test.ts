import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copy_report } from '../../../src/main/engine/report_copy'
import { throws } from '../../support/failure'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

/** An experiment folder holding run 3's report, its HTML, and one attachment. */
function reported_folder(): string {
  const folder = temp_dir()
  fs.mkdirSync(path.join(folder, 'report'))
  fs.writeFileSync(path.join(folder, 'report', '3.txt'), 'converged\n')
  fs.writeFileSync(
    path.join(folder, 'report', '3.html'),
    '<img src="../runs/3/report/attachment/plot.svg">'
  )
  fs.mkdirSync(path.join(folder, 'runs', '3', 'report', 'attachment'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'runs', '3', 'report', 'attachment', 'plot.svg'), '<svg/>')
  fs.writeFileSync(path.join(folder, 'runs', '3', 'run.json'), '{}')
  fs.writeFileSync(path.join(folder, 'report', '4.txt'), 'another run\n')
  return folder
}

/** Every file under `dir`, relative to it, sorted. */
function files_under(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => fs.statSync(path.join(dir, entry)).isFile())
    .sort()
}

describe('copy_report', () => {
  // The same relative paths as in the folder, so the HTML's link still resolves.
  it('copies the run’s report files and attachments, and nothing else', () => {
    const folder = reported_folder()
    const destination = path.join(temp_dir(), 'kept')

    copy_report(folder, 3, destination)

    expect(files_under(destination)).toEqual([
      path.join('report', '3.html'),
      path.join('report', '3.txt'),
      path.join('runs', '3', 'report', 'attachment', 'plot.svg')
    ])
    const html = path.join(destination, 'report', '3.html')
    const linked = path.resolve(path.dirname(html), '../runs/3/report/attachment/plot.svg')
    expect(fs.readFileSync(linked, 'utf8')).toBe('<svg/>')
  })

  it('copies a plain-text report that attached nothing', () => {
    const folder = temp_dir()
    fs.mkdirSync(path.join(folder, 'report'))
    fs.writeFileSync(path.join(folder, 'report', '0.txt'), 'done\n')
    const destination = path.join(temp_dir(), 'kept')

    copy_report(folder, 0, destination)

    expect(files_under(destination)).toEqual([path.join('report', '0.txt')])
  })

  it('refuses a run with no report, and a destination that exists', () => {
    const folder = reported_folder()
    const destination = path.join(temp_dir(), 'kept')
    expect(throws(() => copy_report(folder, 9, destination))).toBe('run 9 has no report to save')
    expect(fs.existsSync(destination)).toBe(false)

    const taken = temp_dir()
    expect(throws(() => copy_report(folder, 3, taken))).toBe(
      `${taken} already exists; save the report under a new name`
    )
    expect(fs.readdirSync(taken)).toEqual([])
  })
})
