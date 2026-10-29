// The modals: opening one, and what confirming it asks of the backend.

import type {
  CancelResult,
  CancelTarget,
  DeleteResult,
  DeleteTarget,
  RemoveFolderResult,
  RerunReportResult
} from '@shared/protocol'
import { navigate } from './navigation'
import { notify } from './notice'
import type { Route } from './route'
import { app } from './state.svelte'
import { selected_entity_id } from './world_queries'

/**
 * A modal is a temporary action, not a place (specification §9), so it is
 * kept out of `Route` — it is never persisted and never restored.
 */
export type Overlay =
  | ({ error: string | null; busy: boolean } & (
      | { kind: 'confirm_cancel'; target: CancelTarget }
      | { kind: 'confirm_delete'; target: DeleteTarget }
      | { kind: 'confirm_remove'; entity_id: string }
      | { kind: 'confirm_regenerate'; target: RegenerateMembersTarget }
    ))
  /** A refusal that has to be read before anything else happens (§22.6). */
  | { kind: 'refused'; title: string; message: string }

/**
 * A campaign run whose members' reports, then its own, are to be regenerated:
 * addressed as a campaign run's delete is, so `recover` closes it the same way.
 */
export interface RegenerateMembersTarget {
  kind: 'campaign_run'
  campaign_id: string
  run_id: string
}

/** Opens the confirmation for regenerating every member's report first (§16.5). */
export function request_regenerate_members(target: RegenerateMembersTarget): void {
  app.overlay = { kind: 'confirm_regenerate', target, error: null, busy: false }
}

/**
 * Asks for every member's report of the campaign run, then its own (convention
 * §8.3). Accepted, the run already reads `Analyzing` — its events precede the
 * answer — and the modal closes; the Report row says the rest. A refusal keeps
 * the modal open with the reason.
 */
export async function confirm_regenerate(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirm_regenerate' || overlay.busy) {
    return
  }
  overlay.busy = true
  overlay.error = null
  let result: RerunReportResult
  try {
    result = await window.cocoa.rerun_report({
      entity_id: overlay.target.campaign_id,
      run_id: overlay.target.run_id,
      members: true
    })
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (app.overlay !== overlay) {
    return
  }
  if (result.ok) {
    app.overlay = null
    return
  }
  overlay.busy = false
  overlay.error = result.message
  notify(result.message, 'error')
}

export function request_cancel(target: CancelTarget): void {
  app.overlay = { kind: 'confirm_cancel', target, error: null, busy: false }
}

/** Opens the delete confirmation (§16.4); the modal is the second look. */
export function request_delete(target: DeleteTarget): void {
  app.overlay = { kind: 'confirm_delete', target, error: null, busy: false }
}

/**
 * Deletes the run the open modal points at. On success the run is gone from
 * the world before the modal closes (the events ride the same answer), and
 * a page that was looking at that run steps back to the experiment.
 */
export async function confirm_delete(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirm_delete' || overlay.busy) {
    return
  }
  overlay.busy = true
  overlay.error = null
  let result: DeleteResult
  try {
    result = await window.cocoa.delete_run($state.snapshot(overlay.target))
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (app.overlay !== overlay) {
    return
  }
  if (result.ok) {
    const target = overlay.target
    app.overlay = null
    const entity_id = target.kind === 'job_run' ? target.job_id : target.campaign_id
    if (route_shows_run(app.route, target)) {
      navigate({ page: 'entity', entity_id })
    }
    notify(`Run ${target.run_id} deleted.`)
    return
  }
  overlay.busy = false
  overlay.error = result.message
  notify(result.message, 'error')
}

/**
 * Whether `route` is looking at the deleted run — its page, or its report.
 * A run has two addresses (§19): a deleted job run may be on screen as a
 * campaign's child, where the route names the campaign, so that page steps back
 * on the run id alone; a same-id run of another job is a near miss this
 * accepts, since stepping back from a page is cheap and a page showing a
 * deleted run is not.
 */
function route_shows_run(route: Route, target: DeleteTarget): boolean {
  if (route.page === 'job_run' && target.kind === 'job_run') {
    return route.job_id === target.job_id && route.run_id === target.run_id
  }
  if (route.page === 'campaign_run' && target.kind === 'campaign_run') {
    return route.campaign_id === target.campaign_id && route.run_id === target.run_id
  }
  if (route.page === 'campaign_child' || route.page === 'report') {
    return route.run_id === target.run_id
  }
  return false
}

export function request_remove(entity_id: string): void {
  app.overlay = { kind: 'confirm_remove', entity_id, error: null, busy: false }
}

export function close_overlay(): void {
  app.overlay = null
}

/**
 * Takes the folder out of the Explorer (§36 — removed from the Explorer, not
 * deleted from disk). As with cancel, the overlay stays open until the
 * backend answers: closed by success, annotated by failure.
 */
export async function confirm_remove(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirm_remove' || overlay.busy) {
    return
  }
  overlay.busy = true
  overlay.error = null

  // Leave the entity's page *before* asking, so `recover()` has nothing to
  // repair: its message ("that run is no longer listed") explains an
  // accident, and this is not one — the user asked for it. The route is put
  // back if the removal is refused.
  const previous = app.route
  if (selected_entity_id() === overlay.entity_id) {
    app.route = { page: 'empty' }
  }

  let result: RemoveFolderResult
  try {
    result = await window.cocoa.remove_folder(overlay.entity_id)
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }

  if (app.overlay !== overlay) {
    return
  }
  if (result.ok) {
    app.overlay = null
    notify('Removed from the Explorer. The folder is untouched on disk.')
    return
  }
  app.route = previous
  overlay.busy = false
  overlay.error = result.message
  notify(result.message, 'error')
}

/**
 * Confirms the open cancel. The overlay stays open until the backend answers:
 * closed by success, annotated by failure. The user is left where they were
 * either way (§16.3) — a cancel is not a navigation.
 */
export async function confirm_cancel(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirm_cancel' || overlay.busy) {
    return
  }
  overlay.busy = true
  overlay.error = null

  // `$state.snapshot` because a proxy cannot cross IPC: structured clone
  // refuses it, and the rejection would otherwise leave this overlay busy
  // for ever. Nothing here may wedge the modal, so the call is guarded too.
  let result: CancelResult
  try {
    result = await window.cocoa.cancel($state.snapshot(overlay.target))
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }

  // The user may have dismissed it while the script ran; that overlay is
  // gone, and its answer is not this one's business.
  if (app.overlay !== overlay) {
    return
  }
  if (result.ok) {
    app.overlay = null
    return
  }
  overlay.busy = false
  overlay.error = result.message
  notify(result.message, 'error')
}
