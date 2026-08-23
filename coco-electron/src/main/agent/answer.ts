// The agent module's shared vocabulary: what the socket needs from the rest
// of the process, and the one shape every reply takes.

import type { StartResult, World } from '@shared/world'

/** What the socket needs from the rest of the process, and nothing more. */
export interface AgentDeps {
  /** The world the window is rendering from, as it last saw it. */
  current_world: () => World
  /** Starts an experiment by name, stamped as the agent's (§43). */
  start(name: string, parameters: Record<string, unknown>): Promise<StartResult>
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
