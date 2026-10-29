// What the page asks of the world it mirrors.

import { is_active } from '@shared/run_status'
import { campaign_run, job_run } from '@shared/world'
import type { CampaignPlanStep, Entity } from '@shared/world'
import type { JournalEntry } from './journal'
import type { ReportContext } from './route'
import { app } from './state.svelte'

export function entity_of(id: string): Entity | undefined {
  return app.world.entities.find((entity) => entity.id === id)
}

/** An entity's name, or what stands in for one the Explorer no longer lists. */
export function entity_name(entity: Entity | undefined): string {
  return entity?.name ?? '(removed)'
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
export function report_owner_id(context: ReportContext): string {
  return context.kind === 'campaign_child' ? context.job_id : context_entity_id(context)
}

/**
 * The campaign run's call a dispatched run was, as its current run or one of
 * its earlier attempts (convention §8.5), read from the campaign run's own
 * plan: the plan is the only link between the two (§2.3.1). A run id means
 * nothing without its job, since ids are per experiment, so both name it.
 */
export function call_of(
  campaign_id: string,
  campaign_run_id: string,
  job_id: string,
  run_id: string
): CampaignPlanStep | undefined {
  const campaign = campaign_run(app.world, campaign_id, campaign_run_id)
  return campaign?.plan.steps.find(
    (step) => step.job_id === job_id && (step.run_id === run_id || step.attempts.includes(run_id))
  )
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
