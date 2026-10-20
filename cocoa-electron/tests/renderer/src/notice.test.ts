import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismiss_notice, notify } from '../../../src/renderer/src/notice'
import { app } from '../../../src/renderer/src/state.svelte'
import { reset, send } from '../support/app'

afterEach(reset)

// The transient message: one sentence, the newest one, and a failure that
// waits to be read (the backend's `notices.ts` decides *whether* to speak).
describe('notices', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows what the backend said, at the level it said it', () => {
    send({ kind: 'notice', level: 'error', text: 'poll script failed' })
    expect(app.notice).toEqual({ text: 'poll script failed', level: 'error' })
  })

  it('lets an ordinary message fade', () => {
    vi.useFakeTimers()
    notify('Folder added.')
    vi.advanceTimersByTime(4000)
    expect(app.notice).toBeNull()
  })

  // A failure that fades before it is read is the same as no failure shown.
  it('keeps a failure up until it is dismissed', () => {
    vi.useFakeTimers()
    send({ kind: 'notice', level: 'error', text: 'poll script failed' })
    vi.advanceTimersByTime(60_000)
    expect(app.notice?.text).toBe('poll script failed')

    dismiss_notice()
    expect(app.notice).toBeNull()
  })

  it('replaces a standing failure with whatever happened since', () => {
    send({ kind: 'notice', level: 'error', text: 'poll script failed' })
    notify('Folder added.')
    expect(app.notice).toEqual({ text: 'Folder added.', level: 'info' })
  })

  // The older message's timer must not take down the newer one, which is why
  // the timer is keyed by a counter rather than by comparing the text.
  it('does not let an older timer clear a newer message', () => {
    vi.useFakeTimers()
    notify('Refreshed.')
    vi.advanceTimersByTime(3000)
    notify('Refreshed.')
    vi.advanceTimersByTime(1000)
    expect(app.notice?.text).toBe('Refreshed.')

    vi.advanceTimersByTime(3000)
    expect(app.notice).toBeNull()
  })
})
