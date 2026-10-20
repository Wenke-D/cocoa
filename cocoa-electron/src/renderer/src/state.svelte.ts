// The renderer's whole mutable state, as one rune. Every other module reads
// and writes it through `app`.

import { load_ui_state, store_ui_state } from './ui_state'
import { empty_world } from '@shared/world'
import type { World } from '@shared/world'
import type { JournalEntry } from './journal'
import type { SidebarView } from './navigation'
import type { Notice } from './notice'
import type { Overlay } from './overlays.svelte'
import type { Prefill } from './prefill.svelte'
import type { Route } from './route'

/**
 * The renderer's whole mutable state (specification §34). Named rather than
 * inferred: written inline, `route` would infer as the literal shape of the
 * empty page and reject every other route.
 */
export interface AppState {
  connected: boolean
  /** A mirror of the backend's world, never a source: only events write it. */
  world: World
  route: Route
  overlay: Overlay | null
  prefill: Prefill | null
  notice: Notice | null
  /** What happened, oldest first, as this side phrased it (`journal.ts`). */
  journal: JournalEntry[]
  // Arrangement, not content: persisted across launches (see `flush_ui`).
  sidebar_width: number
  sidebar_view: SidebarView
  sidebar_open: boolean
  /** The Explorer's CAMPAIGNS pane, as a share of its height. */
  explorer_split: number
  report_wrap: boolean
  /** The one clock every duration on screen is computed from. */
  now_ms: number
}

// The arrangement from the last session, read synchronously — localStorage
// is the renderer's own. It is layout only: where the user *was* is
// deliberately not restored — a day later nobody remembers where that was,
// and what helps is the Explorer with nothing selected (§32) — so every
// launch opens there.
const arranged = load_ui_state()

export const app: AppState = $state({
  connected: false,
  world: empty_world(),
  route: { page: 'empty' },
  overlay: null,
  prefill: null,
  notice: null,
  journal: [],
  sidebar_width: arranged.sidebar_width,
  sidebar_view: 'explorer',
  sidebar_open: true,
  explorer_split: arranged.explorer_split,
  report_wrap: arranged.report_wrap_lines,
  now_ms: Date.now()
})

/**
 * Writes the arrangement to localStorage. Called once, as the page unloads —
 * while the page runs the arrangement lives in `app`, and nothing else
 * needs it.
 */
export function flush_ui(): void {
  store_ui_state({
    sidebar_width: app.sidebar_width,
    explorer_split: app.explorer_split,
    report_wrap_lines: app.report_wrap
  })
}
