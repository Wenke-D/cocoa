// The change judgement the backend makes on the renderer's behalf. One batch
// per logical operation, entry-level upserts, and — the point of the whole
// exercise — silence when nothing a person can see has moved.

import { describe, expect, it } from 'vitest'
import { empty_world } from '@shared/world'
import type { BenchRun, Entity, JobRun, RunsByEntity, World } from '@shared/world'
import { diff_worlds } from '../src/main/sync'

function entity(id: string, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'Job',
    name: id,
    description: null,
    path: `~/exp/${id}`,
    manifest: 'Valid',
    parameter_names: ['size'],
    ...extra
  }
}

function job_run(id: string, extra: Partial<JobRun> = {}): JobRun {
  return {
    id,
    job_id: 'solver',
    origin: 'Human',
    started_at: '2026-08-19T10:00:00.000+02:00',
    ended_at: null,
    parameters: '--size 256',
    params: { size: '256' },
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    error: null,
    ...extra
  }
}

function bench_run(id: string, extra: Partial<BenchRun> = {}): BenchRun {
  return {
    id,
    bench_id: 'nightly',
    by: 'Human',
    started_at: '2026-08-19T10:00:00.000+02:00',
    ended_at: null,
    parameters: '--mesh fine',
    params: { mesh: 'fine' },
    plan: { steps: [] },
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    error: null,
    ...extra
  }
}

/**
 * Runs indexed the way a world holds them: by the experiment they belong to,
 * then by id. Grouping by the run's own owner field rather than a fixed one,
 * so a test can mix owners and see them land apart.
 */
function job_runs(...runs: JobRun[]): RunsByEntity<JobRun> {
  const out: RunsByEntity<JobRun> = {}
  for (const run of runs) {
    ;(out[run.job_id] ??= {})[run.id] = run
  }
  return out
}

function bench_runs(...runs: BenchRun[]): RunsByEntity<BenchRun> {
  const out: RunsByEntity<BenchRun> = {}
  for (const run of runs) {
    ;(out[run.bench_id] ??= {})[run.id] = run
  }
  return out
}

function world_of(parts: Partial<World>): World {
  return { ...empty_world(), ...parts }
}

describe('diff_worlds', () => {
  it('says nothing when nothing changed', () => {
    const world = world_of({
      entities: [entity('solver')],
      job_runs: job_runs(job_run('0')),
      bench_runs: bench_runs(bench_run('1'))
    })
    expect(diff_worlds(world, structuredClone(world))).toEqual([])
  })

  // The trap this protocol exists to avoid: a stamp that moves on every
  // rebuild would make every run "changed" three times a second.
  it('ignores a moved last_successful_query stamp on its own', () => {
    const before = world_of({
      job_runs: job_runs(job_run('0')),
      bench_runs: bench_runs(bench_run('1'))
    })
    const after = world_of({
      job_runs: job_runs(job_run('0', { last_successful_query: '2026-08-19T10:00:06.000+02:00' })),
      bench_runs: bench_runs(
        bench_run('1', { last_successful_query: '2026-08-19T10:00:06.000+02:00' })
      )
    })
    expect(diff_worlds(before, after)).toEqual([])
  })

  it('upserts a new run and carries the whole entry', () => {
    const before = world_of({})
    const run = job_run('0')
    const events = diff_worlds(before, world_of({ job_runs: job_runs(run) }))
    expect(events).toEqual([{ kind: 'job-run-upserted', run }])
  })

  it('upserts a run whose status moved', () => {
    const before = world_of({ job_runs: job_runs(job_run('0')) })
    const after = world_of({ job_runs: job_runs(job_run('0', { status: 'Succeeded' })) })
    const events = diff_worlds(before, after)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'job-run-upserted' })
    expect((events[0] as { run: JobRun }).run.status).toBe('Succeeded')
  })

  it('removes a run that is gone', () => {
    const before = world_of({ job_runs: job_runs(job_run('0'), job_run('1')) })
    const after = world_of({ job_runs: job_runs(job_run('1')) })
    expect(diff_worlds(before, after)).toEqual([
      { kind: 'job-run-removed', job_id: 'solver', id: '0' }
    ])
  })

  it('upserts and removes entities', () => {
    const before = world_of({ entities: [entity('solver'), entity('mesher')] })
    const changed = entity('solver', { parameter_names: ['size', 'mesh'] })
    const added = entity('bench-1', { kind: 'Bench' })
    const events = diff_worlds(before, world_of({ entities: [changed, added] }))
    expect(events).toEqual([
      { kind: 'entity-upserted', entity: changed },
      { kind: 'entity-upserted', entity: added },
      { kind: 'entity-removed', id: 'mesher' }
    ])
  })

  it('judges a manifest that went invalid as a change', () => {
    const before = world_of({ entities: [entity('solver')] })
    const broken = entity('solver', { manifest: { Invalid: { message: 'unknown field `x`' } } })
    expect(diff_worlds(before, world_of({ entities: [broken] }))).toEqual([
      { kind: 'entity-upserted', entity: broken }
    ])
  })

  it('tracks bench runs and their plans', () => {
    const before = world_of({ bench_runs: bench_runs(bench_run('1')) })
    const replanned = bench_run('1', {
      plan: { steps: [{ index: 0, job_id: 'solver', parameters: '--size 256', run_id: '2' }] }
    })
    expect(diff_worlds(before, world_of({ bench_runs: bench_runs(replanned) }))).toEqual([
      { kind: 'bench-run-upserted', run: replanned }
    ])
    expect(diff_worlds(before, world_of({}))).toEqual([
      { kind: 'bench-run-removed', bench_id: 'nightly', id: '1' }
    ])
  })

  // A bench member succeeding moves the member and the bench together; both
  // land in one batch, so the renderer never draws a torn world.
  it('reports a member and its bench in one batch', () => {
    const before = world_of({
      job_runs: job_runs(job_run('2')),
      bench_runs: bench_runs(bench_run('1'))
    })
    const after = world_of({
      job_runs: job_runs(job_run('2', { status: 'Succeeded' })),
      bench_runs: bench_runs(bench_run('1', { status: 'Analyzing' }))
    })
    const events = diff_worlds(before, after)
    expect(events.map((event) => event.kind)).toEqual(['job-run-upserted', 'bench-run-upserted'])
  })
})
