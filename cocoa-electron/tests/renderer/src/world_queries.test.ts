import { afterEach, describe, expect, it } from 'vitest'
import type { CocoaEvent } from '@shared/protocol'
import { navigate } from '../../../src/renderer/src/navigation'
import {
  call_of,
  last_change,
  report_owner_id,
  selected_entity_id
} from '../../../src/renderer/src/world_queries'
import { campaign_run, entity, job_run, reset, send } from '../support/app'

afterEach(reset)

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

  // Arriving through the campaign must not move the Explorer onto the job, even
  // though the job is right there in the Explorer too (§19).
  it('keeps the campaign selected', () => {
    dispatched()
    navigate({
      page: 'campaign_child',
      campaign_id: 'nightly',
      campaign_run_id: '7',
      job_id: 'solver',
      run_id: '8'
    })
    expect(selected_entity_id()).toBe('nightly')
  })

  // The report file lives where the run happened — in the job's folder — even
  // though the reader arrived through the campaign.
  it('reads its report from the job that ran it', () => {
    dispatched()
    const context = {
      kind: 'campaign_child',
      campaign_id: 'nightly',
      campaign_run_id: '7',
      job_id: 'solver'
    } as const
    expect(report_owner_id(context)).toBe('solver')
  })

  // Run ids are per job, so two calls can both be run 8; and a call run again
  // (convention §8.5) is still found by its earlier run.
  it('finds a call by its job and run, current or earlier', () => {
    send({ kind: 'entity-upserted', entity: entity('nightly', 'Campaign') })
    send({
      kind: 'campaign-run-upserted',
      run: campaign_run('7', 'nightly', [
        { index: 0, job_id: 'solver', parameters: '', run_id: '8', attempts: [] },
        { index: 1, job_id: 'mesher', parameters: '', run_id: '9', attempts: ['8'] }
      ])
    })
    expect(call_of('nightly', '7', 'solver', '8')?.index).toBe(0)
    expect(call_of('nightly', '7', 'mesher', '8')?.index).toBe(1)
    expect(call_of('nightly', '7', 'mesher', '9')?.index).toBe(1)
    expect(call_of('nightly', '7', 'solver', '9')).toBeUndefined()
  })
})

// What happened, as the status bar dates itself by it (§11.1).
describe('the journal', () => {
  function failure(text: string): CocoaEvent {
    return { kind: 'notice', level: 'error', text }
  }

  it('dates the last change by the newest entry', () => {
    expect(last_change()).toBeNull()
    send(failure('first'), failure('second'))
    expect(last_change()?.what).toBe('second')
  })
})
