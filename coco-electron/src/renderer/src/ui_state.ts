// Where the user was, and how they had things arranged — the renderer's own
// domain, owned end to end: held in `state.svelte.ts` while the page runs,
// written to localStorage as the page unloads (`flush_ui`), read back at the
// next launch. The main process never sees any of it; the window's geometry
// is the main process's own record (`main/window_state.ts`), and the two
// never meet in one object.
//
// `sanitize` is what a stored state has to survive before it is trusted:
// values out of range fall back to their defaults, and routes that make no
// sense to *restore* — a report, a Start draft — become the page they
// belonged to. Routes pointing at something the world no longer contains are
// not its business: whether an experiment still exists is a question only
// the world can answer, and `recover()` asks it once the bootstrap has
// landed.

import { from_nullable } from '@shared/maybe'

/**
 * Which page a report was opened from. A run dispatched by a bench has two
 * addresses (§2.3.1), so the report of one run does too: the context, not the
 * run's origin, decides the breadcrumbs and which Explorer row stays
 * selected.
 */
export type ReportContext =
  | { kind: 'job_run'; job_id: string }
  | { kind: 'bench_run'; bench_id: string }
  | { kind: 'bench_child'; bench_id: string; bench_run_id: string }

/** An address, never content. */
export type Route =
  | { page: 'empty' }
  | { page: 'entity'; entity_id: string }
  | { page: 'start'; entity_id: string }
  | { page: 'job_run'; job_id: string; run_id: string }
  | { page: 'bench_run'; bench_id: string; run_id: string }
  /** A run dispatched by a bench, seen in the bench's context (§19). */
  | { page: 'bench_child'; bench_id: string; bench_run_id: string; run_id: string }
  | { page: 'report'; context: ReportContext; run_id: string }

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

/** What the renderer arranges and remembers, and nobody else. */
export interface UiState {
  /** Which page is open. */
  route: Route
  sidebar_width: number
  /** Whether the report's plain-text view wraps long lines instead of scrolling. */
  report_wrap_lines: boolean
}

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 400

export function default_ui_state(): UiState {
  return {
    route: { page: 'empty' },
    sidebar_width: SIDEBAR_DEFAULT_WIDTH,
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
 * What a stored `UiState` becomes before it is used — the port of
 * `UiState::sanitize`. Two kinds of repair happen here and nowhere else:
 * values that are simply out of range, and routes that make no sense to
 * *restore* even though they were fine to visit.
 */
export function sanitize(state: Partial<UiState> | null | undefined): UiState {
  const restored = { ...default_ui_state(), ...(state ?? {}) }

  restored.sidebar_width = clamp(
    restored.sidebar_width,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_DEFAULT_WIDTH
  )
  restored.report_wrap_lines = restored.report_wrap_lines === true
  restored.route = sanitize_route(restored.route)
  return restored
}

function sanitize_route(route: Route | null | undefined): Route {
  const empty: Route = { page: 'empty' }
  if (route === null || route === undefined || typeof route !== 'object') {
    return empty
  }
  switch (route.page) {
    case 'empty':
      return empty
    case 'entity':
      return typeof route.entity_id === 'string' ? route : empty
    // A report is read from disk when it is opened, and the file may be gone,
    // rewritten, or enormous by now. Restoring the address would make the
    // first thing a relaunch does a disk read nobody asked for.
    case 'report':
      return empty
    // A route is restored and a Start draft is not, so restoring the page
    // would open an empty form nobody asked for. Land on the experiment it
    // belonged to instead (§15).
    case 'start':
      return typeof route.entity_id === 'string'
        ? { page: 'entity', entity_id: route.entity_id }
        : empty
    case 'job_run':
      return typeof route.job_id === 'string' && typeof route.run_id === 'string' ? route : empty
    case 'bench_run':
      return typeof route.bench_id === 'string' && typeof route.run_id === 'string' ? route : empty
    case 'bench_child':
      return typeof route.bench_id === 'string' &&
        typeof route.bench_run_id === 'string' &&
        typeof route.run_id === 'string'
        ? route
        : empty
    default:
      // A page name this build does not know: an older or newer file, or one
      // edited by hand.
      return empty
  }
}
