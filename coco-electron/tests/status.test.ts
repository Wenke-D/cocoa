// The closed status vocabulary. Ported from engine/status.rs's inline tests.

import { describe, expect, it } from 'vitest'
import { fromPollWord, isActive, isCancellable, isTerminal } from '../src/main/engine/status'
import type { Status } from '../src/main/engine/status'

const ALL: Status[] = [
  'STARTING',
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'ANALYZING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLING',
  'CANCELLED',
  'UNREACHABLE',
  'ERROR'
]

describe('status', () => {
  it('makes terminal and active complements', () => {
    for (const status of ALL) {
      expect(isActive(status), status).toBe(!isTerminal(status))
    }
  })

  it('cancels only what is still in the cluster', () => {
    for (const status of ['STARTING', 'PENDING', 'RUNNING', 'UNREACHABLE'] as Status[]) {
      expect(isCancellable(status), status).toBe(true)
    }
    for (const status of [
      'COMPLETED',
      'ANALYZING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLING',
      'CANCELLED',
      'ERROR'
    ] as Status[]) {
      expect(isCancellable(status), status).toBe(false)
    }
  })

  it('parses the poll vocabulary and nothing else', () => {
    for (const word of ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(fromPollWord(word)).toBe(word)
    }
    // The cluster never says SUCCEEDED: that is coco's word, said after the
    // report lands (§9).
    expect(fromPollWord('SUCCEEDED')).toBeNull()
    expect(fromPollWord('DONE')).toBeNull()
    expect(fromPollWord('')).toBeNull()
  })
})
