// A restored or stale address can point at something the world no longer
// contains; `recover` repairs it, with a message.

import { campaign_run, job_run } from '@shared/world'
import { notify } from './notice'
import { app } from './state.svelte'
import { call_of, context_entity_id, entity_of, report_owner_id } from './world_queries'

/** Repairs a route — and closes an overlay — the world can no longer answer for. */
export function recover(): void {
  const route = app.route
  const world = app.world

  const entity_gone = (id: string): boolean => entity_of(id) === undefined

  // A confirmation about a run that is no longer listed has nothing left to
  // confirm; it closes rather than asking about a ghost.
  // An overlay with an operation in flight is left alone: it is about to
  // answer for itself, and closing it here would throw that answer away —
  // including the confirmation for a removal that has just succeeded.
  const overlay = app.overlay
  if (overlay !== null && overlay.kind !== 'refused' && !overlay.busy) {
    const gone =
      overlay.kind === 'confirm_remove'
        ? entity_gone(overlay.entity_id)
        : overlay.target.kind === 'job_run'
          ? job_run(world, overlay.target.job_id, overlay.target.run_id) === undefined
          : campaign_run(world, overlay.target.campaign_id, overlay.target.run_id) === undefined
    if (gone) {
      app.overlay = null
    }
  }

  switch (route.page) {
    case 'empty':
      return
    case 'entity':
    case 'start':
      if (entity_gone(route.entity_id)) {
        app.route = { page: 'empty' }
        notify('That experiment is no longer in the Explorer.')
      }
      return
    case 'job_run':
      if (job_run(world, route.job_id, route.run_id) === undefined) {
        app.route = entity_gone(route.job_id)
          ? { page: 'empty' }
          : { page: 'entity', entity_id: route.job_id }
        notify('That run is no longer listed.')
      }
      return
    case 'campaign_run':
      if (campaign_run(world, route.campaign_id, route.run_id) === undefined) {
        app.route = entity_gone(route.campaign_id)
          ? { page: 'empty' }
          : { page: 'entity', entity_id: route.campaign_id }
        notify('That run is no longer listed.')
      }
      return
    // Two runs have to still exist for this address to mean anything: the
    // dispatched run it shows, and the campaign run whose context it is seen in.
    // Losing the child falls back to the campaign run, which is where the user
    // came from; losing the campaign run itself falls back further.
    case 'campaign_child': {
      if (campaign_run(world, route.campaign_id, route.campaign_run_id) === undefined) {
        app.route = entity_gone(route.campaign_id)
          ? { page: 'empty' }
          : { page: 'entity', entity_id: route.campaign_id }
        notify('That run is no longer listed.')
        return
      }
      // The campaign's plan must still list the child, as a call's current run
      // or an earlier attempt (§8.5); if it does not, it is gone by the same test.
      const call = call_of(route.campaign_id, route.campaign_run_id, route.job_id, route.run_id)
      if (call === undefined || job_run(world, route.job_id, route.run_id) === undefined) {
        app.route = {
          page: 'campaign_run',
          campaign_id: route.campaign_id,
          run_id: route.campaign_run_id
        }
        notify('That dispatched run is no longer listed.')
      }
      return
    }
    case 'report': {
      // A report is read from disk on open, so the world cannot say whether
      // the file is still there; what it can say is whether the run and its
      // entity are still listed.
      const entity_id = context_entity_id(route.context)
      // A report opened from a dispatched run is a *job* run's report, even
      // though the context is the campaign's — the same two-addresses rule. The
      // owner is what says which map to look in, and for a dispatched run
      // that owner comes from the plan.
      const owner_id = report_owner_id(route.context)
      const run =
        route.context.kind === 'campaign_run'
          ? campaign_run(world, owner_id, route.run_id)
          : job_run(world, owner_id, route.run_id)
      if (run === undefined) {
        app.route = entity_gone(entity_id) ? { page: 'empty' } : { page: 'entity', entity_id }
        notify('That run is no longer listed.')
      }
      return
    }
  }
}
