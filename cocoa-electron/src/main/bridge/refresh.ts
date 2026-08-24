// The refresh loop: one tick, and what the user hears about it.

import { some } from '@shared/maybe'
import { engine, notices } from '../runtime'
import { refresh_summary } from './notices'
import { announce, message_of, publish_refreshed } from './publish'
import { send } from '../shell/window'
import { log_for } from '../log'

const log = log_for('refresh')

/** How often the engine refreshes: polls, auto-reports, harvests (§7.5). */
export const REFRESH_INTERVAL_MS = 3_000

// Refreshes never overlap: two in a row would only run the same poll scripts
// twice. The clock's tick is dropped while one is under way. A person's
// refresh is queued behind it instead, and there is at most one of those:
// the status bar holds its button down until the answer comes, so a second
// one can only be a stray, and a stray is ignored.
// @ai use /** */ for comments, and use Maybe for this type
let current: Promise<void> | null = null
/** Whether a person's refresh is queued or running. */
let manual_pending = false

/**
 * One refresh. `manual` is the difference between the clock asking and a
 * person asking: the clock's is dropped while a pass is under way; a
 * person's waits for it and then runs, and always answers — unless one is
 * already pending, in which case this one is ignored.
 */
export async function refresh_and_publish(manual = false): Promise<void> {
  // auto refresh
  if (!manual) {
    // canceled
    if (current !== null) {
      return
    }
    await hold(one_refresh(false))
    return
  }
  if (manual_pending) {
    return
  }
  manual_pending = true
  try {
    // Queued behind whatever is under way. `current` is never empty in
    // between, so no tick slips in ahead of it.
    await hold((current ?? Promise.resolve()).then(() => one_refresh(true)))
  } finally {
    manual_pending = false
  }
}

/** Keeps `current` for the length of one pass, however it ends. */
async function hold(pass: Promise<void>): Promise<void> {
  const done = pass.then(
    () => undefined,
    () => undefined
  )
  current = done
  try {
    await pass
  } finally {
    if (current === done) {
      current = null
    }
  }
}

async function one_refresh(manual: boolean): Promise<void> {
  try {
    const report = await engine.refresh()
    const summary = refresh_summary(report)
    for (const error of [...report.launch_errors, ...report.poll_errors, ...report.report_errors]) {
      log.error(error.message)
    }
    const notice = manual ? some(notices.manual(summary)) : notices.automatic(summary)
    publish_refreshed(announce(notice))
  } catch (error) {
    // The refresh itself came apart — no report, and so nothing to publish.
    // The gate still decides whether this is news.
    log.error('failed:', error)
    const message = some(message_of(error))
    send(announce(manual ? some(notices.manual(message)) : notices.automatic(message)))
  }
}
