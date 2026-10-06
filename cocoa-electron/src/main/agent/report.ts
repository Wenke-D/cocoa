// The report route's answer: a report re-run by hand over the socket, refused
// or accepted exactly as the Re-run report button would be (convention
// §7.3.2).

import path from 'node:path'
import type { AgentDeps, AgentResponse } from './answer'
import { failure, json } from './answer'

/**
 * Accepted is `202`, at once: the report is due, not done. A report script may
 * run for the whole report timeout — ten minutes — which no caller should
 * hold a connection for, and which the 30-second wait on a write (§43.3) and
 * the MCP binary's own timeout were never sized for. The run reads
 * `report_running` in `GET /jobs/{name}` until the outcome lands there.
 */
export function rerun_report(name: string, run_id: string, deps: AgentDeps): AgentResponse {
  const world = deps.current_world()
  const entity = world.entities.find((candidate) => candidate.name === name)
  if (entity === undefined) {
    return failure(404, `No such entity: ${name}`)
  }
  if (entity.kind === 'Campaign') {
    return failure(
      400,
      `${name} is a campaign; a campaign's report is not re-run by hand, but each of its runs' ` +
        `can be, under its own job`
    )
  }
  if (world.job_runs[entity.id]?.[run_id] === undefined) {
    return failure(404, `No such run: ${name} run ${run_id}`)
  }

  const result = deps.rerun_report({ job_id: entity.id, run_id })
  // The workbench's own refusal, unchanged: not eligible, or already running.
  if (!result.ok) {
    return failure(400, result.message)
  }
  return json(202, {
    run_id,
    report_running: true,
    location: { report: path.join(entity.id, 'report', `${run_id}.txt`) },
    follow: `/jobs/${name}`
  })
}
