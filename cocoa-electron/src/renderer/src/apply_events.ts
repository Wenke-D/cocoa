// The backend's messages, applied to the model: the bootstrap, then event
// batches.

import type { CampaignRun, CocoaEvent, JobRun, RunsByEntity } from '@shared/world'
import { JOURNAL_LENGTH, sentences_of, stamp } from './journal'
import type { JournalEntry } from './journal'
import { notify } from './notice'
import { recover } from './recover'
import { app } from './state.svelte'

/** The one full-state message: a fresh page owns nothing. */
export async function bootstrap(): Promise<void> {
  const payload = await window.cocoa.bootstrap()
  app.world = payload.world
  // A fresh page owns nothing, the journal included: what happened before
  // this page existed is not something it saw.
  app.journal = []
  app.connected = true
  // The route is the empty page until someone navigates, but a reconnecting
  // page may be mid-session: an address pointing at something the world no
  // longer contains is repaired now.
  recover()
}

/**
 * Applies one batch of backend events. The renderer never judges change —
 * the backend already did; this only makes the model say what it was told.
 */
export function apply_events(events: CocoaEvent[]): void {
  const world = app.world
  const at = stamp()
  for (const event of events) {
    // The sentence is judged against the entry as it was, so before the
    // event lands.
    for (const entry of sentences_of(world, event, at)) {
      remember(entry)
    }
    switch (event.kind) {
      case 'entity-upserted': {
        const at = world.entities.findIndex((entity) => entity.id === event.entity.id)
        if (at >= 0) {
          world.entities[at] = event.entity
        } else {
          world.entities.push(event.entity)
        }
        break
      }
      case 'entity-removed':
        world.entities = world.entities.filter((entity) => entity.id !== event.id)
        break
      case 'job-run-upserted':
        upsert_run(world.job_runs, world.runs_by_job, event.run, event.run.job_id)
        break
      case 'job-run-removed':
        remove_run(world.job_runs, world.runs_by_job, event.job_id, event.id)
        break
      case 'campaign-run-upserted':
        upsert_run(world.campaign_runs, world.runs_by_campaign, event.run, event.run.campaign_id)
        break
      case 'campaign-run-removed':
        remove_run(world.campaign_runs, world.runs_by_campaign, event.campaign_id, event.id)
        break
      case 'refreshed':
        world.last_refresh = event.at
        app.connected = true
        break
      // The backend already decided this was worth saying, and how loudly;
      // the renderer only shows it.
      case 'notice':
        notify(event.text, event.level)
        break
    }
  }
  recover()
}

/** Inserts into the entity's index sorted by start time, oldest first. */
function upsert_run<Run extends { id: string; started_at: string }>(
  runs: RunsByEntity<Run>,
  index: Record<string, string[]>,
  run: Run,
  owner_id: string
): void {
  // Read both back after creating them. `x[o] ?? (x[o] = {})` hands back the
  // raw value the assignment evaluated to, not the `$state` proxy that now
  // stands in its place — every later write would then go through the back of
  // the store and change nothing on screen. That is why an entity's *first*
  // run never lit its Explorer dot, and it applies to the run map for exactly
  // the same reason it applies to the index.
  if (runs[owner_id] === undefined) {
    runs[owner_id] = {}
  }
  const mine = runs[owner_id]
  mine[run.id] = run

  if (index[owner_id] === undefined) {
    index[owner_id] = []
  }
  const list = index[owner_id]
  const existing = list.indexOf(run.id)
  if (existing >= 0) {
    list.splice(existing, 1)
  }
  const start_ms = Date.parse(run.started_at)
  let position = list.length
  for (let i = 0; i < list.length; i += 1) {
    const other = mine[list[i]]
    if (other !== undefined && Date.parse(other.started_at) > start_ms) {
      position = i
      break
    }
  }
  list.splice(position, 0, run.id)
}

/**
 * The event names the owner: a run id is unique only within its owner, so a
 * bare id could not be looked up across every index.
 */
function remove_run(
  runs: RunsByEntity<JobRun> | RunsByEntity<CampaignRun>,
  index: Record<string, string[]>,
  owner_id: string,
  id: string
): void {
  const mine = runs[owner_id]
  if (mine !== undefined) {
    delete mine[id]
  }
  const list = index[owner_id]
  if (list === undefined) {
    return
  }
  const at = list.indexOf(id)
  if (at >= 0) {
    list.splice(at, 1)
  }
}

/** Keeps the newest `JOURNAL_LENGTH`. */
function remember(entry: JournalEntry): void {
  app.journal.push(entry)
  if (app.journal.length > JOURNAL_LENGTH) {
    app.journal.splice(0, app.journal.length - JOURNAL_LENGTH)
  }
}
