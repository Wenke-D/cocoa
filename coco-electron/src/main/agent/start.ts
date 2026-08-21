// The write route's answer: a start over the socket, refused or queued
// exactly as a click would be (§43).

import type { StartResult } from '@shared/world'
import type { AgentDeps, AgentResponse } from './answer'
import { failure, json } from './answer'

/**
 * How long a caller waits for the engine's queue before being told coco is not
 * answering. Generous: a start runs the experiment's own launch script, which
 * talks to a cluster.
 */
const REPLY_TIMEOUT_MS = 30_000

/**
 * Which failure this was, as far as the wire is concerned. The engine's errors
 * are sentences meant for a person, so this reads them rather than inventing a
 * parallel set of codes. Anything unrecognised is a `400`: the request was
 * refused, and the caller is the one who can act.
 */
function status_for(message: string): number {
  if (message.startsWith('No such entity')) {
    return 404
  }
  if (message.includes('did not answer in time')) {
    return 503
  }
  return 400
}

export async function start_run(
  name: string,
  body: string,
  deps: AgentDeps
): Promise<AgentResponse> {
  let parameters: Record<string, string> = {}
  if (body.trim() !== '') {
    try {
      const parsed = JSON.parse(body) as { parameters?: Record<string, string> }
      parameters = parsed.parameters ?? {}
    } catch (error) {
      return failure(400, (error as Error).message)
    }
  }

  // The name is answered for here so the refusal reads the same as the Rust
  // interface's, which is what decides the status code.
  const known = deps.current_world().entities.some((entity) => entity.name === name)
  if (!known) {
    return failure(404, `No such entity: ${name}`)
  }

  const result = await with_timeout(deps.start(name, parameters))
  // The workbench's own failure text, unchanged: an agent reading it should
  // see what a person would have been shown.
  if (!result.ok) {
    return failure(status_for(result.message), result.message)
  }
  return json(201, { run_id: result.run_id })
}

/**
 * What keeps a caller from hanging forever if the engine is wedged. In the
 * normal case a start is one queue turn away.
 */
async function with_timeout(work: Promise<StartResult>): Promise<StartResult> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<StartResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, message: 'coco did not answer in time' }),
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
