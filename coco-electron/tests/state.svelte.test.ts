// The renderer's state module, compiled as runes (hence `.svelte.test.ts`).
//
// These cover what the state *holds*. They deliberately do not claim to cover
// what it *notifies*: `$effect` does not schedule in this environment (no DOM,
// no component tree), and `$derived` recomputes instead of caching, so a lost
// reactive notification passes every assertion here. That failure mode is
// real — an entity's first run once never lit its Explorer dot, with the data
// perfectly correct underneath — and it is caught where it shows: the
// `.active-dot` assertion in `scripts/scenarios/remove-folder.mjs`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BenchPlanStep, BenchRun, CocoEvent, Entity, JobRun } from '@shared/world'
import { empty_world } from '@shared/world'
import {
  app,
  apply_events,
  dismiss_notice,
  go_to,
  has_active_run,
  last_change,
  navigate,
  notify,
  prefill_start,
  recover,
  report_owner_id,
  select_view,
  selected_entity_id,
  start_again,
  take_prefill
} from '../src/renderer/src/state.svelte'

function entity(id: string, kind: 'Job' | 'Bench' = 'Job'): Entity {
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

function job_run(id: string, job_id: string, extra: Partial<JobRun> = {}): JobRun {
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
    error: null,
    ...extra
  }
}

/**
 * `steps` is what the bench dispatched. It is not decoration: the plan is the
 * only link from a dispatched run back to the job that ran it (§2.3.1), now
 * that a run id means nothing without its experiment.
 */
function bench_run(id: string, bench_id: string, steps: BenchPlanStep[] = []): BenchRun {
  return {
    id,
    bench_id: bench_id,
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
    error: null
  }
}

function reset(): void {
  app.world = empty_world()
  app.route = { page: 'empty' }
  app.overlay = null
  app.prefill = null
  app.notice = null
  app.journal = []
  app.sidebar_view = 'explorer'
  app.sidebar_open = true
}

afterEach(reset)

function send(...events: CocoEvent[]): void {
  apply_events(events)
}

describe('apply_events', () => {
  it('indexes the very first run of an entity', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })

    expect(app.world.runs_by_job['solver']).toEqual(['0'])
    expect(has_active_run(app.world.entities[0])).toBe(true)
  })

  it('keeps a history oldest first, however the runs arrive', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: job_run('2', 'solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })
    send({ kind: 'job-run-upserted', run: job_run('1', 'solver') })

    expect(app.world.runs_by_job['solver']).toEqual(['0', '1', '2'])
  })

  it('upserts a run in place rather than listing it twice', () => {
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver', { status: 'Succeeded' }) })

    expect(app.world.runs_by_job['solver']).toEqual(['0'])
    expect(app.world.job_runs['solver']['0'].status).toBe('Succeeded')
  })

  it('drops a removed run from the index as well as the map', () => {
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })
    send({ kind: 'job-run-removed', job_id: 'solver', id: '0' })

    expect(app.world.job_runs['solver']['0']).toBeUndefined()
    expect(app.world.runs_by_job['solver']).toEqual([])
  })

  it('tracks bench runs the same way', () => {
    send({ kind: 'entity-upserted', entity: entity('nightly', 'Bench') })
    send({ kind: 'bench-run-upserted', run: bench_run('7', 'nightly') })

    expect(app.world.runs_by_bench['nightly']).toEqual(['7'])
    expect(has_active_run(app.world.entities[0])).toBe(true)
  })
})

describe('recover', () => {
  it('leaves the route alone while the world still answers for it', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })
    navigate({ page: 'job_run', job_id: 'solver', run_id: '0' })

    recover()
    expect(app.route).toEqual({ page: 'job_run', job_id: 'solver', run_id: '0' })
  })

  it('falls back to the entity when its run is gone', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })
    navigate({ page: 'job_run', job_id: 'solver', run_id: '0' })

    send({ kind: 'job-run-removed', job_id: 'solver', id: '0' })
    expect(app.route).toEqual({ page: 'entity', entity_id: 'solver' })
    expect(app.notice?.text).toContain('no longer listed')
  })

  it('falls back to empty when the entity itself is gone', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    navigate({ page: 'entity', entity_id: 'solver' })

    send({ kind: 'entity-removed', id: 'solver' })
    expect(app.route).toEqual({ page: 'empty' })
  })

  it('recovers a report route through its context', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })
    navigate({ page: 'report', context: { kind: 'job_run', job_id: 'solver' }, run_id: '0' })

    send({ kind: 'job-run-removed', job_id: 'solver', id: '0' })
    expect(app.route).toEqual({ page: 'entity', entity_id: 'solver' })
  })

  // An overlay mid-operation answers for itself; closing it here would throw
  // that answer away — including the confirmation of a removal that worked.
  it('leaves a busy overlay open even when its subject disappears', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    app.overlay = { kind: 'confirm_remove', entity_id: 'solver', error: null, busy: true }

    send({ kind: 'entity-removed', id: 'solver' })
    expect(app.overlay).not.toBeNull()

    app.overlay.busy = false
    recover()
    expect(app.overlay).toBeNull()
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

    dismiss_notice()
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
      run: bench_run('7', 'nightly', [{ index: 0, job_id: 'solver', parameters: '', run_id: '8' }])
    })
    send({ kind: 'job-run-upserted', run: job_run('8', 'solver') })
  }

  // Arriving through the bench must not move the Explorer onto the job, even
  // though the job is right there in the Explorer too (§19).
  it('keeps the bench selected', () => {
    dispatched()
    navigate({ page: 'bench_child', bench_id: 'nightly', bench_run_id: '7', run_id: '8' })
    expect(selected_entity_id()).toBe('nightly')
  })

  it('falls back to the bench run when the dispatched run goes', () => {
    dispatched()
    navigate({ page: 'bench_child', bench_id: 'nightly', bench_run_id: '7', run_id: '8' })

    send({ kind: 'job-run-removed', job_id: 'solver', id: '8' })
    expect(app.route).toEqual({ page: 'bench_run', bench_id: 'nightly', run_id: '7' })
    expect(app.notice?.text).toContain('dispatched run')
  })

  it('falls back past the bench run when that goes too', () => {
    dispatched()
    navigate({ page: 'bench_child', bench_id: 'nightly', bench_run_id: '7', run_id: '8' })

    send({ kind: 'bench-run-removed', bench_id: 'nightly', id: '7' })
    expect(app.route).toEqual({ page: 'entity', entity_id: 'nightly' })
  })

  // The report file lives where the run happened — in the job's folder — even
  // though the reader arrived through the bench.
  it('reads its report from the job that ran it', () => {
    dispatched()
    const context = { kind: 'bench_child', bench_id: 'nightly', bench_run_id: '7' } as const
    expect(report_owner_id(context, '8')).toBe('solver')
  })

  it('recovers a report opened in the bench context', () => {
    dispatched()
    navigate({
      page: 'report',
      context: { kind: 'bench_child', bench_id: 'nightly', bench_run_id: '7' },
      run_id: '8'
    })

    send({ kind: 'job-run-removed', job_id: 'solver', id: '8' })
    expect(app.route).toEqual({ page: 'entity', entity_id: 'nightly' })
  })
})

// What happened, written from the events as they land, and the views the
// activity bar switches between (§8.2, §11.1).
describe('the journal and the views', () => {
  function failure(text: string): CocoEvent {
    return { kind: 'notice', level: 'error', text }
  }

  it('writes a line from an event before the event lands, newest last', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver') })
    send({ kind: 'job-run-upserted', run: job_run('0', 'solver', { status: 'Succeeded' }) })
    expect(
      app.journal.map((entry) => [entry.name, entry.run, entry.what].filter(Boolean).join(' '))
    ).toEqual(['solver added', 'solver 0 started by you', 'solver 0 Succeeded'])
  })

  it('keeps no more than a hundred', () => {
    for (let i = 0; i < 120; i += 1) {
      send(failure(`entry ${i}`))
    }
    expect(app.journal).toHaveLength(100)
    expect(app.journal[0].what).toBe('entry 20')
    expect(app.journal[99].what).toBe('entry 119')
  })

  it('dates the last change by the newest entry', () => {
    expect(last_change()).toBeNull()
    send(failure('first'), failure('second'))
    expect(last_change()?.what).toBe('second')
  })

  it('opens a view from the activity bar, and collapses the sidebar on the open one', () => {
    select_view('events')
    expect([app.sidebar_view, app.sidebar_open]).toEqual(['events', true])
    select_view('events')
    expect([app.sidebar_view, app.sidebar_open]).toEqual(['events', false])
    select_view('runs')
    expect([app.sidebar_view, app.sidebar_open]).toEqual(['runs', true])
  })

  it('takes the page to what an entry is about, and says so when it is gone', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({
      kind: 'job-run-upserted',
      run: {
        id: '0',
        job_id: 'solver',
        origin: 'Human',
        started_at: '2026-08-22T22:00:00.000+02:00',
        ended_at: null,
        parameters: '',
        params: {},
        status: 'Running',
        query_health: 'Healthy',
        last_successful_query: '2026-08-22T22:00:03.000+02:00',
        report: 'Missing',
        error: null
      }
    })
    go_to({ kind: 'job_run', job_id: 'solver', run_id: '0' })
    expect(app.route).toEqual({ page: 'job_run', job_id: 'solver', run_id: '0' })

    go_to({ kind: 'job_run', job_id: 'solver', run_id: '9' })
    expect(app.route).toEqual({ page: 'job_run', job_id: 'solver', run_id: '0' })
    expect(app.notice?.text).toContain('no longer listed')
  })
})

// The history's row menu (§22.6): a run's parameters, used again — at once,
// or as a draft on the Start page.
describe('a run started again', () => {
  const start_run = vi.fn<(name: string, params: Record<string, string>) => Promise<unknown>>()

  beforeEach(() => {
    start_run.mockReset()
    vi.stubGlobal('window', { coco: { start_run } })
    send({
      kind: 'entity-upserted',
      entity: {
        ...entity('solver'),
        parameters: [
          { name: 'nodes', type: 'string', values: null, list: false, description: 'the nodes' },
          { name: 'gpu', type: 'string', values: null, list: false, description: 'the gpu' }
        ]
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with exactly the parameters it had, and says which run that made', async () => {
    start_run.mockResolvedValue({ ok: true, run_id: '7' })
    await start_again('solver', { nodes: '4', gpu: '1' })
    expect(start_run).toHaveBeenCalledWith('solver', { nodes: '4', gpu: '1' })
    expect(app.notice?.text).toBe('Run 7 started.')
    expect(app.overlay).toBeNull()
  })

  it('puts a refusal in a modal, since it has to be read', async () => {
    start_run.mockResolvedValue({ ok: false, message: 'render parameters must match the manifest' })
    await start_again('solver', { nodes: '4' })
    expect(app.overlay).toEqual({
      kind: 'refused',
      title: 'Could not start',
      message: 'render parameters must match the manifest'
    })
  })

  it('fills the Start page with what the manifest still takes, and says the rest', () => {
    prefill_start('solver', '3', { nodes: '4', gpu: '1' })
    expect(app.route).toEqual({ page: 'start', entity_id: 'solver' })
    expect(take_prefill('solver')).toEqual({ nodes: '4', gpu: '1' })
    expect(take_prefill('solver')).toBeNull()
    expect(app.notice?.text).toBe('Parameters of run 3 filled in.')

    prefill_start('solver', '3', { nodes: '4', size: '256' })
    expect(take_prefill('solver')).toEqual({ nodes: '4' })
    expect(app.notice).toMatchObject({ level: 'error' })
    expect(app.notice?.text).toBe(
      'Filled what run 3 had; `gpu` is new and left empty; `size` is no longer taken.'
    )

    // A value that no longer fits its shape — here a string where the run had
    // a list — is dropped too, and said.
    prefill_start('solver', '3', { nodes: ['4', '8'], gpu: '1' })
    expect(take_prefill('solver')).toEqual({ gpu: '1' })
    expect(app.notice?.text).toBe(
      'Filled what run 3 had; `nodes` no longer fits and is left empty.'
    )
  })

  it('hands a prefill only to the page it was meant for', () => {
    prefill_start('solver', '3', { nodes: '4', gpu: '1' })
    expect(take_prefill('elsewhere')).toBeNull()
    expect(take_prefill('solver')).toEqual({ nodes: '4', gpu: '1' })
  })
})
