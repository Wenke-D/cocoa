// Where the page is, and the gestures that move it.

import { campaign_run, job_run } from '@shared/world'
import type { JournalTarget } from './journal'
import { notify } from './notice'
import type { Route } from './route'
import { app } from './state.svelte'
import { entity_of } from './world_queries'

/** Which view the sidebar shows, chosen from the activity bar (§8.2). */
export type SidebarView = 'explorer' | 'runs' | 'events'

export function navigate(route: Route): void {
  app.route = route
}

/**
 * The activity bar's one gesture (§8.2): a view that is not open opens, and
 * clicking the open one collapses the sidebar.
 */
export function select_view(view: SidebarView): void {
  if (app.sidebar_open && app.sidebar_view === view) {
    app.sidebar_open = false
    return
  }
  app.sidebar_view = view
  app.sidebar_open = true
}

/** Takes the page to what a journal entry is about, if it is still there. */
export function go_to(target: JournalTarget): void {
  switch (target.kind) {
    case 'entity':
      if (entity_of(target.entity_id) === undefined) {
        notify('That experiment is no longer in the Explorer.')
        return
      }
      navigate({ page: 'entity', entity_id: target.entity_id })
      return
    case 'job_run':
      if (job_run(app.world, target.job_id, target.run_id) === undefined) {
        notify('That run is no longer listed.')
        return
      }
      navigate({ page: 'job_run', job_id: target.job_id, run_id: target.run_id })
      return
    case 'campaign_run':
      if (campaign_run(app.world, target.campaign_id, target.run_id) === undefined) {
        notify('That run is no longer listed.')
        return
      }
      navigate({ page: 'campaign_run', campaign_id: target.campaign_id, run_id: target.run_id })
  }
}
