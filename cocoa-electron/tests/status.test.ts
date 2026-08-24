// The closed status vocabulary.

import { describe, expect, it } from 'vitest'
import { from_poll_word, is_active, is_cancellable, is_terminal } from '../src/main/engine/status'
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
      expect(is_active(status), status).toBe(!is_terminal(status))
    }
  })

  it('cancels only what is still in the cluster', () => {
    for (const status of ['STARTING', 'PENDING', 'RUNNING', 'UNREACHABLE'] as Status[]) {
      expect(is_cancellable(status), status).toBe(true)
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
      expect(is_cancellable(status), status).toBe(false)
    }
  })

  it('parses the poll vocabulary and nothing else', () => {
    for (const word of ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(from_poll_word(word)).toBe(word)
    }
    // The cluster never says SUCCEEDED: that is cocoa's word, said after the
    // report lands (§9).
    expect(from_poll_word('SUCCEEDED')).toBeNull()
    expect(from_poll_word('DONE')).toBeNull()
    expect(from_poll_word('')).toBeNull()
  })
})
