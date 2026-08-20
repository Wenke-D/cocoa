// The renderer's state module, compiled as runes (hence `.svelte.test.ts`).
//
// These cover what the state *holds*. They deliberately do not claim to cover
// what it *notifies*: `$effect` does not schedule in this environment (no DOM,
// no component tree), and `$derived` recomputes instead of caching, so a lost
// reactive notification passes every assertion here. That failure mode is
// real — an entity's first run once never lit its Explorer dot, with the data
// perfectly correct underneath — and it is caught where it shows: the
// `.active-dot` assertion in `scripts/scenarios/remove-folder.mjs`.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BenchPlanStep, BenchRun, CocoEvent, Entity, JobRun } from '@shared/world'
import { emptyWorld } from '@shared/world'
import {
  app,
  applyEvents,
  dismissNotice,
  hasActiveRun,
  navigate,
  notify,
  recover,
  reportOwnerId,
  selectedEntityId
} from '../src/renderer/src/state.svelte'

function entity(id: string, kind: 'Job' | 'Bench' = 'Job'): Entity {
  return {
    id,
    kind,
    name: id,
    path: `~/exp/${id}`,
    manifest: 'Valid',
    parameter_names: []
  }
}

function jobRun(id: string, jobId: string, extra: Partial<JobRun> = {}): JobRun {
  return {
    id,
    job_id: jobId,
    origin: 'Human',
    started_at: `2026-08-19T10:0${id}:00.000+02:00`,
    ended_at: null,
    parameters: '',
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    error: null,
    ...extra
  }
}

/**
 * `steps` is what the bench dispatched. It is not decoration: the plan is the
 * only link from a dispatched run back to the job that ran it (§2.3.1), now
 * that a run id means nothing without its experiment.
 */
function benchRun(id: string, benchId: string, steps: BenchPlanStep[] = []): BenchRun {
  return {
    id,
    bench_id: benchId,
    by: 'Human',
    started_at: '2026-08-19T10:00:00.000+02:00',
    ended_at: null,
    parameters: '',
    plan: { steps },
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    error: null
  }
}

function reset(): void {
  app.world = emptyWorld()
  app.route = { page: 'empty' }
  app.overlay = null
  app.menu = null
  app.notice = null
}

afterEach(reset)

function send(...events: CocoEvent[]): void {
  applyEvents(events)
}

describe('applyEvents', () => {
  it('indexes the very first run of an entity', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver') })

    expect(app.world.runs_by_job['solver']).toEqual(['0'])
    expect(hasActiveRun(app.world.entities[0])).toBe(true)
  })

  it('keeps a history oldest first, however the runs arrive', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: jobRun('2', 'solver') })
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver') })
    send({ kind: 'job-run-upserted', run: jobRun('1', 'solver') })

    expect(app.world.runs_by_job['solver']).toEqual(['0', '1', '2'])
  })

  it('upserts a run in place rather than listing it twice', () => {
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver') })
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver', { status: 'Succeeded' }) })

    expect(app.world.runs_by_job['solver']).toEqual(['0'])
    expect(app.world.job_runs['solver']['0'].status).toBe('Succeeded')
  })

  it('drops a removed run from the index as well as the map', () => {
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver') })
    send({ kind: 'job-run-removed', jobId: 'solver', id: '0' })

    expect(app.world.job_runs['solver']['0']).toBeUndefined()
    expect(app.world.runs_by_job['solver']).toEqual([])
  })

  it('tracks bench runs the same way', () => {
    send({ kind: 'entity-upserted', entity: entity('nightly', 'Bench') })
    send({ kind: 'bench-run-upserted', run: benchRun('7', 'nightly') })

    expect(app.world.runs_by_bench['nightly']).toEqual(['7'])
    expect(hasActiveRun(app.world.entities[0])).toBe(true)
  })
})

describe('recover', () => {
  it('leaves the route alone while the world still answers for it', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver') })
    navigate({ page: 'jobRun', jobId: 'solver', runId: '0' })

    recover()
    expect(app.route).toEqual({ page: 'jobRun', jobId: 'solver', runId: '0' })
  })

  it('falls back to the entity when its run is gone', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver') })
    navigate({ page: 'jobRun', jobId: 'solver', runId: '0' })

    send({ kind: 'job-run-removed', jobId: 'solver', id: '0' })
    expect(app.route).toEqual({ page: 'entity', entityId: 'solver' })
    expect(app.notice?.text).toContain('no longer listed')
  })

  it('falls back to empty when the entity itself is gone', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    navigate({ page: 'entity', entityId: 'solver' })

    send({ kind: 'entity-removed', id: 'solver' })
    expect(app.route).toEqual({ page: 'empty' })
  })

  it('recovers a report route through its context', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: jobRun('0', 'solver') })
    navigate({ page: 'report', context: { kind: 'jobRun', jobId: 'solver' }, runId: '0' })

    send({ kind: 'job-run-removed', jobId: 'solver', id: '0' })
    expect(app.route).toEqual({ page: 'entity', entityId: 'solver' })
  })

  // An overlay mid-operation answers for itself; closing it here would throw
  // that answer away — including the confirmation of a removal that worked.
  it('leaves a busy overlay open even when its subject disappears', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    app.overlay = { kind: 'confirmRemove', entityId: 'solver', error: null, busy: true }

    send({ kind: 'entity-removed', id: 'solver' })
    expect(app.overlay).not.toBeNull()

    app.overlay.busy = false
    recover()
    expect(app.overlay).toBeNull()
  })

  it('closes a context menu whose row is gone', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    app.menu = { entityId: 'solver', x: 10, y: 10 }

    send({ kind: 'entity-removed', id: 'solver' })
    expect(app.menu).toBeNull()
  })
})

// The transient message: one sentence, the newest one, and a failure that
// waits to be read (the backend's `notices.ts` decides *whether* to speak).
describe('notices', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows what the backend said, at the level it said it', () => {
    send({ kind: 'notice', level: 'error', text: 'poll script failed' })
    expect(app.notice).toEqual({ text: 'poll script failed', level: 'error' })
  })

  it('lets an ordinary message fade', () => {
    vi.useFakeTimers()
    notify('Folder added.')
    vi.advanceTimersByTime(4000)
    expect(app.notice).toBeNull()
  })

  // A failure that fades before it is read is the same as no failure shown.
  it('keeps a failure up until it is dismissed', () => {
    vi.useFakeTimers()
    send({ kind: 'notice', level: 'error', text: 'poll script failed' })
    vi.advanceTimersByTime(60_000)
    expect(app.notice?.text).toBe('poll script failed')

    dismissNotice()
    expect(app.notice).toBeNull()
  })

  it('replaces a standing failure with whatever happened since', () => {
    send({ kind: 'notice', level: 'error', text: 'poll script failed' })
    notify('Folder added.')
    expect(app.notice).toEqual({ text: 'Folder added.', level: 'info' })
  })

  // The older message's timer must not take down the newer one, which is why
  // the timer is keyed by a counter rather than by comparing the text.
  it('does not let an older timer clear a newer message', () => {
    vi.useFakeTimers()
    notify('Refreshed.')
    vi.advanceTimersByTime(3000)
    notify('Refreshed.')
    vi.advanceTimersByTime(1000)
    expect(app.notice?.text).toBe('Refreshed.')

    vi.advanceTimersByTime(3000)
    expect(app.notice).toBeNull()
  })
})

// One run, two addresses (§2.3.1): reached through its job, or through the
// bench that dispatched it. The record is the same; the context is not.
describe('a dispatched run seen through its bench', () => {
  function dispatched(): void {
    send({ kind: 'entity-upserted', entity: entity('nightly', 'Bench') })
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({
      kind: 'bench-run-upserted',
      run: benchRun('7', 'nightly', [{ index: 0, job_id: 'solver', parameters: '', run_id: '8' }])
    })
    send({ kind: 'job-run-upserted', run: jobRun('8', 'solver') })
  }

  // Arriving through the bench must not move the Explorer onto the job, even
  // though the job is right there in the Explorer too (§19).
  it('keeps the bench selected', () => {
    dispatched()
    navigate({ page: 'benchChild', benchId: 'nightly', benchRunId: '7', runId: '8' })
    expect(selectedEntityId()).toBe('nightly')
  })

  it('falls back to the bench run when the dispatched run goes', () => {
    dispatched()
    navigate({ page: 'benchChild', benchId: 'nightly', benchRunId: '7', runId: '8' })

    send({ kind: 'job-run-removed', jobId: 'solver', id: '8' })
    expect(app.route).toEqual({ page: 'benchRun', benchId: 'nightly', runId: '7' })
    expect(app.notice?.text).toContain('dispatched run')
  })

  it('falls back past the bench run when that goes too', () => {
    dispatched()
    navigate({ page: 'benchChild', benchId: 'nightly', benchRunId: '7', runId: '8' })

    send({ kind: 'bench-run-removed', benchId: 'nightly', id: '7' })
    expect(app.route).toEqual({ page: 'entity', entityId: 'nightly' })
  })

  // The report file lives where the run happened — in the job's folder — even
  // though the reader arrived through the bench.
  it('reads its report from the job that ran it', () => {
    dispatched()
    const context = { kind: 'benchChild', benchId: 'nightly', benchRunId: '7' } as const
    expect(reportOwnerId(context, '8')).toBe('solver')
  })

  it('recovers a report opened in the bench context', () => {
    dispatched()
    navigate({
      page: 'report',
      context: { kind: 'benchChild', benchId: 'nightly', benchRunId: '7' },
      runId: '8'
    })

    send({ kind: 'job-run-removed', jobId: 'solver', id: '8' })
    expect(app.route).toEqual({ page: 'entity', entityId: 'nightly' })
  })
})
