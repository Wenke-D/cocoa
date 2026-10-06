// The entry an event earns, judged against the world as it was: one per
// thing that happened, and none for a field moving on its own.

import { describe, expect, it } from 'vitest'
import { empty_world } from '@shared/world'
import type { CampaignRun, CocoaEvent, Entity, JobRun, World } from '@shared/world'
import { sentences_of, tone_of } from '../src/renderer/src/journal'

const AT = '2026-08-22T22:00:00.000+02:00'

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

/** A world listing both experiments, holding the given runs. */
function world_with(runs: JobRun[] = [], campaigns: CampaignRun[] = []): World {
  const world: World = {
    ...empty_world(),
    entities: [entity('solver'), entity('nightly', { kind: 'Campaign' })]
  }
  for (const run of runs) {
    ;(world.job_runs[run.job_id] ??= {})[run.id] = run
  }
  for (const run of campaigns) {
    ;(world.campaign_runs[run.campaign_id] ??= {})[run.id] = run
  }
  return world
}

/** `name · run · what · tone`, one line per entry. */
function told(world: World, event: CocoaEvent): string[] {
  return sentences_of(world, event, AT).map(
    (entry) => `${entry.name} · ${entry.run ?? '-'} · ${entry.what} · ${entry.tone}`
  )
}

describe('sentences_of', () => {
  it('says nothing for an upsert that moved only the query stamp', () => {
    const world = world_with([job_run('0')])
    const stamped = job_run('0', { last_successful_query: '2026-08-19T10:00:06.000+02:00' })
    expect(told(world, { kind: 'job-run-upserted', run: stamped })).toEqual([])
    expect(told(world, { kind: 'refreshed', at: AT })).toEqual([])
  })

  it('tells a run that started, and by whom', () => {
    const world = world_with()
    expect(told(world, { kind: 'job-run-upserted', run: job_run('0') })).toEqual([
      'solver · 0 · started by you · info'
    ])
    const dispatched = job_run('1', {
      origin: {
        Campaign: { name: 'nightly', campaign_id: 'nightly', campaign_run_id: '2', call: 1 }
      }
    })
    expect(told(world, { kind: 'job-run-upserted', run: dispatched })).toEqual([
      'solver · 1 · started by nightly · call 1 · info'
    ])
    const campaign = campaign_run('2', {
      by: 'Agent',
      plan: {
        steps: [
          { index: 0, job_id: 'solver', parameters: '', run_id: '1' },
          { index: 1, job_id: 'solver', parameters: '', run_id: '3' }
        ]
      }
    })
    expect(told(world, { kind: 'campaign-run-upserted', run: campaign })).toEqual([
      'nightly · 2 · started by agent, 2 calls · info'
    ])
  })

  it('tells a status that moved, in the colour of where it landed — what, never why', () => {
    const world = world_with([job_run('0')])
    expect(
      told(world, { kind: 'job-run-upserted', run: job_run('0', { status: 'Succeeded' }) })
    ).toEqual(['solver · 0 · Succeeded · good'])
    const failed = job_run('0', { status: 'Error', error: 'launch script exited 2' })
    expect(told(world, { kind: 'job-run-upserted', run: failed })).toEqual([
      'solver · 0 · Error · bad'
    ])
    expect(
      told(world, { kind: 'job-run-upserted', run: job_run('0', { status: 'Cancelling' }) })
    ).toEqual(['solver · 0 · Cancelling · neutral'])
    expect(tone_of('Failed')).toBe('bad')
    expect(tone_of('Pending')).toBe('info')
  })

  it('tells a report that landed — with the status it landed with, in one pass', () => {
    const world = world_with([job_run('0', { status: 'Analyzing' })])
    const done = job_run('0', {
      status: 'Succeeded',
      report: { Available: { files: [{ format: 'PlainText', text_bytes: 12 }] } }
    })
    expect(told(world, { kind: 'job-run-upserted', run: done })).toEqual([
      'solver · 0 · Succeeded · good',
      'solver · 0 · report ready · good'
    ])
  })

  it('tells a run cocoa lost sight of, and found again', () => {
    const lost = job_run('0', { query_health: { Unavailable: { message: 'poll script failed' } } })
    expect(told(world_with([job_run('0')]), { kind: 'job-run-upserted', run: lost })).toEqual([
      'solver · 0 · unreachable · warn'
    ])
    expect(told(world_with([lost]), { kind: 'job-run-upserted', run: job_run('0') })).toEqual([
      'solver · 0 · reachable again · good'
    ])
  })

  it('tells folders that came and went, and manifests that broke and healed', () => {
    expect(told(empty_world(), { kind: 'entity-upserted', entity: entity('solver') })).toEqual([
      'solver · - · added · info'
    ])
    const listed = world_with()
    expect(told(listed, { kind: 'entity-removed', id: 'solver' })).toEqual([
      'solver · - · removed from the Explorer · neutral'
    ])
    const broken = entity('solver', { manifest: { Invalid: { message: 'unknown field `x`' } } })
    expect(told(listed, { kind: 'entity-upserted', entity: broken })).toEqual([
      'solver · - · manifest unusable · warn'
    ])
    const healed = { ...listed, entities: [broken] }
    expect(told(healed, { kind: 'entity-upserted', entity: entity('solver') })).toEqual([
      'solver · - · manifest usable again · good'
    ])
    // A change that is not one a person reads: silence.
    const renamed_params = entity('solver', {
      parameters: [
        { name: 'size', type: 'string', values: null, list: false, description: 'the size' },
        { name: 'mesh', type: 'string', values: null, list: false, description: 'the mesh' }
      ]
    })
    expect(told(listed, { kind: 'entity-upserted', entity: renamed_params })).toEqual([])
  })

  it('tells a run that is no longer listed, and a failure the user was told about', () => {
    expect(
      told(world_with([job_run('0')]), { kind: 'job-run-removed', job_id: 'solver', id: '0' })
    ).toEqual(['solver · 0 · no longer listed · neutral'])
    expect(told(world_with(), { kind: 'notice', level: 'error', text: 'poll failed' })).toEqual([
      ' · - · poll failed · bad'
    ])
    expect(told(world_with(), { kind: 'notice', level: 'info', text: 'Refreshed.' })).toEqual([])
  })

  it('points each entry at what it is about, and stamps it with the pass', () => {
    expect(sentences_of(world_with(), { kind: 'job-run-upserted', run: job_run('0') }, AT)).toEqual(
      [
        {
          at: AT,
          name: 'solver',
          run: '0',
          what: 'started by you',
          tone: 'info',
          target: { kind: 'job_run', job_id: 'solver', run_id: '0' }
        }
      ]
    )
    const gone = sentences_of(world_with(), { kind: 'entity-removed', id: 'solver' }, AT)
    expect(gone[0].target).toBeNull()
  })
})
