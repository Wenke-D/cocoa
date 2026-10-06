// The job operations (convention §7, §10, §11): start, poll, report, cancel.
// Each runs one of the manifest's scripts and writes what it said into the
// job's runs.

import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from './index'
import { EngineError } from './errors'
import * as invoke from './invoke'
import type { Invocation, Running } from './invoke'
import type { Job } from './memory'
import type { Params } from '@shared/params'
import { argv_of } from '@shared/params'
import { validate_params } from './params'
import { apply_status, new_run_record, now_stamp, report_owed, sorted } from './record'
import type { RunOrigin, RunRecord } from './record'
import { from_poll_word, is_cancellable, is_terminal } from './status'
import type { Status } from './status'
import * as template from './template'

export interface PollReport {
  polled: number
  changed: [number, Status][]
  warnings: string[]
}

export type ReportMode = 'auto' | 'manual'

/**
 * Starts a job (§7.1): renders the template, spawns `launch` — a start
 * means "launched", not waited-for — and records the run with an empty
 * submission id, which is what marks it as still launching. `origin` says
 * who asked: a person, an agent, or a bench's call.
 */
export async function start_job(
  engine: Engine,
  job: Job,
  render_given: Record<string, unknown>,
  launch_given: Record<string, unknown>,
  origin: RunOrigin
): Promise<number> {
  const manifest = job.usable_manifest()
  const render: Params = validate_params(manifest.render_params, render_given, 'render')
  const launch: Params = validate_params(manifest.launch_params, launch_given, 'launch')

  // The template is read from disk at the moment of use — it is authored
  // content, not engine state, and must be as fresh as the start.
  const template_path = path.join(job.path, manifest.template)
  let source: string
  try {
    source = fs.readFileSync(template_path, 'utf8')
  } catch (cause) {
    throw EngineError.io(template_path, cause)
  }
  try {
    template.analyze(
      source,
      manifest.render_params.map((param) => param.name)
    )
  } catch (cause) {
    throw EngineError.template(template_path, (cause as Error).message)
  }
  let rendered: string
  try {
    rendered = template.render(source, render)
  } catch (cause) {
    throw EngineError.template(template_path, (cause as Error).message)
  }

  const run_id = job.runs.next_id()
  const run_dir = path.join(job.path, 'runs', String(run_id))
  try {
    fs.mkdirSync(run_dir, { recursive: true })
  } catch (cause) {
    throw EngineError.io(run_dir, cause)
  }

  const artifact = artifact_name(manifest.template)
  try {
    fs.writeFileSync(path.join(run_dir, artifact), rendered)
  } catch (cause) {
    throw EngineError.io(path.join(run_dir, artifact), cause)
  }

  const argv = [...manifest.launch.words]
  argv.push('--script', `runs/${run_id}/${artifact}`)
  argv.push('--run', String(run_id))
  for (const name of Object.keys(launch).sort()) {
    argv.push(...argv_of(name, launch[name]))
  }

  // The record is written before the spawn's await: the id was picked in
  // the same synchronous stretch, and a concurrent start must find it
  // taken rather than pick it too.
  const record = new_run_record(run_id, '', sorted(render), sorted(launch), origin, now_stamp())
  job.runs.write(record)

  // Only a script that cannot be started at all refuses the start itself:
  // that is a folder problem the submitter can act on now, and it leaves
  // no run behind — the reservation is dropped.
  let running: Running
  try {
    running = await invoke.spawn(job.path, argv, engine.config.launch_timeout)
  } catch (cause) {
    job.runs.drop(run_id)
    throw EngineError.io(job.path, cause)
  }

  engine.in_flight.track(job.path, run_id, manifest.launch.display, running)
  return run_id
}

/** Polls one job's active runs, one `poll` script call per run (§7.2, §10). */
export async function poll_job(engine: Engine, job: Job): Promise<PollReport> {
  const manifest = job.usable_manifest()
  const active: [number, RunRecord][] = []
  for (const view of job.runs.all()) {
    const record = view.record
    // A run whose launch script has not returned yet has no submission id
    // to poll by; it is the launch's business until harvest collects it.
    if (record !== null && !is_terminal(record.status) && record.submission_id !== '') {
      active.push([record.run_id, record])
    }
  }

  const report: PollReport = { polled: active.length, changed: [], warnings: [] }
  let broken: EngineError | null = null

  // One script call per run (§7.2): the answer needs no submission prefix,
  // and one run's slow or broken poll never speaks for another's.
  for (const [run_id, record] of active) {
    // Another operation may land while a script runs — there is no queue.
    // The history length is the record's version: a cancel during this
    // run's (or an earlier run's) poll moves it, and an answer formed
    // before that move is stale and must not land (`serial` history: a
    // stale poll used to write the pre-cancel status back over
    // CANCELLING).
    if (is_terminal(record.status)) {
      continue
    }
    const seen = record.history.length

    const argv = [...manifest.poll.words, '--submission', record.submission_id]
    let invocation: Invocation
    try {
      invocation = await invoke.run(job.path, argv, engine.config.poll_timeout)
    } catch (cause) {
      throw EngineError.io(job.path, cause)
    }
    const now = now_stamp()
    if (record.history.length !== seen) {
      continue
    }

    const lines = invoke.cocoa_return_lines(invocation.stdout)
    if (!invoke.invocation_ok(invocation) || lines.length === 0) {
      // Broken code rather than an unreachable scheduler — a poll answers
      // exactly one line, always (§7.2) — but cocoa cannot see the run
      // either way (§10). Mark it, keep polling the others, and raise the
      // first failure loudly once the sweep is done.
      const detail =
        lines.length === 0 && invoke.invocation_ok(invocation)
          ? 'poll script answered nothing'
          : invoke.invocation_output(invocation)
      if (record.status !== 'UNREACHABLE') {
        apply_status(record, 'UNREACHABLE', now, `poll script failed: ${detail}`)
        job.runs.write(record)
        report.changed.push([run_id, 'UNREACHABLE'])
      }
      broken ??= EngineError.invocation(
        manifest.poll.display,
        invocation.exit,
        invocation.timed_out,
        detail
      )
      continue
    }

    if (lines.length > 1) {
      report.warnings.push(`run ${run_id}: extra poll lines ignored`)
    }
    const match = lines[0].match(/^(\S+)(?:\s+(.*))?$/)
    if (match === null) {
      report.warnings.push(`malformed poll line ignored: \`${lines[0]}\``)
      continue
    }
    const [, word, rest] = match
    const reason = rest?.trim() !== '' ? rest?.trim() : undefined
    const status = word === 'UNREACHABLE' ? 'UNREACHABLE' : from_poll_word(word)
    if (status === null) {
      report.warnings.push(`unknown status \`${word}\` for run ${run_id} ignored`)
      continue
    }
    if (record.status !== status) {
      apply_status(record, status, now, reason)
      // The report a failed run owes is written with the verdict, in one
      // write: a close before the script lands leaves it owed, and the next
      // session takes it like an ANALYZING run's (§7.3.1).
      if (status === 'FAILED') {
        record.report = { attempted: false }
      }
      job.runs.write(record)
      report.changed.push([run_id, status])
    }
  }

  if (broken !== null) {
    throw broken
  }
  return report
}

/**
 * Runs the report script for one run (§7.3, §11). The record is the live
 * in-memory truth: a poll advancing the run while the (possibly long)
 * report script runs mutates the same object, so the outcomes compose.
 *
 * A `FAILED` run is reported beside its status, never on it (§7.3.1): it
 * stays `FAILED` whatever the script does, and the outcome lands in its
 * `report` field instead.
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

  const eligible =
    mode === 'auto'
      ? record.status === 'COMPLETED' || record.status === 'ANALYZING' || report_owed(record)
      : record.status === 'COMPLETED' ||
        record.status === 'ANALYZING' ||
        record.status === 'SUCCEEDED' ||
        failed ||
        (record.status === 'ERROR' &&
          record.history.some((change) => change.status === 'COMPLETED'))
  if (!eligible) {
    throw EngineError.validation(`run ${run_id} (${record.status}) cannot be reported`)
  }

  if (!failed && record.status !== 'ANALYZING') {
    apply_status(record, 'ANALYZING', now_stamp())
    job.runs.write(record)
  }

  const report_dir = path.join(job.path, 'report')
  try {
    fs.mkdirSync(report_dir, { recursive: true })
  } catch (cause) {
    throw EngineError.io(report_dir, cause)
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
  } else if (mode === 'auto') {
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

/** Cancels one run through the job's `cancel` script (§7.4). */
export async function cancel_run(engine: Engine, job: Job, run_id: number): Promise<void> {
  const manifest = job.usable_manifest()
  const record = job.runs.record(run_id)
  if (!is_cancellable(record.status)) {
    throw EngineError.validation(`run ${run_id} (${record.status}) cannot be cancelled`)
  }
  if (record.submission_id === '') {
    throw EngineError.validation(
      `run ${run_id} is still launching; there is no submission to cancel yet`
    )
  }
  const argv = [...manifest.cancel.words, '--submission', record.submission_id]
  let invocation: Invocation
  try {
    invocation = await invoke.run(job.path, argv, engine.config.cancel_timeout)
  } catch (cause) {
    throw EngineError.io(job.path, cause)
  }
  if (invoke.invocation_ok(invocation)) {
    // The run may have moved while the cancel script ran — ended on its
    // own, or another cancel got there first. The cluster has been told
    // either way; only a run still cancellable takes the CANCELLING mark.
    if (is_cancellable(record.status)) {
      apply_status(record, 'CANCELLING', now_stamp())
      job.runs.write(record)
    }
    return
  }
  throw EngineError.invocation(
    manifest.cancel.display,
    invocation.exit,
    invocation.timed_out,
    invoke.invocation_output(invocation)
  )
}

/** Whether `report/<run_id>.txt` exists in the folder (§11). */
export function report_on_disk(folder: string, run_id: number): boolean {
  const file = path.join(folder, 'report', `${run_id}.txt`)
  return fs.existsSync(file) && fs.statSync(file).isFile()
}

/** Strips a trailing `.tmpl` from the template's file name (§6.1). */
function artifact_name(template_rel: string): string {
  const name = path.basename(template_rel)
  if (name.endsWith('.tmpl') && name !== '.tmpl') {
    return name.slice(0, -'.tmpl'.length)
  }
  return name
}

/** Declared params and provided values must be exactly the same set (§2). */
