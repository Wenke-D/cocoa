// Where the user was, and how they had things arranged — the port's half of
// coco's `UiState` (`src/app.rs`) plus its `Route` (`src/navigation/route.rs`).
//
// It lives in `shared` because both sides need it: the renderer holds it, the
// main process persists it, and `sanitize` is what a file that has been sitting
// on disk since the last launch has to survive before either of them trusts it.

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

/** An address, never content — the same union as `navigation/route.rs`. */
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

/** Where and how big the window was. eframe persists this for the Rust app. */
export interface WindowBounds {
  width: number
  height: number
  x: number | null
  y: number | null
}

/**
 * What survives a relaunch. Everything else the renderer holds — overlays, the
 * Start draft, the transient notice — is deliberately not here: a modal is an
 * action rather than a place (§9), and half a filled-in form is not one either.
 */
export interface UiState {
  route: Route
  sidebar_width: number
  report_wrap_lines: boolean
  window: WindowBounds | null
}

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 400

/** The window the first launch gets, and the floor a restored one is held to. */
export const WINDOW_DEFAULT = { width: 1280, height: 820 }
export const WINDOW_MIN = { width: 900, height: 600 }

export function default_ui_state(): UiState {
  return {
    route: { page: 'empty' },
    sidebar_width: SIDEBAR_DEFAULT_WIDTH,
    report_wrap_lines: false,
    window: null
  }
}

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(high, Math.max(low, value))
}

/**
 * What a restored `UiState` becomes before it is used — the port of
 * `UiState::sanitize`. Two kinds of repair happen here and nowhere else:
 * values that are simply out of range, and routes that make no sense to
 * *restore* even though they were fine to visit.
 *
 * Routes that point at something the world no longer contains are not this
 * function's business: whether an experiment still exists is a question only
 * the world can answer, and `recover()` asks it once the bootstrap has landed.
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
  restored.window = sanitize_window(restored.window)
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

function sanitize_window(bounds: WindowBounds | null | undefined): WindowBounds | null {
  if (bounds === null || bounds === undefined || typeof bounds !== 'object') {
    return null
  }
  const width = clamp(bounds.width, WINDOW_MIN.width, Number.MAX_SAFE_INTEGER, WINDOW_DEFAULT.width)
  const height = clamp(
    bounds.height,
    WINDOW_MIN.height,
    Number.MAX_SAFE_INTEGER,
    WINDOW_DEFAULT.height
  )
  // A position is restored only if it is a pair of real numbers; anything else
  // is left to the platform, which knows where a new window belongs.
  const usable =
    typeof bounds.x === 'number' &&
    Number.isFinite(bounds.x) &&
    typeof bounds.y === 'number' &&
    Number.isFinite(bounds.y)
  return { width, height, x: usable ? bounds.x : null, y: usable ? bounds.y : null }
}
