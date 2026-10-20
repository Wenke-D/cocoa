// What a run's status means for what may be done with it.

import type { JobRun, RunStatus } from './world'

const TERMINAL: readonly RunStatus[] = ['Succeeded', 'Failed', 'Cancelled', 'Error']

export function is_terminal(status: RunStatus): boolean {
  return TERMINAL.includes(status)
}

export function is_active(status: RunStatus): boolean {
  return !is_terminal(status)
}

/**
 * Whether a job run can be deleted from its own page or row: finished, not
 * dispatched by a campaign (§16.4), and with no report still being written for
 * it — a `Failed` run's report runs after its verdict (convention §12.1).
 */
export function is_deletable(run: JobRun): boolean {
  return is_terminal(run.status) && typeof run.origin === 'string' && run.report !== 'Generating'
}

const CANCELLABLE: readonly RunStatus[] = ['Starting', 'Pending', 'Running']

/**
 * Whether a run is still the cluster's to stop. `Cancelling` is excluded: the
 * request is already in flight, and asking twice is not a second answer. An
 * unreachable run displays as `Running`, and is cancellable — not knowing its
 * status is no reason to be unable to stop it.
 */
export function is_cancellable(status: RunStatus): boolean {
  return CANCELLABLE.includes(status)
}
