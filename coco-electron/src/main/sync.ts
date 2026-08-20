// What the renderer is told, and when. The backend is the only party that
// judges change: it keeps its own model of the world, rebuilds it each cycle,
// and turns the difference into events. The renderer bootstraps once and then
// only ever hears conclusions.

import type { CocoEvent, World } from '@shared/world'

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

  for (const [id, run] of Object.entries(next.job_runs)) {
    const old = previous.job_runs[id]
    if (old === undefined || identity(old) !== identity(run)) {
      events.push({ kind: 'job-run-upserted', run })
    }
  }
  for (const id of Object.keys(previous.job_runs)) {
    if (!(id in next.job_runs)) events.push({ kind: 'job-run-removed', id })
  }

  for (const [id, run] of Object.entries(next.bench_runs)) {
    const old = previous.bench_runs[id]
    if (old === undefined || identity(old) !== identity(run)) {
      events.push({ kind: 'bench-run-upserted', run })
    }
  }
  for (const id of Object.keys(previous.bench_runs)) {
    if (!(id in next.bench_runs)) events.push({ kind: 'bench-run-removed', id })
  }

  return events
}
