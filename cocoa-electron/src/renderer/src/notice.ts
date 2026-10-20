import type { NoticeLevel } from '@shared/world'
import { app } from './state.svelte'

/**
 * The transient message — cocoa's `TransientMessage`, shown here as the toast
 * above the status bar. There is only ever one: the newest thing to say is
 * the thing worth saying, and a stack of them is the verbose log §8.5 rules
 * out.
 */
export interface Notice {
  text: string
  level: NoticeLevel
}

/** How long a notice that is not a failure stays up. */
const NOTICE_MS = 4000

/**
 * Counts notices so a fading timer only ever clears its own. Comparing the
 * text would let an older timer take down a newer message that happens to
 * read the same — two identical route repairs in a row, say.
 */
let notice_seq = 0

/**
 * Says one sentence. The last one wins, including over a standing error: what
 * just happened explains the screen the user is looking at now.
 */
export function notify(text: string, level: NoticeLevel = 'info'): void {
  notice_seq += 1
  const mine = notice_seq
  app.notice = { text, level }
  // A failure stays until it is dismissed or replaced. It is the only place a
  // refresh that cannot run reports itself, and a message that fades before
  // it is read is the same as no message at all.
  if (level === 'error') {
    return
  }
  setTimeout(() => {
    if (notice_seq === mine) {
      app.notice = null
    }
  }, NOTICE_MS)
}

export function dismiss_notice(): void {
  app.notice = null
}
