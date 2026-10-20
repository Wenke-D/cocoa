import { afterEach, describe, expect, it } from 'vitest'
import type { CocoaEvent } from '@shared/protocol'
import { app } from '../../../src/renderer/src/state.svelte'
import { has_active_run } from '../../../src/renderer/src/world_queries'
import { campaign_run, entity, job_run, reset, send } from '../support/app'

afterEach(reset)

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

  it('tracks campaign runs the same way', () => {
    send({ kind: 'entity-upserted', entity: entity('nightly', 'Campaign') })
    send({ kind: 'campaign-run-upserted', run: campaign_run('7', 'nightly') })

    expect(app.world.runs_by_campaign['nightly']).toEqual(['7'])
    expect(has_active_run(app.world.entities[0])).toBe(true)
  })
})

// What happened, written from the events as they land (§11.1).
describe('the journal', () => {
  function failure(text: string): CocoaEvent {
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
})
