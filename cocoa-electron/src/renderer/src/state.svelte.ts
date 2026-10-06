// The renderer's whole mutable state, as one rune. `Route` is an address,
// never content. `recover` repairs a restored or stale address pointing at
// something the world no longer contains, with a message.

import { load_ui_state, store_ui_state } from './ui_state'
import type { Params } from '@shared/params'
import { check_value } from '@shared/params'
import type { Route, ReportContext, SidebarView } from './ui_state'
import { JOURNAL_LENGTH, sentences_of, stamp } from './journal'
import type { JournalEntry, JournalTarget } from './journal'
import { bench_run, empty_world, is_active, job_run } from '@shared/world'
import type {
  AddFolderResult,
  BenchRun,
  RemoveFolderResult,
  CancelResult,
  CancelTarget,
  CocoaEvent,
  Entity,
  JobRun,
  NoticeLevel,
  RunsByEntity,
  StartResult,
  World,
  DeleteTarget,
  DeleteResult,
  RerunReportResult,
  RerunReportTarget
} from '@shared/world'

// Re-exported because this module is where the renderer reaches for
// everything about where it is.
export type { ReportContext, Route, SidebarView } from './ui_state'
export type { JournalEntry, JournalTarget } from './journal'

/**
 * A modal is a temporary action, not a place (specification §9), so it is
 * kept out of `Route` — it is never persisted and never restored.
 */
export type Overlay =
  | ({ error: string | null; busy: boolean } & (
      | { kind: 'confirm_cancel'; target: CancelTarget }
      | { kind: 'confirm_delete'; target: DeleteTarget }
      | { kind: 'confirm_remove'; entity_id: string }
    ))
  /** A refusal that has to be read before anything else happens (§22.6). */
  | { kind: 'refused'; title: string; message: string }

/**
 * Values for the Start page to open with, from a run in the history (§22.6).
 * Handed over once and consumed: the draft then lives in the page, as always.
 */
export interface Prefill {
  entity_id: string
  /** Only values that still fit the manifest: the rest were dropped, and said. */
  values: Params
}

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
  prefill: Prefill | null
  notice: Notice | null
  /** What happened, oldest first, as this side phrased it (`journal.ts`). */
  journal: JournalEntry[]
  // Arrangement, not content: persisted across launches (see `flush_ui`).
  sidebar_width: number
  sidebar_view: SidebarView
  sidebar_open: boolean
  /** The Explorer's BENCHES pane, as a share of its height. */
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
    result = await window.cocoa.add_folder()
  } catch (error) {
    notify((error as Error).message, 'error')
    return
  }
  if (!result.ok) {
    if (result.cancelled) {
      return
    }
    notify(result.message, 'error')
    return
  }
  app.route = { page: 'entity', entity_id: result.entity_id }
  notify(result.already ? 'That folder is already in the Explorer.' : 'Folder added.')
}

/**
 * Re-runs a job run's report by hand (convention §7.3.2). Accepted, the run
 * already reads `Generating` — its events precede the answer — so success
 * says nothing more; a refusal is said, as an error. How the report itself
 * went arrives later, the way an automatic report's does: on the run, and
 * as a notice when it failed.
 */
export async function rerun_report(target: RerunReportTarget): Promise<void> {
  let result: RerunReportResult
  try {
    result = await window.cocoa.rerun_report(target)
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (!result.ok) {
    notify(result.message, 'error')
  }
}

export function request_cancel(target: CancelTarget): void {
  app.overlay = { kind: 'confirm_cancel', target, error: null, busy: false }
}

/** Opens the delete confirmation (§16.4); the modal is the second look. */
export function request_delete(target: DeleteTarget): void {
  app.overlay = { kind: 'confirm_delete', target, error: null, busy: false }
}

/**
 * Deletes the run the open modal points at. On success the run is gone from
 * the world before the modal closes (the events ride the same answer), and
 * a page that was looking at that run steps back to the experiment.
 */
export async function confirm_delete(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirm_delete' || overlay.busy) {
    return
  }
  overlay.busy = true
  overlay.error = null
  let result: DeleteResult
  try {
    result = await window.cocoa.delete_run($state.snapshot(overlay.target))
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (app.overlay !== overlay) {
    return
  }
  if (result.ok) {
    const target = overlay.target
    app.overlay = null
    const entity_id = target.kind === 'job_run' ? target.job_id : target.bench_id
    if (route_shows_run(app.route, target)) {
      navigate({ page: 'entity', entity_id })
    }
    notify(`Run ${target.run_id} deleted.`)
    return
  }
  overlay.busy = false
  overlay.error = result.message
  notify(result.message, 'error')
}

/**
 * Whether `route` is looking at the deleted run — its page, or its report.
 * A run has two addresses (§19): a deleted job run may be on screen as a
 * bench's child, where the route names the bench, so that page steps back
 * on the run id alone; a same-id run of another job is a near miss this
 * accepts, since stepping back from a page is cheap and a page showing a
 * deleted run is not.
 */
function route_shows_run(route: Route, target: DeleteTarget): boolean {
  if (route.page === 'job_run' && target.kind === 'job_run') {
    return route.job_id === target.job_id && route.run_id === target.run_id
  }
  if (route.page === 'bench_run' && target.kind === 'bench_run') {
    return route.bench_id === target.bench_id && route.run_id === target.run_id
  }
  if (route.page === 'bench_child' || route.page === 'report') {
    return route.run_id === target.run_id
  }
  return false
}

export function request_remove(entity_id: string): void {
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
  if (overlay === null || overlay.kind !== 'confirm_remove' || overlay.busy) {
    return
  }
  overlay.busy = true
  overlay.error = null

  // Leave the entity's page *before* asking, so `recover()` has nothing to
  // repair: its message ("that run is no longer listed") explains an
  // accident, and this is not one — the user asked for it. The route is put
  // back if the removal is refused.
  const previous = app.route
  if (selected_entity_id() === overlay.entity_id) {
    app.route = { page: 'empty' }
  }

  let result: RemoveFolderResult
  try {
    result = await window.cocoa.remove_folder(overlay.entity_id)
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }

  if (app.overlay !== overlay) {
    return
  }
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
  if (overlay === null || overlay.kind !== 'confirm_cancel' || overlay.busy) {
    return
  }
  overlay.busy = true
  overlay.error = null

  // `$state.snapshot` because a proxy cannot cross IPC: structured clone
  // refuses it, and the rejection would otherwise leave this overlay busy
  // for ever. Nothing here may wedge the modal, so the call is guarded too.
  let result: CancelResult
  try {
    result = await window.cocoa.cancel($state.snapshot(overlay.target))
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }

  // The user may have dismissed it while the script ran; that overlay is
  // gone, and its answer is not this one's business.
  if (app.overlay !== overlay) {
    return
  }
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

/**
 * The status bar's refresh (§8.5). It always answers — the backend sends the
 * notice, success included — so nothing is said here; only the transport
 * failing is this side's to report.
 */
export async function refresh_now(): Promise<void> {
  try {
    await window.cocoa.refresh_now()
  } catch (error) {
    notify((error as Error).message, 'error')
  }
}

/** The one full-state message: a fresh page owns nothing. */
export async function bootstrap(): Promise<void> {
  const payload = await window.cocoa.bootstrap()
  app.world = payload.world
  // A fresh page owns nothing, the journal included: what happened before
  // this page existed is not something it saw.
  app.journal = []
  app.connected = true
  // The route is the empty page until someone navigates, but a reconnecting
  // page may be mid-session: an address pointing at something the world no
  // longer contains is repaired now.
  recover()
}

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

/**
 * Applies one batch of backend events. The renderer never judges change —
 * the backend already did; this only makes the model say what it was told.
 */
export function apply_events(events: CocoaEvent[]): void {
  const world = app.world
  const at = stamp()
  for (const event of events) {
    // The sentence is judged against the entry as it was, so before the
    // event lands.
    for (const entry of sentences_of(world, event, at)) {
      remember(entry)
    }
    switch (event.kind) {
      case 'entity-upserted': {
        const at = world.entities.findIndex((entity) => entity.id === event.entity.id)
        if (at >= 0) {
          world.entities[at] = event.entity
        } else {
          world.entities.push(event.entity)
        }
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
  if (runs[owner_id] === undefined) {
    runs[owner_id] = {}
  }
  const mine = runs[owner_id]
  mine[run.id] = run

  if (index[owner_id] === undefined) {
    index[owner_id] = []
  }
  const list = index[owner_id]
  const existing = list.indexOf(run.id)
  if (existing >= 0) {
    list.splice(existing, 1)
  }
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
  if (mine !== undefined) {
    delete mine[id]
  }
  const list = index[owner_id]
  if (list === undefined) {
    return
  }
  const at = list.indexOf(id)
  if (at >= 0) {
    list.splice(at, 1)
  }
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
  if (overlay !== null && overlay.kind !== 'refused' && !overlay.busy) {
    const gone =
      overlay.kind === 'confirm_remove'
        ? entity_gone(overlay.entity_id)
        : overlay.target.kind === 'job_run'
          ? job_run(world, overlay.target.job_id, overlay.target.run_id) === undefined
          : bench_run(world, overlay.target.bench_id, overlay.target.run_id) === undefined
    if (gone) {
      app.overlay = null
    }
  }

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

// ---------------------------------------------------------------------------
// The journal, and the sidebar's views (§8.2, §11.1).

/** Keeps the newest `JOURNAL_LENGTH`. */
function remember(entry: JournalEntry): void {
  app.journal.push(entry)
  if (app.journal.length > JOURNAL_LENGTH) {
    app.journal.splice(0, app.journal.length - JOURNAL_LENGTH)
  }
}

/** The newest thing that happened — what the status bar dates itself by. */
export function last_change(): JournalEntry | null {
  return app.journal.length === 0 ? null : app.journal[app.journal.length - 1]
}

/**
 * The activity bar's one gesture (§8.2): a view that is not open opens, and
 * clicking the open one collapses the sidebar.
 */
export function select_view(view: SidebarView): void {
  if (app.sidebar_open && app.sidebar_view === view) {
    app.sidebar_open = false
    return
  }
  app.sidebar_view = view
  app.sidebar_open = true
}

/** Takes the page to what a journal entry is about, if it is still there. */
export function go_to(target: JournalTarget): void {
  switch (target.kind) {
    case 'entity':
      if (entity_of(target.entity_id) === undefined) {
        notify('That experiment is no longer in the Explorer.')
        return
      }
      navigate({ page: 'entity', entity_id: target.entity_id })
      return
    case 'job_run':
      if (job_run(app.world, target.job_id, target.run_id) === undefined) {
        notify('That run is no longer listed.')
        return
      }
      navigate({ page: 'job_run', job_id: target.job_id, run_id: target.run_id })
      return
    case 'bench_run':
      if (bench_run(app.world, target.bench_id, target.run_id) === undefined) {
        notify('That run is no longer listed.')
        return
      }
      navigate({ page: 'bench_run', bench_id: target.bench_id, run_id: target.run_id })
  }
}

// ---------------------------------------------------------------------------
// The history's row menu (§22.6): a run's parameters, used again.

/**
 * Starts a new run with exactly a past run's parameters. The backend validates
 * them against the manifest as it is now; a refusal — the manifest changed —
 * is put in a modal, because it has to be read, not one that fades.
 */
export async function start_again(entity_id: string, params: Params): Promise<void> {
  const entity = entity_of(entity_id)
  if (entity === undefined) {
    notify('That experiment is no longer in the Explorer.')
    return
  }
  let result: StartResult
  try {
    // The params come off a run in the world, a `$state` proxy: the bridge
    // clones what it is handed, and a proxy does not clone.
    result = await window.cocoa.start_run(entity.name, $state.snapshot(params))
  } catch (error) {
    result = { ok: false, message: (error as Error).message }
  }
  if (result.ok) {
    notify(`Run ${result.run_id} started.`)
    return
  }
  app.overlay = { kind: 'refused', title: 'Could not start', message: result.message }
}

/**
 * Opens the Start page with a past run's parameters filled in, as far as the
 * manifest as it is now allows: a parameter it no longer declares is dropped,
 * one it newly declares is left empty, one whose value no longer fits its
 * shape — an enum value since removed, one string where a list now is — is
 * left empty too, and the notice says which.
 */
export function prefill_start(entity_id: string, run_id: string, params: Params): void {
  const entity = entity_of(entity_id)
  if (entity === undefined) {
    notify('That experiment is no longer in the Explorer.')
    return
  }
  const values: Params = {}
  const missing: string[] = []
  const unfit: string[] = []
  for (const spec of entity.parameters) {
    if (!(spec.name in params)) {
      missing.push(spec.name)
    } else if (check_value(spec, params[spec.name]) !== null) {
      unfit.push(spec.name)
    } else {
      values[spec.name] = params[spec.name]
    }
  }
  const declared = entity.parameters.map((spec) => spec.name)
  const extra = Object.keys(params).filter((name) => !declared.includes(name))
  app.prefill = { entity_id, values }
  navigate({ page: 'start', entity_id })
  if (missing.length === 0 && extra.length === 0 && unfit.length === 0) {
    notify(`Parameters of run ${run_id} filled in.`)
    return
  }
  const problems: string[] = []
  if (missing.length > 0) {
    problems.push(`${quoted(missing)} ${missing.length === 1 ? 'is' : 'are'} new and left empty`)
  }
  if (unfit.length > 0) {
    problems.push(
      `${quoted(unfit)} no longer ${unfit.length === 1 ? 'fits' : 'fit'} and ${unfit.length === 1 ? 'is' : 'are'} left empty`
    )
  }
  if (extra.length > 0) {
    problems.push(`${quoted(extra)} ${extra.length === 1 ? 'is' : 'are'} no longer taken`)
  }
  notify(`Filled what run ${run_id} had; ${problems.join('; ')}.`, 'error')
}

/** The Start page takes the prefill meant for it, once. */
export function take_prefill(entity_id: string): Params | null {
  const prefill = app.prefill
  if (prefill === null || prefill.entity_id !== entity_id) {
    return null
  }
  app.prefill = null
  return prefill.values
}

function quoted(names: string[]): string {
  return names.map((name) => `\`${name}\``).join(', ')
}
