// The registration route's answer: a folder added over the socket, refused or
// registered exactly as the Explorer's `+` would (§43, convention §5).

import path from 'node:path'
import type { AgentDeps, AgentResponse } from './answer'
import { failure, json } from './answer'

/**
 * Registers the folder at `{"path": …}`. The path must be absolute: the
 * agent's working directory is not cocoa's, and a relative one would quietly
 * resolve against the wrong one. Answers `201` with the experiment's name and
 * kind, `200` when it was already registered — a no-op, never a duplicate —
 * and `400` with the workbench's own refusal: no folder there, a manifest
 * that does not load, a name already taken.
 */
export function register_folder(body: string, deps: AgentDeps): AgentResponse {
  let folder: unknown
  try {
    folder = (JSON.parse(body === '' ? '{}' : body) as { path?: unknown }).path
  } catch (error) {
    return failure(400, (error as Error).message)
  }
  if (typeof folder !== 'string' || folder === '') {
    return failure(400, 'a registration needs {"path": "/absolute/path/to/the/folder"}')
  }
  if (!path.isAbsolute(folder)) {
    return failure(400, `\`${folder}\` is not an absolute path`)
  }

  const result = deps.register(folder)
  if (!result.ok) {
    return failure(400, result.message)
  }
  // The registration was published before this answer, so the world the
  // reads answer from already has it.
  const entity = deps
    .current_world()
    .entities.find((candidate) => candidate.id === result.entity_id)
  const kind = entity?.kind === 'Campaign' ? 'campaign' : 'job'
  const name = entity?.name ?? path.basename(result.entity_id)
  return json(result.already ? 200 : 201, {
    name,
    kind,
    folder: result.entity_id,
    already: result.already,
    follow: `/${kind === 'campaign' ? 'campaigns' : 'jobs'}/${name}`
  })
}
