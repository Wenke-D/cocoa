// The refresh gate: which requests run, which wait, which are dropped or
// ignored. The engine is a hand-resolved promise, so each test decides when
// a pass ends.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefreshReport } from '../src/main/engine'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn<() => Promise<RefreshReport>>(),
  publish_refreshed: vi.fn(),
  send: vi.fn()
}))

vi.mock('../src/main/runtime', async () => {
  const { NoticeGate } = await import('../src/main/bridge/notices')
  return { engine: { refresh: mocks.refresh }, notices: new NoticeGate() }
})
vi.mock('../src/main/bridge/publish', () => ({
  announce: () => [],
  message_of: (error: unknown) => String(error),
  publish_refreshed: mocks.publish_refreshed
}))
vi.mock('../src/main/shell/window', () => ({ send: mocks.send }))

import { refresh_and_publish } from '../src/main/bridge/refresh'

function empty_report(): RefreshReport {
  return {
    polls: 0,
    poll_changes: [],
    poll_warnings: [],
    poll_errors: [],
    reports_run: 0,
    report_errors: [],
    launch_errors: []
  }
}

/** A pass that ends when the test says so. */
function pass(): { promise: Promise<RefreshReport>; end: () => void } {
  let end!: () => void
  const promise = new Promise<RefreshReport>((resolve) => {
    end = () => resolve(empty_report())
  })
  return { promise, end }
}

/** Lets every continuation that is ready run. */
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  mocks.refresh.mockReset()
  mocks.publish_refreshed.mockReset()
})

afterEach(async () => {
  // Leave the gate idle for the next test.
  await drain()
})

describe('the refresh gate', () => {
  it("drops the clock's tick while a pass is under way", async () => {
    const first = pass()
    mocks.refresh.mockReturnValueOnce(first.promise)

    const tick = refresh_and_publish()
    await drain()
    await refresh_and_publish()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)

    first.end()
    await tick
    expect(mocks.publish_refreshed).toHaveBeenCalledTimes(1)
  })

  it('takes the next tick once idle again', async () => {
    mocks.refresh.mockResolvedValue(empty_report())
    await refresh_and_publish()
    await refresh_and_publish()
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it("runs a person's refresh after the pass under way, never alongside it", async () => {
    const first = pass()
    const second = pass()
    mocks.refresh.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const tick = refresh_and_publish()
    await drain()
    const manual = refresh_and_publish(true)
    await drain()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)

    first.end()
    await tick
    await drain()
    expect(mocks.refresh).toHaveBeenCalledTimes(2)

    second.end()
    await manual
    expect(mocks.publish_refreshed).toHaveBeenCalledTimes(2)
  })

  it("keeps the clock out while a person's refresh is queued", async () => {
    const first = pass()
    const second = pass()
    mocks.refresh.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const tick = refresh_and_publish()
    await drain()
    const manual = refresh_and_publish(true)
    await drain()
    await refresh_and_publish()
    first.end()
    await tick
    second.end()
    await manual
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it("ignores a second person's refresh while one is queued or running", async () => {
    const first = pass()
    const second = pass()
    mocks.refresh.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const tick = refresh_and_publish()
    await drain()
    const manual = refresh_and_publish(true)
    await drain()
    await refresh_and_publish(true)
    first.end()
    await tick
    await drain()
    await refresh_and_publish(true)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)

    second.end()
    await manual
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it("runs a person's refresh at once when idle, and the next one after it", async () => {
    mocks.refresh.mockResolvedValue(empty_report())
    await refresh_and_publish(true)
    await refresh_and_publish(true)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })
})
