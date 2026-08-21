// The refresh loop: one tick, and what the user hears about it.

import { some } from '@shared/maybe'
import { engine, notices } from './runtime'
import { refresh_summary } from './notices'
import { announce, message_of, publish_refreshed } from './publish'
import { send } from './window'

/** How often the engine refreshes: polls, auto-reports, harvests (§7.5). */
export const REFRESH_INTERVAL_MS = 3_000

// Refreshes never overlap: two in a row would only run the same poll scripts
// twice. The clock's tick is dropped while one is under way; a person's
// refresh waits for it and then runs — never dropped, and always answers.
let current: Promise<void> | null = null

/**
 * One refresh. `manual` is the difference between the clock asking and a
 * person asking: a person's refresh is never dropped, and always answers.
 */
export async function refresh_and_publish(manual = false): Promise<void> {
  while (current !== null) {
    if (!manual) {
      return
    }
    await current
  }
  const pass = one_refresh(manual)
  current = pass.then(
    () => undefined,
    () => undefined
  )
  try {
    await pass
  } finally {
    current = null
  }
}

async function one_refresh(manual: boolean): Promise<void> {
  try {
    const report = await engine.refresh()
    const summary = refresh_summary(report)
    for (const error of [...report.launch_errors, ...report.poll_errors, ...report.report_errors]) {
      console.error('refresh:', error.message)
    }
    const notice = manual ? some(notices.manual(summary)) : notices.automatic(summary)
    publish_refreshed(announce(notice))
  } catch (error) {
    // The refresh itself came apart — no report, and so nothing to publish.
    // The gate still decides whether this is news.
    console.error('refresh failed:', error)
    const message = some(message_of(error))
    send(announce(manual ? some(notices.manual(message)) : notices.automatic(message)))
  }
}
