// The refresh loop: one tick, and what the user hears about it.

import { engine, notices, onEngine } from './runtime'
import { refreshSummary } from './notices'
import { announce, messageOf, publishRefreshed } from './publish'
import { send } from './window'

/** How often the engine refreshes: polls, auto-reports, harvests (§7.5). */
export const REFRESH_INTERVAL_MS = 3_000

// A tick that arrives while one is still going is dropped, not queued: two
// refreshes in a row would only run the same poll scripts twice. (A user's
// operation is never dropped — it queues.)
let refreshing = false

/**
 * One refresh. `manual` is the difference between the clock asking and a
 * person asking: a person's refresh is never dropped, and always answers.
 */
export async function refreshAndPublish(manual = false): Promise<void> {
  if (refreshing && !manual) return
  refreshing = true
  try {
    await onEngine(async () => {
      const report = await engine.refresh()
      const summary = refreshSummary(report)
      for (const error of [...report.launchErrors, ...report.pollErrors, ...report.reportErrors]) {
        console.error('refresh:', error.message)
      }
      const notice = manual ? notices.manual(summary) : notices.automatic(summary)
      publishRefreshed(announce(notice))
    })
  } catch (error) {
    // The refresh itself came apart — no report, and so nothing to publish.
    // The gate still decides whether this is news.
    console.error('refresh failed:', error)
    const message = messageOf(error)
    send(announce(manual ? notices.manual(message) : notices.automatic(message)))
  } finally {
    refreshing = false
  }
}
