// Visualizing a reported run (convention §7.7, §8.4): the optional
// `[visualize]` script, started by hand to look at what a report left. It
// opens a viewer a person drives for as long as they like, so cocoa starts it
// and lets it go: no timeout, nothing recorded, and a close leaves it open.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { attachment_arg } from './attachments'
import type { Campaign } from './campaign/campaign'
import { EngineError } from './errors'
import { Job } from './job/job'
import { report_in_flight } from './job/report'
import type { Command } from './manifest'
import { report_on_disk } from './report_paths'

/** How much of a failed viewer's output its error carries: the end, where the reason is. */
const OUTPUT_TAIL_BYTES = 16 * 1024

/** The script's argv for one run: the report directory and the run's attachment directory. */
export function visualize_argv(command: Command, run_id: number): string[] {
  return [
    ...command.words,
    '--run',
    String(run_id),
    '--report-dir',
    'report',
    '--attachment-dir',
    attachment_arg(run_id)
  ]
}

/**
 * Whether a run can be visualized now: its experiment has a `[visualize]`
 * script, and the run has a report that is not being rewritten.
 */
export function visualizable(entity: Job | Campaign, run_id: number): boolean {
  if ((entity.manifest?.visualize ?? null) === null) {
    return false
  }
  if (entity instanceof Job) {
    const record = entity.runs.find(run_id)
    if (record !== null && report_in_flight(record)) {
      return false
    }
  }
  return report_on_disk(entity.path, run_id)
}

/**
 * Starts the `[visualize]` script for one run and answers once it has
 * started. A refusal throws; so does a script that cannot be started at all.
 * `on_failure` hears, whenever it comes, of a script that exits non-zero.
 */
export async function visualize(
  entity: Job | Campaign,
  run_id: number,
  on_failure: (error: EngineError) => void
): Promise<void> {
  const manifest = entity.usable_manifest()
  if (manifest.visualize === null) {
    throw EngineError.validation(`\`${manifest.name}\` has no visualize script`)
  }
  entity.runs.record(run_id)
  if (!visualizable(entity, run_id)) {
    throw EngineError.validation(`run ${run_id} has no report to visualize`)
  }
  await start_detached(
    entity.path,
    visualize_argv(manifest.visualize, run_id),
    manifest.visualize.display,
    on_failure
  )
}

/**
 * Spawns `argv` in its own session with its output in a temporary file
 * rather than a pipe: a viewer that outlives cocoa must not die of a broken
 * pipe the first time it logs.
 */
async function start_detached(
  cwd: string,
  argv: string[],
  script: string,
  on_failure: (error: EngineError) => void
): Promise<void> {
  const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cocoa-visualize-'))
  const log_path = path.join(log_dir, 'output')
  const forget = (): void => fs.rmSync(log_dir, { recursive: true, force: true })
  let child: ChildProcess
  const log = fs.openSync(log_path, 'w')
  try {
    child = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: ['ignore', log, log] })
  } finally {
    fs.closeSync(log)
  }
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  } catch (cause) {
    forget()
    throw EngineError.io(cwd, cause)
  }
  child.unref()
  child.once('exit', (code) => {
    if (code !== null && code !== 0) {
      on_failure(EngineError.invocation(script, code, false, output_tail(log_path)))
    }
    forget()
  })
}

function output_tail(file: string): string {
  try {
    const size = fs.statSync(file).size
    const start = Math.max(0, size - OUTPUT_TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    const fd = fs.openSync(file, 'r')
    try {
      fs.readSync(fd, buffer, 0, buffer.length, start)
    } finally {
      fs.closeSync(fd)
    }
    return buffer.toString('utf8')
  } catch {
    return ''
  }
}
