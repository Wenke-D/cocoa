// The seam an agent drives cocoa through (specification §43).
//
// An agent asks cocoa to do things; it never runs an experiment's scripts
// itself. Everything it can ask for arrives here and takes exactly the path a
// click takes: the same `bridge/operations.ts`, the same engine queue, the same
// screen update. There is no second way into the engine to keep in step with
// the first — the difference between a click and a call is one word, the
// trigger stamped on the run.
//
// The wire is HTTP/1.1 over a Unix socket, because that is what the bundled
// `cocoa_mcp_server` binary talks to. Express speaks
// the protocol — routing, decoding, the body cap, framing are a library's,
// audited by its million users rather than by ours — so this stays a
// transport adapter over `bridge/operations.ts`, not a second implementation.
// `curl --unix-socket` debugs it either way.

import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { Maybe } from '@shared/maybe'
import { env_var } from '../env'
import { in_profile } from '../profile'
import type { AgentDeps } from './answer'
import { agent_app } from './app'

/**
 * Where the socket lives. One fixed path per profile: an agent should not have
 * to discover a port or be told a number (§43). It follows the profile as the
 * single-instance lock does, so the one cocoa that holds a profile's lock is
 * the one answering on its socket.
 */
export function socket_path(profile: Maybe<string>): string {
  const override = env_var('COCOA_SOCKET_PATH')
  if (override.is_present()) {
    return override.value
  }
  const file = `${in_profile('cocoa', profile)}.sock`
  const home = env_var('HOME')
  if (home.is_present()) {
    return path.join(home.value, '.local/share/cocoa', file)
  }
  return file
}

export interface AgentServer {
  close(): Promise<void>
}

/**
 * Binds the socket and serves it.
 *
 * A socket file already sitting at the path is deleted, not probed: a Unix
 * socket cannot listen where a file sits, dead or not, and nothing alive can
 * own it — the single-instance lock keeps this build to one cocoa, and the
 * dev build listens on its own file (`socket_path`).
 *
 * @throws when the socket cannot come up: the directory or file refuses
 *   (permissions), or the bind fails (`error` before `listening` — e.g. a
 *   path past the platform's socket-path limit). Resolving means listening;
 *   what a refusal costs is the caller's call — today's one caller crashes
 *   cocoa over it (`index.ts`).
 */
export async function serve(socket_path: string, deps: AgentDeps): Promise<AgentServer> {
  fs.mkdirSync(path.dirname(socket_path), { recursive: true })
  fs.rmSync(socket_path, { force: true })

  const server = http.createServer(agent_app(deps))
  server.listen(socket_path)
  // Resolves on `listening`, rejects if `error` comes first; either way both
  // listeners are cleaned up. Only past this line is the socket answerable.
  await once(server, 'listening')

  return {
    close: async () => {
      server.close()
      server.closeAllConnections()
      await once(server, 'close')
      fs.rmSync(socket_path, { force: true })
    }
  }
}
