// The agent module's shared vocabulary: what the socket needs from the rest
// of the process, the one shape every reply takes, and how a write waits.

import type {
  AddFolderResult,
  CancelResult,
  CancelTarget,
  LockReportResult,
  LockReportTarget,
  RerunReportResult,
  RerunReportTarget,
  StartResult
} from '@shared/protocol'
import type { World } from '@shared/world'

/** What the socket needs from the rest of the process, and nothing more. */
export interface AgentDeps {
  /** The world the window is rendering from, as it last saw it. */
  current_world: () => World
  /** Starts an experiment by name, stamped as the agent's (§43). */
  start(name: string, parameters: Record<string, unknown>): Promise<StartResult>
  /** Regenerates a job run's or a campaign run's report: marks it due, as a click does. */
  rerun_report(target: RerunReportTarget): RerunReportResult
  /** Locks or unlocks a job run's or a campaign run's report, as its button does. */
  lock_report(target: LockReportTarget): LockReportResult
  /** Registers a folder, as the Explorer's `+` does with a picked one. */
  register(folder: string): AddFolderResult
  /** Cancels a job or campaign run, as the cancel modal's confirm does. */
  cancel(target: CancelTarget): Promise<CancelResult>
}

/** A finished answer: the status, and the JSON already serialised. */
export interface AgentResponse {
  status: number
  body: string
}

export function json(status: number, value: unknown): AgentResponse {
  return { status, body: JSON.stringify(value) }
}

/** A failure, in the one shape every failing reply takes. */
export function failure(status: number, message: string): AgentResponse {
  return json(status, { error: message })
}

/**
 * How long a caller waits for the engine's queue before being told cocoa is not
 * answering. Generous: a write runs the experiment's own scripts — launch,
 * cancel — which talk to a cluster.
 */
const REPLY_TIMEOUT_MS = 30_000

/**
 * Which failure this was, as far as the wire is concerned. The engine's errors
 * are sentences meant for a person, so this reads them rather than inventing a
 * parallel set of codes. Anything unrecognised is a `400`: the request was
 * refused, and the caller is the one who can act.
 */
export function status_for(message: string): number {
  if (message.startsWith('No such entity')) {
    return 404
  }
  if (message.includes('did not answer in time')) {
    return 503
  }
  return 400
}

/**
 * What keeps a caller from hanging forever if the engine is wedged. In the
 * normal case a write is one queue turn away.
 */
export async function with_timeout<T>(
  work: Promise<T>
): Promise<T | { ok: false; message: string }> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<{ ok: false; message: string }>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, message: 'cocoa did not answer in time' }),
      REPLY_TIMEOUT_MS
    )
  })
  try {
    return await Promise.race([work, expiry])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}
