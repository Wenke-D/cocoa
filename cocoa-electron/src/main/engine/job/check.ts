// Asking a job whether it is ready to launch (convention §7.5). Every start
// asks the job's `check` script first: `CURRENT` launches at once, `STALE`
// runs `deploy` and launches once it is done, `CONFLICT` refuses the start.

import type { Engine } from '../engine'
import { EngineError } from '../errors'
import * as invoke from '../invoke'
import type { Invocation } from '../invoke'
import type { JobManifest } from '../manifest'
import type { Job } from './job'

/** What `check` said, when it allows a start at all (§7.5). */
export interface CheckAnswer {
  word: 'CURRENT' | 'STALE'
  reason?: string
}

/**
 * Runs the job's `check` (§7.5). Answers `CURRENT` or `STALE`; a
 * `CONFLICT`, and a check that could not say, refuse the start by
 * throwing — with nothing recorded, since no run exists yet.
 */
export async function check(engine: Engine, job: Job, manifest: JobManifest): Promise<CheckAnswer> {
  const script = manifest.check.display
  let invocation: Invocation
  try {
    invocation = await invoke.run(job.path, [...manifest.check.words], engine.config.check_timeout)
  } catch (cause) {
    throw EngineError.io(job.path, cause)
  }
  if (!invoke.invocation_ok(invocation)) {
    throw EngineError.invocation(
      script,
      invocation.exit,
      invocation.timed_out,
      invoke.invocation_output(invocation)
    )
  }
  const lines = invoke.cocoa_return_lines(invocation.stdout)
  if (lines.length !== 1) {
    const said = lines.length === 0 ? 'nothing' : `${lines.length} lines`
    throw EngineError.validation(`\`${script}\` answered ${said}; a check answers exactly one line`)
  }
  const match = lines[0].match(/^(\S+)(?:\s+(.*))?$/)
  const word = match?.[1] ?? ''
  const reason = match?.[2]?.trim() || undefined
  if (word === 'CURRENT' || word === 'STALE') {
    return reason !== undefined ? { word, reason } : { word }
  }
  if (word === 'CONFLICT') {
    // The script's own judgement, and the whole of it: cocoa does not know
    // what a deploy would collide with, only that the folder says it would.
    throw EngineError.validation(
      `\`${manifest.name}\` cannot start now: deploying it would conflict` +
        (reason !== undefined ? ` — ${reason}` : '')
    )
  }
  throw EngineError.validation(
    `\`${script}\` answered \`${lines[0]}\`; a check answers CURRENT, STALE or CONFLICT`
  )
}
