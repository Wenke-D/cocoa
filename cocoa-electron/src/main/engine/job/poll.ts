// Polling a job's active runs (convention §7.2, §10).

import type { Engine } from '../engine'
import { EngineError } from '../errors'
import * as invoke from '../invoke'
import type { Invocation } from '../invoke'
import { apply_status, now_stamp } from '../record'
import type { RunRecord } from '../record'
import { from_poll_word, is_terminal } from '../status'
import type { Status } from '../status'
import type { Job } from './job'

export interface PollReport {
  polled: number
  changed: [number, Status][]
  warnings: string[]
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
    // before that move is stale and must not land: it would write the
    // pre-cancel status back over CANCELLING.
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
