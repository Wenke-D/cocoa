// What the user is told about a refresh, and how often.
//
// The engine refreshes every three seconds, so a cluster that answers badly
// answers badly on every one of them: the question worth putting on screen is
// never "did this pass fail" but "is this a new failure". That judgement is
// the whole of this module — the backend makes it, as it makes every other
// judgement about change (see `sync.ts`), and the renderer only hears
// conclusions.
//
// The Rust worker avoids the same flood differently: its automatic tick
// swallows errors entirely (`let _ = self.coco.refresh()` in
// `adapter/engine.rs`) and only an explicit Refresh reports. That is quieter
// than it should be — a poll script that will not run at all is invisible
// until somebody happens to press refresh, and no run row can carry it,
// because the failure is that there is no answer. Announcing a failure once
// and then holding still is the same silence with the first sentence kept.

import type { CocoEvent } from '@shared/world'
import type { RefreshReport } from './engine/coco'
import type { Maybe } from './types'

/** Just the parts of a refresh report that can carry a failure. */
type Errors = Pick<RefreshReport, 'launchErrors' | 'pollErrors' | 'reportErrors'>

/**
 * The one sentence a failed refresh gets: the first error in full, the rest
 * as a count. Mirrors the Rust adapter's `refresh()` — a status bar has room
 * for a sentence, and the run rows carry the detail.
 */
export function refreshSummary(report: Errors): Maybe<string> {
  const errors = [...report.launchErrors, ...report.pollErrors, ...report.reportErrors].map(
    (error) => error.message
  )
  if (errors.length === 0) return null
  if (errors.length === 1) return errors[0]
  return `${errors[0]} (and ${errors.length - 1} more)`
}

function error(text: string): CocoEvent {
  return { kind: 'notice', level: 'error', text }
}

/**
 * Remembers what has already been said, so a failure that repeats every tick
 * is announced once.
 */
export class NoticeGate {
  /** The failure currently standing; `null` when the last pass was clean. */
  private announced: Maybe<string> = null

  /**
   * A refresh nobody asked for. It speaks only when the situation changes:
   * a new failure, or the same failure after a pass that worked. A clean pass
   * says nothing at all — recovery shows in the run rows, which go back to
   * carrying real statuses.
   */
  automatic(summary: Maybe<string>): Maybe<CocoEvent> {
    if (summary === null) {
      this.announced = null
      return null
    }
    if (summary === this.announced) return null
    this.announced = summary
    return error(summary)
  }

  /**
   * A refresh the user asked for always answers, even when the answer is
   * "nothing was wrong" — a button that can do nothing visible is a button
   * you cannot tell is working (§8.5, as the Rust worker's `Refresh` does).
   * Its answer also counts as said, so the tick that follows a reported
   * failure does not repeat it.
   */
  manual(summary: Maybe<string>): CocoEvent {
    this.announced = summary
    return summary === null ? { kind: 'notice', level: 'info', text: 'Refreshed.' } : error(summary)
  }
}
