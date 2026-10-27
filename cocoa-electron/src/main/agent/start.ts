// The write route's answer: a start over the socket, refused or queued
// exactly as a click would be (§43).

import type { AgentDeps, AgentResponse } from './answer'
import { failure, json, status_for, with_timeout } from './answer'

export async function start_run(
  name: string,
  body: string,
  deps: AgentDeps
): Promise<AgentResponse> {
  let parameters: Record<string, unknown> = {}
  if (body.trim() !== '') {
    try {
      const parsed = JSON.parse(body) as { parameters?: Record<string, unknown> }
      parameters = parsed.parameters ?? {}
    } catch (error) {
      return failure(400, (error as Error).message)
    }
  }

  // The name is answered for here, before the engine is asked, so an unknown
  // experiment gets the `No such entity` refusal and its 404.
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
