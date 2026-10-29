import { afterEach, describe, expect, it } from 'vitest'
import { navigate } from '../../../src/renderer/src/navigation'
import { recover } from '../../../src/renderer/src/recover'
import { app } from '../../../src/renderer/src/state.svelte'
import { campaign_run, entity, job_run, reset, send } from '../support/app'

afterEach(reset)

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
    navigate({
      page: 'report',
      context: { kind: 'job_run', job_id: 'solver' },
      run_id: '0',
      format: 'PlainText'
    })

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

// One run, two addresses (§2.3.1): reached through its job, or through the
// campaign that dispatched it. The record is the same; the context is not.
describe('a dispatched run seen through its campaign', () => {
  function dispatched(): void {
    send({ kind: 'entity-upserted', entity: entity('nightly', 'Campaign') })
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({
      kind: 'campaign-run-upserted',
      run: campaign_run('7', 'nightly', [
        { index: 0, job_id: 'solver', parameters: '', run_id: '8', attempts: [] }
      ])
    })
    send({ kind: 'job-run-upserted', run: job_run('8', 'solver') })
  }

  it('falls back to the campaign run when the dispatched run goes', () => {
    dispatched()
    navigate({
      page: 'campaign_child',
      campaign_id: 'nightly',
      campaign_run_id: '7',
      job_id: 'solver',
      run_id: '8'
    })

    send({ kind: 'job-run-removed', job_id: 'solver', id: '8' })
    expect(app.route).toEqual({ page: 'campaign_run', campaign_id: 'nightly', run_id: '7' })
    expect(app.notice?.text).toContain('dispatched run')
  })

  it('falls back past the campaign run when that goes too', () => {
    dispatched()
    navigate({
      page: 'campaign_child',
      campaign_id: 'nightly',
      campaign_run_id: '7',
      job_id: 'solver',
      run_id: '8'
    })

    send({ kind: 'campaign-run-removed', campaign_id: 'nightly', id: '7' })
    expect(app.route).toEqual({ page: 'entity', entity_id: 'nightly' })
  })

  it('recovers a report opened in the campaign context', () => {
    dispatched()
    navigate({
      page: 'report',
      context: {
        kind: 'campaign_child',
        campaign_id: 'nightly',
        campaign_run_id: '7',
        job_id: 'solver'
      },
      run_id: '8',
      format: 'PlainText'
    })

    send({ kind: 'job-run-removed', job_id: 'solver', id: '8' })
    expect(app.route).toEqual({ page: 'entity', entity_id: 'nightly' })
  })
})
