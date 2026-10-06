// What happened — the Events view's material (§11.1). The backend says what
// changed, as upserts carrying whole entries; this side already holds the
// entry as it was, so what moved is its to say: a run that started and by
// whom, a status that changed, a report that landed, a folder that came or
// went. Nothing is sent for it, nothing is kept but the last hundred, and a
// fresh page starts with none.

import { origin_label, trigger_label } from '@shared/world'
import type {
  CampaignRun,
  CocoaEvent,
  JobRun,
  QueryHealth,
  ReportState,
  RunStatus,
  World
} from '@shared/world'

/** Where an entry points, if anywhere: a click on it goes there. */
export type JournalTarget =
  | { kind: 'entity'; entity_id: string }
  | { kind: 'job_run'; job_id: string; run_id: string }
  | { kind: 'campaign_run'; campaign_id: string; run_id: string }

/** What an event means, which is what colours it: good news, bad, a warning, or just news. */
export type Tone = 'neutral' | 'info' | 'good' | 'bad' | 'warn'

/** One thing that happened: when, to what, and what. */
export interface JournalEntry {
  at: string
  /** The experiment's name; empty for a failure that is nobody's. */
  name: string
  /** The run it is about, or `null` for an experiment's own news. */
  run: string | null
  what: string
  tone: Tone
  target: JournalTarget | null
}

export const JOURNAL_LENGTH = 100

/** The moment an event batch lands, for the entries it yields. */
export function stamp(): string {
  return new Date().toISOString()
}

/**
 * The entries one event deserves, judged against the world as it is *before*
 * the event lands. Usually one; a run can move and deliver its report in the
 * same pass; most events deserve none.
 */
export function sentences_of(world: World, event: CocoaEvent, at: string): JournalEntry[] {
  const entries: JournalEntry[] = []
  const tell = (
    name: string,
    run: string | null,
    what: string,
    tone: Tone,
    target: JournalTarget | null
  ): void => {
    entries.push({ at, name, run, what, tone, target })
  }

  switch (event.kind) {
    case 'entity-upserted': {
      const entity = event.entity
      const old = world.entities.find((candidate) => candidate.id === entity.id)
      const target: JournalTarget = { kind: 'entity', entity_id: entity.id }
      if (old === undefined) {
        tell(entity.name, null, 'added', 'info', target)
        break
      }
      const was_usable = old.manifest === 'Valid'
      const usable = entity.manifest === 'Valid'
      if (was_usable && !usable) {
        tell(entity.name, null, 'manifest unusable', 'warn', target)
      } else if (!was_usable && usable) {
        tell(entity.name, null, 'manifest usable again', 'good', target)
      }
      break
    }
    case 'entity-removed': {
      const old = world.entities.find((candidate) => candidate.id === event.id)
      if (old !== undefined) {
        tell(old.name, null, 'removed from the Explorer', 'neutral', null)
      }
      break
    }
    case 'job-run-upserted': {
      const run = event.run
      const name = name_in(world, run.job_id)
      const target: JournalTarget = { kind: 'job_run', job_id: run.job_id, run_id: run.id }
      const old = world.job_runs[run.job_id]?.[run.id]
      if (old === undefined) {
        tell(name, run.id, `started by ${origin_label(run.origin)}`, 'info', target)
        break
      }
      run_moves(name, old, run, target, tell)
      break
    }
    case 'job-run-removed':
      tell(name_in(world, event.job_id), event.id, 'no longer listed', 'neutral', null)
      break
    case 'campaign-run-upserted': {
      const run = event.run
      const name = name_in(world, run.campaign_id)
      const target: JournalTarget = {
        kind: 'campaign_run',
        campaign_id: run.campaign_id,
        run_id: run.id
      }
      const old = world.campaign_runs[run.campaign_id]?.[run.id]
      if (old === undefined) {
        const calls = run.plan.steps.length
        const by = `started by ${trigger_label(run.by)}, ${calls} ${calls === 1 ? 'call' : 'calls'}`
        tell(name, run.id, by, 'info', target)
        break
      }
      run_moves(name, old, run, target, tell)
      break
    }
    case 'campaign-run-removed':
      tell(name_in(world, event.campaign_id), event.id, 'no longer listed', 'neutral', null)
      break
    // A failure the user is told about is also something that happened.
    case 'notice':
      if (event.level === 'error') {
        tell('', null, event.text, 'bad', null)
      }
      break
    case 'refreshed':
      break
  }
  return entries
}

/** The moves a job run and a campaign run have in common. */
function run_moves(
  name: string,
  old: JobRun | CampaignRun,
  run: JobRun | CampaignRun,
  target: JournalTarget,
  tell: (name: string, run: string | null, what: string, tone: Tone, target: JournalTarget) => void
): void {
  // What, never why: the reason — an error's, a poll's — is on the run's page,
  // one click away, and too long for a line here.
  if (old.status !== run.status) {
    tell(name, run.id, run.status, tone_of(run.status), target)
  }
  if (!unreachable(old.query_health) && unreachable(run.query_health)) {
    tell(name, run.id, 'unreachable', 'warn', target)
  } else if (unreachable(old.query_health) && !unreachable(run.query_health)) {
    tell(name, run.id, 'reachable again', 'good', target)
  }
  if (!available(old.report) && available(run.report)) {
    tell(name, run.id, 'report ready', 'good', target)
  }
}

/** A status's tone — the same reading `StatusPill` gives its dot. */
export function tone_of(status: RunStatus): Tone {
  if (status === 'Succeeded') {
    return 'good'
  }
  if (status === 'Failed' || status === 'Error') {
    return 'bad'
  }
  if (status === 'Cancelled' || status === 'Cancelling') {
    return 'neutral'
  }
  return 'info'
}

/** An experiment's name, or the last path segment when it is not listed. */
function name_in(world: World, id: string): string {
  return world.entities.find((entity) => entity.id === id)?.name ?? (id.split('/').pop() || id)
}

function unreachable(health: QueryHealth): health is { Unavailable: { message: string } } {
  return typeof health === 'object'
}

function available(report: ReportState): boolean {
  return typeof report === 'object' && 'Available' in report
}
