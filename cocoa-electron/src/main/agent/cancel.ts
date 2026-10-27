// The cancel route's answer: a job or campaign run cancelled over the socket,
// refused or accepted exactly as the cancel modal's confirm would be (§43,
// convention §7.4).

import type { CancelTarget } from '@shared/protocol'
import type { AgentDeps, AgentResponse } from './answer'
import { failure, json, status_for, with_timeout } from './answer'

/**
 * Accepted is `202`: the cancel script said yes, and the run reads
 * `Cancelling` — but only a later poll can call it `Cancelled` (§7.4), so the
 * caller follows the run until it does. There is no confirmation to answer:
 * the modal is the window's, and the agent asking is the agent deciding.
 */
export async function cancel_run(
  name: string,
  run_id: string,
  deps: AgentDeps
): Promise<AgentResponse> {
  const world = deps.current_world()
  const entity = world.entities.find((candidate) => candidate.name === name)
  if (entity === undefined) {
    return failure(404, `No such entity: ${name}`)
  }
  const runs = entity.kind === 'Job' ? world.job_runs : world.campaign_runs
  if (runs[entity.id]?.[run_id] === undefined) {
    return failure(404, `No such run: ${name} run ${run_id}`)
  }

  const target: CancelTarget =
    entity.kind === 'Job'
      ? { kind: 'job_run', job_id: entity.id, run_id }
      : { kind: 'campaign_run', campaign_id: entity.id, run_id }
  const result = await with_timeout(deps.cancel(target))
  // The workbench's own refusal, unchanged: a run that has ended, one not
  // launched yet, a cancel script that failed, a campaign member that did not
  // stop.
  if (!result.ok) {
    return failure(status_for(result.message), result.message)
  }
  return json(202, {
    run_id,
    follow: `/${entity.kind === 'Job' ? 'jobs' : 'campaigns'}/${name}`
  })
}
