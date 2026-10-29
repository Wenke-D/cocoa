// The renderer's state as the tests drive it: world builders, events sent as
// the backend would send them, and a reset between tests. The `.svelte.ts`
// modules behind it are compiled as runes.
//
// The tests cover what the state *holds*. They deliberately do not claim to cover
// what it *notifies*: `$effect` does not schedule in this environment (no DOM,
// no component tree), and `$derived` recomputes instead of caching, so a lost
// reactive notification passes every assertion here. That failure mode is
// real — an entity's first run once never lit its Explorer dot, with the data
// perfectly correct underneath — and it is caught where it shows: the
// `.active-dot` assertion in `scripts/scenarios/remove-folder.mjs`.

import type { CocoaEvent } from '@shared/protocol'
import type { CampaignPlanStep, CampaignRun, Entity, JobRun } from '@shared/world'
import { empty_world } from '@shared/world'
import { apply_events } from '../../../src/renderer/src/apply_events'
import { app } from '../../../src/renderer/src/state.svelte'

export function entity(id: string, kind: 'Job' | 'Campaign' = 'Job'): Entity {
  return {
    id,
    kind,
    name: id,
    description: null,
    path: `~/exp/${id}`,
    manifest: 'Valid',
    parameters: []
  }
}

export function job_run(id: string, job_id: string, extra: Partial<JobRun> = {}): JobRun {
  return {
    id,
    job_id: job_id,
    origin: 'Human',
    started_at: `2026-08-19T10:0${id}:00.000+02:00`,
    ended_at: null,
    parameters: '',
    params: {},
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    report_error: null,
    report_rerunnable: false,
    report_locked: false,
    attachments: 0,
    visualizable: false,
    deploy: null,
    error: null,
    ...extra
  }
}

/**
 * `steps` is what the campaign dispatched. It is not decoration: the plan is the
 * only link from a dispatched run back to the job that ran it (§2.3.1), since
 * a run id means nothing without its experiment.
 */
export function campaign_run(
  id: string,
  campaign_id: string,
  steps: CampaignPlanStep[] = []
): CampaignRun {
  return {
    id,
    campaign_id: campaign_id,
    by: 'Human',
    started_at: '2026-08-19T10:00:00.000+02:00',
    ended_at: null,
    parameters: '',
    params: {},
    plan: { steps },
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    report_rerunnable: false,
    members_rerunnable: false,
    members_regenerating: null,
    report_locked: false,
    attachments: 0,
    visualizable: false,
    error: null
  }
}

export function reset(): void {
  app.world = empty_world()
  app.route = { page: 'empty' }
  app.overlay = null
  app.prefill = null
  app.notice = null
  app.journal = []
  app.sidebar_view = 'explorer'
  app.sidebar_open = true
}

export function send(...events: CocoaEvent[]): void {
  apply_events(events)
}
