// The change judgement the backend makes on the renderer's behalf. One batch
// per logical operation, entry-level upserts, and — the point of the whole
// exercise — silence when nothing a person can see has moved.

import { describe, expect, it } from 'vitest'
import { emptyWorld } from '@shared/world'
import type { BenchRun, Entity, JobRun, World } from '@shared/world'
import { diffWorlds } from '../src/main/sync'

function entity(id: string, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'Job',
    name: id,
    path: `~/exp/${id}`,
    manifest: 'Valid',
    parameter_names: ['size'],
    last_used: {},
    ...extra
  }
}

function jobRun(id: string, extra: Partial<JobRun> = {}): JobRun {
  return {
    id,
    job_id: 'solver',
    origin: 'Human',
    started_at: '2026-08-19T10:00:00.000+02:00',
    ended_at: null,
    parameters: '--size 256',
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    error: null,
    ...extra
  }
}

function benchRun(id: string, extra: Partial<BenchRun> = {}): BenchRun {
  return {
    id,
    bench_id: 'nightly',
    by: 'Human',
    started_at: '2026-08-19T10:00:00.000+02:00',
    ended_at: null,
    parameters: '--mesh fine',
    plan: { steps: [] },
    status: 'Running',
    query_health: 'Healthy',
    last_successful_query: '2026-08-19T10:00:03.000+02:00',
    report: 'Missing',
    error: null,
    ...extra
  }
}

function worldOf(parts: Partial<World>): World {
  return { ...emptyWorld(), ...parts }
}

describe('diffWorlds', () => {
  it('says nothing when nothing changed', () => {
    const world = worldOf({
      entities: [entity('solver')],
      job_runs: { '0': jobRun('0') },
      bench_runs: { '1': benchRun('1') }
    })
    expect(diffWorlds(world, structuredClone(world))).toEqual([])
  })

  // The trap this protocol exists to avoid: a stamp that moves on every
  // rebuild would make every run "changed" three times a second.
  it('ignores a moved last_successful_query stamp on its own', () => {
    const before = worldOf({
      job_runs: { '0': jobRun('0') },
      bench_runs: { '1': benchRun('1') }
    })
    const after = worldOf({
      job_runs: { '0': jobRun('0', { last_successful_query: '2026-08-19T10:00:06.000+02:00' }) },
      bench_runs: { '1': benchRun('1', { last_successful_query: '2026-08-19T10:00:06.000+02:00' }) }
    })
    expect(diffWorlds(before, after)).toEqual([])
  })

  it('upserts a new run and carries the whole entry', () => {
    const before = worldOf({})
    const run = jobRun('0')
    const events = diffWorlds(before, worldOf({ job_runs: { '0': run } }))
    expect(events).toEqual([{ kind: 'job-run-upserted', run }])
  })

  it('upserts a run whose status moved', () => {
    const before = worldOf({ job_runs: { '0': jobRun('0') } })
    const after = worldOf({ job_runs: { '0': jobRun('0', { status: 'Succeeded' }) } })
    const events = diffWorlds(before, after)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'job-run-upserted' })
    expect((events[0] as { run: JobRun }).run.status).toBe('Succeeded')
  })

  it('removes a run that is gone', () => {
    const before = worldOf({ job_runs: { '0': jobRun('0'), '1': jobRun('1') } })
    const after = worldOf({ job_runs: { '1': jobRun('1') } })
    expect(diffWorlds(before, after)).toEqual([{ kind: 'job-run-removed', id: '0' }])
  })

  it('upserts and removes entities', () => {
    const before = worldOf({ entities: [entity('solver'), entity('mesher')] })
    const changed = entity('solver', { last_used: { size: '256' } })
    const added = entity('bench-1', { kind: 'Bench' })
    const events = diffWorlds(before, worldOf({ entities: [changed, added] }))
    expect(events).toEqual([
      { kind: 'entity-upserted', entity: changed },
      { kind: 'entity-upserted', entity: added },
      { kind: 'entity-removed', id: 'mesher' }
    ])
  })

  it('judges a manifest that went invalid as a change', () => {
    const before = worldOf({ entities: [entity('solver')] })
    const broken = entity('solver', { manifest: { Invalid: { message: 'unknown field `x`' } } })
    expect(diffWorlds(before, worldOf({ entities: [broken] }))).toEqual([
      { kind: 'entity-upserted', entity: broken }
    ])
  })

  it('tracks bench runs and their plans', () => {
    const before = worldOf({ bench_runs: { '1': benchRun('1') } })
    const replanned = benchRun('1', {
      plan: { steps: [{ index: 0, job_id: 'solver', parameters: '--size 256', run_id: '2' }] }
    })
    expect(diffWorlds(before, worldOf({ bench_runs: { '1': replanned } }))).toEqual([
      { kind: 'bench-run-upserted', run: replanned }
    ])
    expect(diffWorlds(before, worldOf({}))).toEqual([{ kind: 'bench-run-removed', id: '1' }])
  })

  // A bench member succeeding moves the member and the bench together; both
  // land in one batch, so the renderer never draws a torn world.
  it('reports a member and its bench in one batch', () => {
    const before = worldOf({
      job_runs: { '2': jobRun('2') },
      bench_runs: { '1': benchRun('1') }
    })
    const after = worldOf({
      job_runs: { '2': jobRun('2', { status: 'Succeeded' }) },
      bench_runs: { '1': benchRun('1', { status: 'Analyzing' }) }
    })
    const events = diffWorlds(before, after)
    expect(events.map((event) => event.kind)).toEqual([
      'job-run-upserted',
      'bench-run-upserted'
    ])
  })
})
