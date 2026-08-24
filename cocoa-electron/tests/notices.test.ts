// What a refresh is allowed to say, and how often. The engine refreshes every
// three seconds; the point of the gate is that a cluster failing on every one
// of them is announced once, not twenty times a minute.

import { describe, expect, it } from 'vitest'
import { EngineError } from '../src/main/engine/errors'
import { empty, some } from '../src/shared/maybe'
import { NoticeGate, refresh_summary } from '../src/main/bridge/notices'

interface Errors {
  launch_errors: EngineError[]
  poll_errors: EngineError[]
  report_errors: EngineError[]
}

function report(errors: Partial<Errors> = {}): Errors {
  return { launch_errors: [], poll_errors: [], report_errors: [], ...errors }
}

function failure(message: string): EngineError {
  return EngineError.validation(message)
}

describe('refresh_summary', () => {
  it('says nothing about a clean pass', () => {
    expect(refresh_summary(report()).is_empty()).toBe(true)
  })

  it('gives one error in full', () => {
    expect(
      refresh_summary(report({ poll_errors: [failure('poll script failed')] })).or_null()
    ).toBe('poll script failed')
  })

  it('gives the first error and counts the rest', () => {
    const summary = refresh_summary(
      report({
        poll_errors: [failure('poll script failed'), failure('another one')],
        report_errors: [failure('and a third')]
      })
    )
    expect(summary.or_null()).toBe('poll script failed (and 2 more)')
  })

  it('reads every source of failure, not just polls', () => {
    expect(refresh_summary(report({ launch_errors: [failure('launch died')] })).or_null()).toBe(
      'launch died'
    )
    expect(refresh_summary(report({ report_errors: [failure('report died')] })).or_null()).toBe(
      'report died'
    )
  })
})

describe('the automatic tick', () => {
  it('says nothing when nothing is wrong', () => {
    expect(new NoticeGate().automatic(empty()).is_empty()).toBe(true)
  })

  it('announces a failure once and then holds still', () => {
    const gate = new NoticeGate()
    expect(gate.automatic(some('poll script failed')).or_null()).toEqual({
      kind: 'notice',
      level: 'error',
      text: 'poll script failed'
    })
    expect(gate.automatic(some('poll script failed')).is_empty()).toBe(true)
    expect(gate.automatic(some('poll script failed')).is_empty()).toBe(true)
  })

  it('announces a different failure', () => {
    const gate = new NoticeGate()
    gate.automatic(some('poll script failed'))
    expect(gate.automatic(some('report script failed')).or_null()).toMatchObject({
      text: 'report script failed'
    })
  })

  it('announces the same failure again after a pass that worked', () => {
    const gate = new NoticeGate()
    gate.automatic(some('poll script failed'))
    expect(gate.automatic(empty()).is_empty()).toBe(true)
    expect(gate.automatic(some('poll script failed')).or_null()).toMatchObject({ level: 'error' })
  })
})

describe('the refresh a person asked for', () => {
  it('answers even when there was nothing to report', () => {
    expect(new NoticeGate().manual(empty())).toEqual({
      kind: 'notice',
      level: 'info',
      text: 'Refreshed.'
    })
  })

  it('answers with the failure', () => {
    expect(new NoticeGate().manual(some('poll script failed'))).toMatchObject({
      level: 'error',
      text: 'poll script failed'
    })
  })

  // Otherwise pressing refresh on a broken cluster says the same sentence
  // twice: once for the button, once for the tick three seconds later.
  it('counts as said, so the next tick does not repeat it', () => {
    const gate = new NoticeGate()
    gate.manual(some('poll script failed'))
    expect(gate.automatic(some('poll script failed')).is_empty()).toBe(true)
  })

  it('clears a standing failure when it succeeds', () => {
    const gate = new NoticeGate()
    gate.automatic(some('poll script failed'))
    expect(gate.manual(empty())).toMatchObject({ text: 'Refreshed.' })
    expect(gate.automatic(some('poll script failed')).or_null()).toMatchObject({ level: 'error' })
  })
})
