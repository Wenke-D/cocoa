// What the page asks of the world it mirrors.

import { campaign_run, is_active, job_run } from '@shared/world'
import type { Entity } from '@shared/world'
import type { JournalEntry } from './journal'
import type { ReportContext } from './route'
import { app } from './state.svelte'

export function entity_of(id: string): Entity | undefined {
  return app.world.entities.find((entity) => entity.id === id)
}

/**
 * Which Explorer row stays highlighted — `Route::selected_entity`.
 *
 * Viewing a dispatched run through its campaign keeps the *campaign* selected, even
 * though the run belongs to a job that is in the Explorer too (§19). Arriving
 * that way must not move the selection to the job; the job's name on the page
 * is the explicit way there.
 */
export function selected_entity_id(): string | null {
  const route = app.route
  switch (route.page) {
    case 'empty':
      return null
    case 'entity':
    case 'start':
      return route.entity_id
    case 'job_run':
      return route.job_id
    case 'campaign_run':
    case 'campaign_child':
      return route.campaign_id
    case 'report':
      return context_entity_id(route.context)
  }
}

export function context_entity_id(context: ReportContext): string {
  return context.kind === 'job_run' ? context.job_id : context.campaign_id
}

/**
 * Whose folder the report file is actually in — which is not the same
 * question as whose context it is being read under. A run dispatched by a
 * campaign writes its report into the *job's* folder, because that is where the
 * run happened; the campaign is only how the reader arrived (§2.3.1, §20.1).
 */
export function report_owner_id(context: ReportContext, run_id: string): string {
  if (context.kind === 'campaign_child') {
    return (
      dispatched_owner(context.campaign_id, context.campaign_run_id, run_id) ?? context.campaign_id
    )
  }
  return context_entity_id(context)
}

/**
 * Which job a dispatched run belongs to, read from the campaign run's own plan.
 *
 * The plan is the only link between the two (§2.3.1): a run id means nothing
 * without the experiment it was allocated in, so there is no map to look a
 * bare child id up in.
 */
export function dispatched_owner(
  campaign_id: string,
  campaign_run_id: string,
  run_id: string
): string | undefined {
  const campaign = campaign_run(app.world, campaign_id, campaign_run_id)
  return campaign?.plan.steps.find((step) => step.run_id === run_id)?.job_id
}

/** Whether an entity has any active run — the sidebar's activity dot. */
export function has_active_run(entity: Entity): boolean {
  const world = app.world
  if (entity.kind === 'Job') {
    const ids = world.runs_by_job[entity.id] ?? []
    return ids.some((id) => {
      const run = job_run(world, entity.id, id)
      return run !== undefined && is_active(run.status)
    })
  }
  const ids = world.runs_by_campaign[entity.id] ?? []
  return ids.some((id) => {
    const run = campaign_run(world, entity.id, id)
    return run !== undefined && is_active(run.status)
  })
}

/** Top-bar count, mirroring `World::active_run_count`: direct job runs plus
 * campaign runs, never counting dispatched children twice. */
export function active_run_count(): number {
  const world = app.world
  const direct = Object.values(world.job_runs)
    .flatMap((runs) => Object.values(runs))
    .filter(
      (run) => is_active(run.status) && (run.origin === 'Human' || run.origin === 'Agent')
    ).length
  const campaigns = Object.values(world.campaign_runs)
    .flatMap((runs) => Object.values(runs))
    .filter((run) => is_active(run.status)).length
  return direct + campaigns
}

/** The newest thing that happened — what the status bar dates itself by. */
export function last_change(): JournalEntry | null {
  return app.journal.length === 0 ? null : app.journal[app.journal.length - 1]
}
