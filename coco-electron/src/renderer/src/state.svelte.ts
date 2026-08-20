// The renderer's whole mutable state, as one rune. `Route` is the same
// discriminated union coco's `src/navigation/route.rs` models: an address,
// never content. `recover` mirrors `Route::recover` — a restored or stale
// address pointing at something the world no longer contains is repaired,
// with a message.

import { default_ui_state } from '@shared/ui'
import type { Route, ReportContext, UiState } from '@shared/ui'
import { bench_run, empty_world, is_active, job_run } from '@shared/world'
import type {
  AddFolderResult,
  BenchRun,
  RemoveFolderResult,
  CancelResult,
  CancelTarget,
  CocoEvent,
  Entity,
  JobRun,
  NoticeLevel,
  RunsByEntity,
  World
} from '@shared/world'

// `Route` and `ReportContext` are shared with the main process, which persists
// them; re-exported here because this module is where the renderer reaches for
// everything about where it is.
export type { ReportContext, Route } from '@shared/ui'

/**
 * A modal is a temporary action, not a place (specification §9), so it is
 * kept out of `Route` — it is never persisted and never restored.
 */
export type Overlay = { error: string | null; busy: boolean } & (
  { kind: 'confirm_cancel'; target: CancelTarget } | { kind: 'confirm_remove'; entity_id: string }
)

/** An open context menu: which row, and where the pointer was. */
export interface ContextMenu {
  entity_id: string
  x: number
  y: number
}

/**
 * The transient message — coco's `TransientMessage`, shown here as the toast
 * above the status bar. There is only ever one: the newest thing to say is
 * the thing worth saying, and a stack of them is the verbose log §8.5 rules
 * out.
 */
export interface Notice {
  text: string
  level: NoticeLevel
}

/**
 * The renderer's whole mutable state (specification §34). Named rather than
 * inferred: written inline, `route` would infer as the literal shape of the
 * empty page and reject every other route, which is why each field used to
 * need widening with `as`.
 */
export interface AppState {
  connected: boolean
  /** A mirror of the backend's world, never a source: only events write it. */
  world: World
  route: Route
  overlay: Overlay | null
  menu: ContextMenu | null
  notice: Notice | null
  // Arrangement, not content: persisted across launches (see `persist_ui`).
  sidebar_width: number
  report_wrap: boolean
  /** The one clock every duration on screen is computed from. */
  now_ms: number
}

export const app: AppState = $state({
  connected: false,
  world: empty_world(),
  route: { page: 'empty' },
  overlay: null,
  menu: null,
  notice: null,
  sidebar_width: default_ui_state().sidebar_width,
  report_wrap: default_ui_state().report_wrap_lines,
  now_ms: Date.now()
})

export function navigate(route: Route): void {
  app.route = route
}

/**
 * Opens the folder picker and registers what comes back (§11.5). Cancelling
 * does nothing at all; a registration selects the folder it added, so the
 * user lands on the result of their action rather than wherever they were.
 */
export async function add_folder(): Promise<void> {
  let result: AddFolderResult
  try {
    result = await window.coco.add_folder()
  } catch (error) {
    notify((error as Error).message, 'error')
    return
  }
  if (!result.ok) {
    if (result.cancelled) return
    notify(result.message, 'error')
    return
  }
  app.route = { page: 'entity', entity_id: result.entity_id }
  notify(result.already ? 'That folder is already in the Explorer.' : 'Folder added.')
}

export function request_cancel(target: CancelTarget): void {
  app.overlay = { kind: 'confirm_cancel', target, error: null, busy: false }
}

export function open_menu(entity_id: string, x: number, y: number): void {
  app.menu = { entity_id, x, y }
}

export function close_menu(): void {
  app.menu = null
}

export function request_remove(entity_id: string): void {
  app.menu = null
  app.overlay = { kind: 'confirm_remove', entity_id, error: null, busy: false }
}

export function close_overlay(): void {
  app.overlay = null
}

/**
 * Takes the folder out of the Explorer (§36 — removed from the Explorer, not
 * deleted from disk). As with cancel, the overlay stays open until the
 * backend answers: closed by success, annotated by failure.
 */
export async function confirm_remove(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirm_remove' || overlay.busy) return
  overlay.busy = true
  overlay.error = null

  // Leave the entity's page *before* asking, so `recover()` has nothing to
  // repair: its message ("that run is no longer listed") explains an
  // accident, and this is not one — the user asked for it. The route is put
  // back if the removal is refused.
  const previous = app.route
  if (selected_entity_id() === overlay.entity_id) app.route = { page: 'empty' }

  let result: RemoveFolderResult
  try {
    result = await window.coco.remove_folder(overlay.entity_id)
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }

  if (app.overlay !== overlay) return
  if (result.ok) {
    app.overlay = null
    notify('Removed from the Explorer. The folder is untouched on disk.')
    return
  }
  app.route = previous
  overlay.busy = false
  overlay.error = result.message
  notify(result.message, 'error')
}

/**
 * Confirms the open cancel. The overlay stays open until the backend answers:
 * closed by success, annotated by failure. The user is left where they were
 * either way (§16.3) — a cancel is not a navigation.
 */
export async function confirm_cancel(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirm_cancel' || overlay.busy) return
  overlay.busy = true
  overlay.error = null

  // `$state.snapshot` because a proxy cannot cross IPC: structured clone
  // refuses it, and the rejection would otherwise leave this overlay busy
  // for ever. Nothing here may wedge the modal, so the call is guarded too.
  let result: CancelResult
  try {
    result = await window.coco.cancel($state.snapshot(overlay.target))
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }

  // The user may have dismissed it while the script ran; that overlay is
  // gone, and its answer is not this one's business.
  if (app.overlay !== overlay) return
  if (result.ok) {
    app.overlay = null
    return
  }
  overlay.busy = false
  overlay.error = result.message
  notify(result.message, 'error')
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
  if (level === 'error') return
  setTimeout(() => {
    if (notice_seq === mine) app.notice = null
  }, NOTICE_MS)
}

export function dismiss_notice(): void {
  app.notice = null
}

/**
 * The status bar's refresh (§8.5). It always answers — the backend sends the
 * notice, success included — so nothing is said here; only the transport
 * failing is this side's to report.
 */
export async function refresh_now(): Promise<void> {
  try {
    await window.coco.refresh_now()
  } catch (error) {
    notify((error as Error).message, 'error')
  }
}

/** The one full-state message: a fresh page owns nothing. */
export async function bootstrap(): Promise<void> {
  const payload = await window.coco.bootstrap()
  app.world = payload.world
  // The arrangement comes back already sanitized (`@shared/ui`), so what is
  // left to repair is what only the world can answer: an address pointing at
  // an experiment that has since been removed. `recover()` does that below.
  app.route = payload.ui.route
  app.sidebar_width = payload.ui.sidebar_width
  app.report_wrap = payload.ui.report_wrap_lines
  app.connected = true
  restored = true
  recover()
}

/**
 * Nothing is written until the restored state has been applied. Otherwise the
 * first effect of a launch — the default route, before the bootstrap answers —
 * would overwrite the file it is about to read.
 */
let restored = false

/** Coalesces a drag's hundred widths into one write. */
let persist_timer: ReturnType<typeof setTimeout> | null = null

/**
 * Remembers the arrangement. Called from an effect, so it runs on every route
 * change including the ones `recover()` makes — being put back on the Explorer
 * because an experiment is gone is exactly the state worth remembering.
 */
export function persist_ui(): void {
  if (!restored) return
  if (persist_timer !== null) clearTimeout(persist_timer)
  // The state is read when the timer fires, not when it is set: a drag's
  // hundred widths must collapse to the width it ended on.
  persist_timer = setTimeout(() => {
    persist_timer = null
    const state: UiState = {
      route: $state.snapshot(app.route),
      sidebar_width: app.sidebar_width,
      report_wrap_lines: app.report_wrap,
      // The window is the main process's to know; it fills this in.
      window: null
    }
    void window.coco.save_ui(state)
  }, 300)
}

/**
 * Applies one batch of backend events. The renderer never judges change —
 * the backend already did; this only makes the model say what it was told.
 */
export function apply_events(events: CocoEvent[]): void {
  const world = app.world
  for (const event of events) {
    switch (event.kind) {
      case 'entity-upserted': {
        const at = world.entities.findIndex((entity) => entity.id === event.entity.id)
        if (at >= 0) world.entities[at] = event.entity
        else world.entities.push(event.entity)
        break
      }
      case 'entity-removed':
        world.entities = world.entities.filter((entity) => entity.id !== event.id)
        break
      case 'job-run-upserted':
        upsert_run(world.job_runs, world.runs_by_job, event.run, event.run.job_id)
        break
      case 'job-run-removed':
        remove_run(world.job_runs, world.runs_by_job, event.job_id, event.id)
        break
      case 'bench-run-upserted':
        upsert_run(world.bench_runs, world.runs_by_bench, event.run, event.run.bench_id)
        break
      case 'bench-run-removed':
        remove_run(world.bench_runs, world.runs_by_bench, event.bench_id, event.id)
        break
      case 'refreshed':
        world.last_refresh = event.at
        app.connected = true
        break
      // The backend already decided this was worth saying, and how loudly;
      // the renderer only shows it.
      case 'notice':
        notify(event.text, event.level)
        break
    }
  }
  recover()
}

/** Inserts into the entity's index sorted by start time, oldest first. */
function upsert_run<Run extends { id: string; started_at: string }>(
  runs: RunsByEntity<Run>,
  index: Record<string, string[]>,
  run: Run,
  owner_id: string
): void {
  // Read both back after creating them. `x[o] ?? (x[o] = {})` hands back the
  // raw value the assignment evaluated to, not the `$state` proxy that now
  // stands in its place — every later write would then go through the back of
  // the store and change nothing on screen. That is why an entity's *first*
  // run never lit its Explorer dot, and it applies to the run map for exactly
  // the same reason it applies to the index.
  if (runs[owner_id] === undefined) runs[owner_id] = {}
  const mine = runs[owner_id]
  mine[run.id] = run

  if (index[owner_id] === undefined) index[owner_id] = []
  const list = index[owner_id]
  const existing = list.indexOf(run.id)
  if (existing >= 0) list.splice(existing, 1)
  const start_ms = Date.parse(run.started_at)
  let position = list.length
  for (let i = 0; i < list.length; i += 1) {
    const other = mine[list[i]]
    if (other !== undefined && Date.parse(other.started_at) > start_ms) {
      position = i
      break
    }
  }
  list.splice(position, 0, run.id)
}

/**
 * The event names the owner, so this no longer has to search every index for
 * a bare id — which it could only do while ids were globally unique.
 */
function remove_run(
  runs: RunsByEntity<JobRun> | RunsByEntity<BenchRun>,
  index: Record<string, string[]>,
  owner_id: string,
  id: string
): void {
  const mine = runs[owner_id]
  if (mine !== undefined) delete mine[id]
  const list = index[owner_id]
  if (list === undefined) return
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
}

export function entity_of(id: string): Entity | undefined {
  return app.world.entities.find((entity) => entity.id === id)
}

/**
 * Which Explorer row stays highlighted — `Route::selected_entity`.
 *
 * Viewing a dispatched run through its bench keeps the *bench* selected, even
 * though the run belongs to a job that is in the Explorer too (§19). Arriving
 * that way must not move the selection to the job; the job's name on the page
 * is the explicit way there.
 */
export function selected_entity_id(): string | null {
  const route = app.route
  switch (route.page) {
    case 'empty':
      return null
    case 'entity':
    case 'start':
      return route.entity_id
    case 'job_run':
      return route.job_id
    case 'bench_run':
    case 'bench_child':
      return route.bench_id
    case 'report':
      return context_entity_id(route.context)
  }
}

export function context_entity_id(context: ReportContext): string {
  return context.kind === 'job_run' ? context.job_id : context.bench_id
}

/**
 * Whose folder the report file is actually in — which is not the same
 * question as whose context it is being read under. A run dispatched by a
 * bench writes its report into the *job's* folder, because that is where the
 * run happened; the bench is only how the reader arrived (§2.3.1, §20.1).
 */
export function report_owner_id(context: ReportContext, run_id: string): string {
  if (context.kind === 'bench_child') {
    return dispatched_owner(context.bench_id, context.bench_run_id, run_id) ?? context.bench_id
  }
  return context_entity_id(context)
}

/**
 * Which job a dispatched run belongs to, read from the bench run's own plan.
 *
 * The plan is the authoritative link between the two (§2.3.1), and now the
 * only one: a run id means nothing without the experiment it was allocated
 * in, so there is no map to look a bare child id up in.
 */
export function dispatched_owner(
  bench_id: string,
  bench_run_id: string,
  run_id: string
): string | undefined {
  const bench = bench_run(app.world, bench_id, bench_run_id)
  return bench?.plan.steps.find((step) => step.run_id === run_id)?.job_id
}

/** Repairs a route — and closes an overlay — the world can no longer answer for. */
export function recover(): void {
  const route = app.route
  const world = app.world

  const entity_gone = (id: string): boolean => entity_of(id) === undefined

  // A confirmation about a run that is no longer listed has nothing left to
  // confirm; it closes rather than asking about a ghost.
  // An overlay with an operation in flight is left alone: it is about to
  // answer for itself, and closing it here would throw that answer away —
  // including the confirmation for a removal that has just succeeded.
  const overlay = app.overlay
  if (overlay !== null && !overlay.busy) {
    const gone =
      overlay.kind === 'confirm_cancel'
        ? overlay.target.kind === 'job_run'
          ? job_run(world, overlay.target.job_id, overlay.target.run_id) === undefined
          : bench_run(world, overlay.target.bench_id, overlay.target.run_id) === undefined
        : entity_gone(overlay.entity_id)
    if (gone) app.overlay = null
  }
  // A menu about a row that is no longer there closes with it.
  if (app.menu !== null && entity_gone(app.menu.entity_id)) app.menu = null

  switch (route.page) {
    case 'empty':
      return
    case 'entity':
    case 'start':
      if (entity_gone(route.entity_id)) {
        app.route = { page: 'empty' }
        notify('That experiment is no longer in the Explorer.')
      }
      return
    case 'job_run':
      if (job_run(world, route.job_id, route.run_id) === undefined) {
        app.route = entity_gone(route.job_id)
          ? { page: 'empty' }
          : { page: 'entity', entity_id: route.job_id }
        notify('That run is no longer listed.')
      }
      return
    case 'bench_run':
      if (bench_run(world, route.bench_id, route.run_id) === undefined) {
        app.route = entity_gone(route.bench_id)
          ? { page: 'empty' }
          : { page: 'entity', entity_id: route.bench_id }
        notify('That run is no longer listed.')
      }
      return
    // Two runs have to still exist for this address to mean anything: the
    // dispatched run it shows, and the bench run whose context it is seen in.
    // Losing the child falls back to the bench run, which is where the user
    // came from; losing the bench run itself falls back further.
    case 'bench_child': {
      if (bench_run(world, route.bench_id, route.bench_run_id) === undefined) {
        app.route = entity_gone(route.bench_id)
          ? { page: 'empty' }
          : { page: 'entity', entity_id: route.bench_id }
        notify('That run is no longer listed.')
        return
      }
      // Which job the child belongs to comes from the bench's plan; if the
      // plan no longer lists it, it is gone by the same test.
      const job_id = dispatched_owner(route.bench_id, route.bench_run_id, route.run_id)
      if (job_id === undefined || job_run(world, job_id, route.run_id) === undefined) {
        app.route = { page: 'bench_run', bench_id: route.bench_id, run_id: route.bench_run_id }
        notify('That dispatched run is no longer listed.')
      }
      return
    }
    case 'report': {
      // A report is read from disk on open, so the world cannot say whether
      // the file is still there; what it can say is whether the run and its
      // entity are still listed.
      const entity_id = context_entity_id(route.context)
      // A report opened from a dispatched run is a *job* run's report, even
      // though the context is the bench's — the same two-addresses rule. The
      // owner is what says which map to look in, and for a dispatched run
      // that owner comes from the plan.
      const owner_id = report_owner_id(route.context, route.run_id)
      const run =
        route.context.kind === 'bench_run'
          ? bench_run(world, owner_id, route.run_id)
          : job_run(world, owner_id, route.run_id)
      if (run === undefined) {
        app.route = entity_gone(entity_id) ? { page: 'empty' } : { page: 'entity', entity_id }
        notify('That run is no longer listed.')
      }
      return
    }
  }
}

/** Whether an entity has any active run — the sidebar's activity dot. */
export function has_active_run(entity: Entity): boolean {
  const world = app.world
  if (entity.kind === 'Job') {
    const ids = world.runs_by_job[entity.id] ?? []
    return ids.some((id) => {
      const run = job_run(world, entity.id, id)
      return run !== undefined && is_active(run.status)
    })
  }
  const ids = world.runs_by_bench[entity.id] ?? []
  return ids.some((id) => {
    const run = bench_run(world, entity.id, id)
    return run !== undefined && is_active(run.status)
  })
}

/** Top-bar count, mirroring `World::active_run_count`: direct job runs plus
 * bench runs, never counting dispatched children twice. */
export function active_run_count(): number {
  const world = app.world
  const direct = Object.values(world.job_runs)
    .flatMap((runs) => Object.values(runs))
    .filter(
      (run) => is_active(run.status) && (run.origin === 'Human' || run.origin === 'Agent')
    ).length
  const benches = Object.values(world.bench_runs)
    .flatMap((runs) => Object.values(runs))
    .filter((run) => is_active(run.status)).length
  return direct + benches
}
