// The asks that need no modal: each is answered with a notice at most.

import type { AddFolderResult, RerunReportResult, RerunReportTarget } from '@shared/protocol'
import { notify } from './notice'
import { app } from './state.svelte'

/**
 * Opens the folder picker and registers what comes back (§11.5). Cancelling
 * does nothing at all; a registration selects the folder it added, so the
 * user lands on the result of their action rather than wherever they were.
 */
export async function add_folder(): Promise<void> {
  let result: AddFolderResult
  try {
    result = await window.cocoa.add_folder()
  } catch (error) {
    notify((error as Error).message, 'error')
    return
  }
  if (!result.ok) {
    if (result.cancelled) {
      return
    }
    notify(result.message, 'error')
    return
  }
  app.route = { page: 'entity', entity_id: result.entity_id }
  notify(result.already ? 'That folder is already in the Explorer.' : 'Folder added.')
}

/**
 * Re-runs a job run's report by hand (convention §7.3.2). Accepted, the run
 * already reads `Generating` — its events precede the answer — so success
 * says nothing more; a refusal is said, as an error. How the report itself
 * went arrives later, the way an automatic report's does: on the run, and
 * as a notice when it failed.
 */
export async function rerun_report(target: RerunReportTarget): Promise<void> {
  let result: RerunReportResult
  try {
    result = await window.cocoa.rerun_report(target)
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (!result.ok) {
    notify(result.message, 'error')
  }
}

/**
 * The status bar's refresh (§8.5). It always answers — the backend sends the
 * notice, success included — so nothing is said here; only the transport
 * failing is this side's to report.
 */
export async function refresh_now(): Promise<void> {
  try {
    await window.cocoa.refresh_now()
  } catch (error) {
    notify((error as Error).message, 'error')
  }
}
