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
  | { kind: 'jobRun'; jobId: string }
  | { kind: 'benchRun'; benchId: string }
  | { kind: 'benchChild'; benchId: string; benchRunId: string }

/** An address, never content — the same union as `navigation/route.rs`. */
export type Route =
  | { page: 'empty' }
  | { page: 'entity'; entityId: string }
  | { page: 'start'; entityId: string }
  | { page: 'jobRun'; jobId: string; runId: string }
  | { page: 'benchRun'; benchId: string; runId: string }
  /** A run dispatched by a bench, seen in the bench's context (§19). */
  | { page: 'benchChild'; benchId: string; benchRunId: string; runId: string }
  | { page: 'report'; context: ReportContext; runId: string }

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
  sidebarWidth: number
  reportWrapLines: boolean
  window: WindowBounds | null
}

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 400

/** The window the first launch gets, and the floor a restored one is held to. */
export const WINDOW_DEFAULT = { width: 1280, height: 820 }
export const WINDOW_MIN = { width: 900, height: 600 }

export function defaultUiState(): UiState {
  return {
    route: { page: 'empty' },
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    reportWrapLines: false,
    window: null
  }
}

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
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
  const restored = { ...defaultUiState(), ...(state ?? {}) }

  restored.sidebarWidth = clamp(
    restored.sidebarWidth,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_DEFAULT_WIDTH
  )
  restored.reportWrapLines = restored.reportWrapLines === true
  restored.route = sanitizeRoute(restored.route)
  restored.window = sanitizeWindow(restored.window)
  return restored
}

function sanitizeRoute(route: Route | null | undefined): Route {
  const empty: Route = { page: 'empty' }
  if (route === null || route === undefined || typeof route !== 'object') return empty
  switch (route.page) {
    case 'empty':
      return empty
    case 'entity':
      return typeof route.entityId === 'string' ? route : empty
    // A report is read from disk when it is opened, and the file may be gone,
    // rewritten, or enormous by now. Restoring the address would make the
    // first thing a relaunch does a disk read nobody asked for.
    case 'report':
      return empty
    // A route is restored and a Start draft is not, so restoring the page
    // would open an empty form nobody asked for. Land on the experiment it
    // belonged to instead (§15).
    case 'start':
      return typeof route.entityId === 'string'
        ? { page: 'entity', entityId: route.entityId }
        : empty
    case 'jobRun':
      return typeof route.jobId === 'string' && typeof route.runId === 'string' ? route : empty
    case 'benchRun':
      return typeof route.benchId === 'string' && typeof route.runId === 'string' ? route : empty
    case 'benchChild':
      return typeof route.benchId === 'string' &&
        typeof route.benchRunId === 'string' &&
        typeof route.runId === 'string'
        ? route
        : empty
    default:
      // A page name this build does not know: an older or newer file, or one
      // edited by hand.
      return empty
  }
}

function sanitizeWindow(bounds: WindowBounds | null | undefined): WindowBounds | null {
  if (bounds === null || bounds === undefined || typeof bounds !== 'object') return null
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
