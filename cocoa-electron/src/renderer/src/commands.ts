// The asks that need no modal: each is answered with a notice at most.

import type {
  AddFolderResult,
  AttachmentsTarget,
  LockReportResult,
  LockReportTarget,
  OpenAttachmentsResult,
  RerunReportResult,
  RerunReportTarget,
  SaveReportResult,
  SaveReportTarget,
  VisualizeResult,
  VisualizeTarget
} from '@shared/protocol'
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
 * Regenerates a job run's or a campaign run's report by hand (convention
 * §7.3.2, §8.3). Accepted, the run
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
 * Locks or unlocks a run's report (convention §7.3.3). The button shows the
 * new state once the world does, so success says nothing; a refusal is said.
 */
export async function lock_report(target: LockReportTarget): Promise<void> {
  let result: LockReportResult
  try {
    result = await window.cocoa.lock_report(target)
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (!result.ok) {
    notify(result.message, 'error')
  }
}

/**
 * Saves a copy of a run's report where the person picks. Closing the dialog
 * says nothing; a saved copy is said with where it went, a refusal as an error.
 */
export async function save_report(target: SaveReportTarget): Promise<void> {
  let result: SaveReportResult
  try {
    result = await window.cocoa.save_report(target)
  } catch (error) {
    result = { ok: false, cancelled: false, message: (error as Error).message }
  }
  if (result.ok) {
    notify(`Report saved to ${result.path}.`)
  } else if (!result.cancelled) {
    notify(result.message, 'error')
  }
}

/**
 * Opens a run's report attachments in the system file manager. Opening says
 * nothing; a refusal, or a file manager that would not open, is said.
 */
export async function open_attachments(target: AttachmentsTarget): Promise<void> {
  let result: OpenAttachmentsResult
  try {
    result = await window.cocoa.open_attachments(target)
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (!result.ok) {
    notify(result.message, 'error')
  }
}

/**
 * Opens the experiment's viewer on a run. Starting says nothing — the viewer
 * appearing is the answer; a refusal, or a viewer that would not start, is
 * said. One that fails later arrives as a notice from the backend.
 */
export async function visualize(target: VisualizeTarget): Promise<void> {
  let result: VisualizeResult
  try {
    result = await window.cocoa.visualize(target)
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
