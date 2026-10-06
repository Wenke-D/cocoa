// How the user had things arranged — the renderer's own domain, owned end to
// end: held in `state.svelte.ts` while the page runs, written to localStorage
// as the page unloads (`flush_ui`), read back at the next launch. The main
// process never sees any of it; the window's geometry is the main process's
// own record (`main/window_state.ts`), and the two never meet in one object.
//
// Deliberately *not* here: where the user was. A launch always opens on the
// Explorer with nothing selected (§32) — a day later nobody remembers where
// they were, and the page that helps is the list of experiments, not
// yesterday's run. So the route, the sidebar's view and whether it was open
// are session state, gone at quit; what persists is the layout a hand tuned:
// widths, the divider, the report wrap.
//
// `sanitize` is what a stored state has to survive before it is trusted:
// values out of range fall back to their defaults.

import { from_nullable } from '@shared/maybe'
import type { ReportFormat } from '@shared/world'

/**
 * Which page a report was opened from. A run dispatched by a campaign has two
 * addresses (§2.3.1), so the report of one run does too: the context, not the
 * run's origin, decides the breadcrumbs and which Explorer row stays
 * selected.
 */
export type ReportContext =
  | { kind: 'job_run'; job_id: string }
  | { kind: 'campaign_run'; campaign_id: string }
  | { kind: 'campaign_child'; campaign_id: string; campaign_run_id: string }

/** An address, never content. */
export type Route =
  | { page: 'empty' }
  | { page: 'entity'; entity_id: string }
  | { page: 'start'; entity_id: string }
  | { page: 'job_run'; job_id: string; run_id: string }
  | { page: 'campaign_run'; campaign_id: string; run_id: string }
  /** A run dispatched by a campaign, seen in the campaign's context (§19). */
  | { page: 'campaign_child'; campaign_id: string; campaign_run_id: string; run_id: string }
  | { page: 'report'; context: ReportContext; run_id: string; format: ReportFormat }

/**
 * One breadcrumb — the port of `navigation::Crumb`. `route` is `null` for the
 * trailing crumb: the page you are already on is not a link.
 */
export interface Crumb {
  label: string
  route: Route | null
  /** Run ids and parameters are code; names are not. */
  mono?: boolean
}

/** Which view the sidebar shows, chosen from the activity bar (§8.2). */
export type SidebarView = 'explorer' | 'runs' | 'events'

/** What the renderer arranges and remembers, and nobody else. */
export interface UiState {
  sidebar_width: number
  /** Where the Explorer's horizontal divider sits: CAMPAIGNS' share of the height (§8.3). */
  explorer_split: number
  /** Whether the report's plain-text view wraps long lines instead of scrolling. */
  report_wrap_lines: boolean
}

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 400

export const EXPLORER_DEFAULT_SPLIT = 0.35
export const EXPLORER_MIN_SPLIT = 0.15
export const EXPLORER_MAX_SPLIT = 0.85

export function default_ui_state(): UiState {
  return {
    sidebar_width: SIDEBAR_DEFAULT_WIDTH,
    explorer_split: EXPLORER_DEFAULT_SPLIT,
    report_wrap_lines: false
  }
}

// This module runs in the page, but `tsconfig.node.json` also type-checks it
// through the unit tests, without the DOM lib. The declaration names just the
// sliver of the page this module stands on.
declare const window: {
  localStorage: {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
  }
}

const STORAGE_KEY = 'ui-state'

/** The stored state, sanitized — or the defaults when there is nothing yet. */
export function load_ui_state(): UiState {
  try {
    const text = from_nullable(window.localStorage.getItem(STORAGE_KEY))
    if (text.is_empty()) {
      return default_ui_state()
    }
    return sanitize(JSON.parse(text.value) as Partial<UiState>)
  } catch {
    return default_ui_state()
  }
}

/** Writes the state. A failure costs the arrangement, never the session. */
export function store_ui_state(state: UiState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('ui state:', error)
  }
}

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(high, Math.max(low, value))
}

/**
 * What a stored `UiState` becomes before it is used: values out of range
 * fall back to their defaults. An older file may carry fields this build no
 * longer keeps — a route, a sidebar view — and they are simply not read.
 */
export function sanitize(state: Partial<UiState> | null | undefined): UiState {
  const restored = { ...(state ?? {}) }
  return {
    sidebar_width: clamp(
      restored.sidebar_width ?? SIDEBAR_DEFAULT_WIDTH,
      SIDEBAR_MIN_WIDTH,
      SIDEBAR_MAX_WIDTH,
      SIDEBAR_DEFAULT_WIDTH
    ),
    explorer_split: clamp(
      restored.explorer_split ?? EXPLORER_DEFAULT_SPLIT,
      EXPLORER_MIN_SPLIT,
      EXPLORER_MAX_SPLIT,
      EXPLORER_DEFAULT_SPLIT
    ),
    report_wrap_lines: restored.report_wrap_lines === true
  }
}
