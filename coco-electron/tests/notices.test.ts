// What a refresh is allowed to say, and how often. The engine refreshes every
// three seconds; the point of the gate is that a cluster failing on every one
// of them is announced once, not twenty times a minute.

import { describe, expect, it } from 'vitest'
import { EngineError } from '../src/main/engine/errors'
import { NoticeGate, refreshSummary } from '../src/main/notices'

interface Errors {
  launchErrors: EngineError[]
  pollErrors: EngineError[]
  reportErrors: EngineError[]
}

function report(errors: Partial<Errors> = {}): Errors {
  return { launchErrors: [], pollErrors: [], reportErrors: [], ...errors }
}

function failure(message: string): EngineError {
  return EngineError.validation(message)
}

describe('refreshSummary', () => {
  it('says nothing about a clean pass', () => {
    expect(refreshSummary(report())).toBeNull()
  })

  it('gives one error in full', () => {
    expect(refreshSummary(report({ pollErrors: [failure('poll script failed')] }))).toBe(
      'poll script failed'
    )
  })

  it('gives the first error and counts the rest', () => {
    const summary = refreshSummary(
      report({
        pollErrors: [failure('poll script failed'), failure('another one')],
        reportErrors: [failure('and a third')]
      })
    )
    expect(summary).toBe('poll script failed (and 2 more)')
  })

  it('reads every source of failure, not just polls', () => {
    expect(refreshSummary(report({ launchErrors: [failure('launch died')] }))).toBe('launch died')
    expect(refreshSummary(report({ reportErrors: [failure('report died')] }))).toBe('report died')
  })
})

describe('the automatic tick', () => {
  it('says nothing when nothing is wrong', () => {
    expect(new NoticeGate().automatic(null)).toBeNull()
  })

  it('announces a failure once and then holds still', () => {
    const gate = new NoticeGate()
    expect(gate.automatic('poll script failed')).toEqual({
      kind: 'notice',
      level: 'error',
      text: 'poll script failed'
    })
    expect(gate.automatic('poll script failed')).toBeNull()
    expect(gate.automatic('poll script failed')).toBeNull()
  })

  it('announces a different failure', () => {
    const gate = new NoticeGate()
    gate.automatic('poll script failed')
    expect(gate.automatic('report script failed')).toMatchObject({ text: 'report script failed' })
  })

  it('announces the same failure again after a pass that worked', () => {
    const gate = new NoticeGate()
    gate.automatic('poll script failed')
    expect(gate.automatic(null)).toBeNull()
    expect(gate.automatic('poll script failed')).toMatchObject({ level: 'error' })
  })
})

describe('the refresh a person asked for', () => {
  it('answers even when there was nothing to report', () => {
    expect(new NoticeGate().manual(null)).toEqual({
      kind: 'notice',
      level: 'info',
      text: 'Refreshed.'
    })
  })

  it('answers with the failure', () => {
    expect(new NoticeGate().manual('poll script failed')).toMatchObject({
      level: 'error',
      text: 'poll script failed'
    })
  })

  // Otherwise pressing refresh on a broken cluster says the same sentence
  // twice: once for the button, once for the tick three seconds later.
  it('counts as said, so the next tick does not repeat it', () => {
    const gate = new NoticeGate()
    gate.manual('poll script failed')
    expect(gate.automatic('poll script failed')).toBeNull()
  })

  it('clears a standing failure when it succeeds', () => {
    const gate = new NoticeGate()
    gate.automatic('poll script failed')
    expect(gate.manual(null)).toMatchObject({ text: 'Refreshed.' })
    expect(gate.automatic('poll script failed')).toMatchObject({ level: 'error' })
  })
})
