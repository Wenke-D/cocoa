// The lock route's answer: a job run's or a campaign run's report locked or
// unlocked over the socket, exactly as the report row's Lock button does
// (convention §7.3.3).

import { campaign_run, job_run } from '@shared/world'
import type { AgentDeps, AgentResponse } from './answer'
import { failure, json } from './answer'

/**
 * Sets the lock to `{"locked": true}` or `{"locked": false}`. Answers `200`
 * with the state the report is now in — asking for the state it is already
 * in changes nothing, and says so the same way — `404` for an experiment or
 * run that is not there, and `400` with the workbench's refusal: nothing to
 * lock yet, or a report still being written.
 */
export function lock_report(
  name: string,
  run_id: string,
  body: string,
  deps: AgentDeps
): AgentResponse {
  let locked: unknown
  try {
    locked = (JSON.parse(body === '' ? '{}' : body) as { locked?: unknown }).locked
  } catch (error) {
    return failure(400, (error as Error).message)
  }
  if (typeof locked !== 'boolean') {
    return failure(400, 'a lock needs {"locked": true} or {"locked": false}')
  }

  const world = deps.current_world()
  const entity = world.entities.find((candidate) => candidate.name === name)
  if (entity === undefined) {
    return failure(404, `No such entity: ${name}`)
  }
  const run =
    entity.kind === 'Job'
      ? job_run(world, entity.id, run_id)
      : campaign_run(world, entity.id, run_id)
  if (run === undefined) {
    return failure(404, `No such run: ${name} run ${run_id}`)
  }

  const result = deps.lock_report({ entity_id: entity.id, run_id, locked })
  if (!result.ok) {
    return failure(400, result.message)
  }
  return json(200, { run_id, report_locked: locked })
}
