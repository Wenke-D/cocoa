// The change judgement the backend makes on the renderer's behalf. One batch
// per logical operation, entry-level upserts, and — the point of the whole
// exercise — silence when nothing a person can see has moved.

import { describe, expect, it } from 'vitest'
import { empty_world } from '@shared/world'
import type { CampaignRun, Entity, JobRun, RunsByEntity, World } from '@shared/world'
import { diff_worlds } from '../src/main/bridge/sync'

function entity(id: string, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'Job',
    name: id,
    description: null,
    path: `~/exp/${id}`,
    manifest: 'Valid',
    parameters: [
      { name: 'size', type: 'string', values: null, list: false, description: 'the size' }
    ],
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
    report_error: null,
    report_rerunnable: false,
    deploy: null,
    error: null,
    ...extra
  }
}

function campaign_run(id: string, extra: Partial<CampaignRun> = {}): CampaignRun {
  return {
    id,
    campaign_id: 'nightly',
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

function campaign_runs(...runs: CampaignRun[]): RunsByEntity<CampaignRun> {
  const out: RunsByEntity<CampaignRun> = {}
  for (const run of runs) {
    ;(out[run.campaign_id] ??= {})[run.id] = run
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
      campaign_runs: campaign_runs(campaign_run('1'))
    })
    expect(diff_worlds(world, structuredClone(world))).toEqual([])
  })

  // The trap this protocol exists to avoid: a stamp that moves on every
  // rebuild would make every run "changed" three times a second.
  it('ignores a moved last_successful_query stamp on its own', () => {
    const before = world_of({
      job_runs: job_runs(job_run('0')),
      campaign_runs: campaign_runs(campaign_run('1'))
    })
    const after = world_of({
      job_runs: job_runs(job_run('0', { last_successful_query: '2026-08-19T10:00:06.000+02:00' })),
      campaign_runs: campaign_runs(
        campaign_run('1', { last_successful_query: '2026-08-19T10:00:06.000+02:00' })
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
    const changed = entity('solver', {
      parameters: [
        { name: 'size', type: 'string', values: null, list: false, description: 'the size' },
        { name: 'mesh', type: 'string', values: null, list: false, description: 'the mesh' }
      ]
    })
    const added = entity('campaign-1', { kind: 'Campaign' })
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

  it('tracks campaign runs and their plans', () => {
    const before = world_of({ campaign_runs: campaign_runs(campaign_run('1')) })
    const replanned = campaign_run('1', {
      plan: { steps: [{ index: 0, job_id: 'solver', parameters: '--size 256', run_id: '2' }] }
    })
    expect(diff_worlds(before, world_of({ campaign_runs: campaign_runs(replanned) }))).toEqual([
      { kind: 'campaign-run-upserted', run: replanned }
    ])
    expect(diff_worlds(before, world_of({}))).toEqual([
      { kind: 'campaign-run-removed', campaign_id: 'nightly', id: '1' }
    ])
  })

  // A campaign member succeeding moves the member and the campaign together; both
  // land in one batch, so the renderer never draws a torn world.
  it('reports a member and its campaign in one batch', () => {
    const before = world_of({
      job_runs: job_runs(job_run('2')),
      campaign_runs: campaign_runs(campaign_run('1'))
    })
    const after = world_of({
      job_runs: job_runs(job_run('2', { status: 'Succeeded' })),
      campaign_runs: campaign_runs(campaign_run('1', { status: 'Analyzing' }))
    })
    const events = diff_worlds(before, after)
    expect(events.map((event) => event.kind)).toEqual(['job-run-upserted', 'campaign-run-upserted'])
  })
})
