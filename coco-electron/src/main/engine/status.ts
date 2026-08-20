// The closed status vocabulary (convention §9). Port of engine/status.rs.
// Scripts speak this vocabulary; the engine never learns new state names at
// runtime. Serialized UPPERCASE in run.json, exactly as serde writes it.

export type Status =
  | 'STARTING'
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'ANALYZING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'UNREACHABLE'
  | 'ERROR'

const TERMINAL: readonly Status[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'ERROR']

export function isTerminal(status: Status): boolean {
  return TERMINAL.includes(status)
}

export function isActive(status: Status): boolean {
  return !isTerminal(status)
}

export function isCancellable(status: Status): boolean {
  return (
    status === 'STARTING' || status === 'PENDING' || status === 'RUNNING' || status === 'UNREACHABLE'
  )
}

/** The cluster's words come from `poll` and nowhere else (§9). */
export function fromPollWord(word: string): Status | null {
  switch (word) {
    case 'PENDING':
    case 'RUNNING':
    case 'COMPLETED':
    case 'FAILED':
    case 'CANCELLED':
      return word
    default:
      return null
  }
}
