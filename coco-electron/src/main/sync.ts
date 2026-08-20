// What the renderer is told, and when. The backend is the only party that
// judges change: it keeps its own model of the world, rebuilds it each cycle,
// and turns the difference into events. The renderer bootstraps once and then
// only ever hears conclusions.

import type { CocoEvent, RunsByEntity, World } from '@shared/world'

/**
 * Entry identity for change detection, with the always-churning
 * `last_successful_query` stamp excluded — it would make every entry
 * "changed" on every rebuild, the entry-level version of the last_refresh
 * trap. When query health actually flips, other fields change with it.
 */
function identity(entry: object): string {
  return JSON.stringify({ ...entry, last_successful_query: undefined })
}

/**
 * The events that carry `previous` to `next`. Upserts carry the whole entry:
 * entry-level over-push, never field diffs (the v1 protocol — see the sync
 * design note).
 */
export function diffWorlds(previous: World, next: World): CocoEvent[] {
  const events: CocoEvent[] = []

  const previousEntities = new Map(previous.entities.map((entity) => [entity.id, entity]))
  for (const entity of next.entities) {
    const old = previousEntities.get(entity.id)
    if (old === undefined || JSON.stringify(old) !== JSON.stringify(entity)) {
      events.push({ kind: 'entity-upserted', entity })
    }
    previousEntities.delete(entity.id)
  }
  for (const id of previousEntities.keys()) {
    events.push({ kind: 'entity-removed', id })
  }

  diffRuns(
    previous.job_runs,
    next.job_runs,
    events,
    (run) => ({
      kind: 'job-run-upserted',
      run
    }),
    (jobId, id) => ({ kind: 'job-run-removed', jobId, id })
  )

  diffRuns(
    previous.bench_runs,
    next.bench_runs,
    events,
    (run) => ({
      kind: 'bench-run-upserted',
      run
    }),
    (benchId, id) => ({ kind: 'bench-run-removed', benchId, id })
  )

  return events
}

/**
 * The same walk for both run kinds, now two levels deep: an experiment, then
 * its runs. An experiment that has gone entirely still yields one removal per
 * run it had — the renderer is told about runs, not about the absence of a
 * container.
 */
function diffRuns<T extends object>(
  previous: RunsByEntity<T>,
  next: RunsByEntity<T>,
  events: CocoEvent[],
  upserted: (run: T) => CocoEvent,
  removed: (entityId: string, runId: string) => CocoEvent
): void {
  for (const [entityId, runs] of Object.entries(next)) {
    const before = previous[entityId] ?? {}
    for (const [id, run] of Object.entries(runs)) {
      const old = before[id]
      if (old === undefined || identity(old) !== identity(run)) events.push(upserted(run))
    }
  }
  for (const [entityId, runs] of Object.entries(previous)) {
    const after = next[entityId] ?? {}
    for (const id of Object.keys(runs)) {
      if (!(id in after)) events.push(removed(entityId, id))
    }
  }
}
