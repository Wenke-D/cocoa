// The renderer's whole mutable state, as one rune. `Route` is the same
// discriminated union coco's `src/navigation/route.rs` models: an address,
// never content. `recover` mirrors `Route::recover` — a restored or stale
// address pointing at something the world no longer contains is repaired,
// with a message.

import { defaultUiState } from '@shared/ui'
import type { Route, ReportContext, UiState } from '@shared/ui'
import { benchRun, emptyWorld, isActive, jobRun } from '@shared/world'
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
  { kind: 'confirmCancel'; target: CancelTarget } | { kind: 'confirmRemove'; entityId: string }
)

/** An open context menu: which row, and where the pointer was. */
export interface ContextMenu {
  entityId: string
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
  // Arrangement, not content: persisted across launches (see `persistUi`).
  sidebarWidth: number
  reportWrap: boolean
  /** The one clock every duration on screen is computed from. */
  nowMs: number
}

export const app: AppState = $state({
  connected: false,
  world: emptyWorld(),
  route: { page: 'empty' },
  overlay: null,
  menu: null,
  notice: null,
  sidebarWidth: defaultUiState().sidebarWidth,
  reportWrap: defaultUiState().reportWrapLines,
  nowMs: Date.now()
})

export function navigate(route: Route): void {
  app.route = route
}

/**
 * Opens the folder picker and registers what comes back (§11.5). Cancelling
 * does nothing at all; a registration selects the folder it added, so the
 * user lands on the result of their action rather than wherever they were.
 */
export async function addFolder(): Promise<void> {
  let result: AddFolderResult
  try {
    result = await window.coco.addFolder()
  } catch (error) {
    notify((error as Error).message, 'error')
    return
  }
  if (!result.ok) {
    if (result.cancelled) return
    notify(result.message, 'error')
    return
  }
  app.route = { page: 'entity', entityId: result.entityId }
  notify(result.already ? 'That folder is already in the Explorer.' : 'Folder added.')
}

export function requestCancel(target: CancelTarget): void {
  app.overlay = { kind: 'confirmCancel', target, error: null, busy: false }
}

export function openMenu(entityId: string, x: number, y: number): void {
  app.menu = { entityId, x, y }
}

export function closeMenu(): void {
  app.menu = null
}

export function requestRemove(entityId: string): void {
  app.menu = null
  app.overlay = { kind: 'confirmRemove', entityId, error: null, busy: false }
}

export function closeOverlay(): void {
  app.overlay = null
}

/**
 * Takes the folder out of the Explorer (§36 — removed from the Explorer, not
 * deleted from disk). As with cancel, the overlay stays open until the
 * backend answers: closed by success, annotated by failure.
 */
export async function confirmRemove(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirmRemove' || overlay.busy) return
  overlay.busy = true
  overlay.error = null

  // Leave the entity's page *before* asking, so `recover()` has nothing to
  // repair: its message ("that run is no longer listed") explains an
  // accident, and this is not one — the user asked for it. The route is put
  // back if the removal is refused.
  const previous = app.route
  if (selectedEntityId() === overlay.entityId) app.route = { page: 'empty' }

  let result: RemoveFolderResult
  try {
    result = await window.coco.removeFolder(overlay.entityId)
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
export async function confirmCancel(): Promise<void> {
  const overlay = app.overlay
  if (overlay === null || overlay.kind !== 'confirmCancel' || overlay.busy) return
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
let noticeSeq = 0

/**
 * Says one sentence. The last one wins, including over a standing error: what
 * just happened explains the screen the user is looking at now.
 */
export function notify(text: string, level: NoticeLevel = 'info'): void {
  noticeSeq += 1
  const mine = noticeSeq
  app.notice = { text, level }
  // A failure stays until it is dismissed or replaced. It is the only place a
  // refresh that cannot run reports itself, and a message that fades before
  // it is read is the same as no message at all.
  if (level === 'error') return
  setTimeout(() => {
    if (noticeSeq === mine) app.notice = null
  }, NOTICE_MS)
}

export function dismissNotice(): void {
  app.notice = null
}

/**
 * The status bar's refresh (§8.5). It always answers — the backend sends the
 * notice, success included — so nothing is said here; only the transport
 * failing is this side's to report.
 */
export async function refreshNow(): Promise<void> {
  try {
    await window.coco.refreshNow()
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
  app.sidebarWidth = payload.ui.sidebarWidth
  app.reportWrap = payload.ui.reportWrapLines
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
let persistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Remembers the arrangement. Called from an effect, so it runs on every route
 * change including the ones `recover()` makes — being put back on the Explorer
 * because an experiment is gone is exactly the state worth remembering.
 */
export function persistUi(): void {
  if (!restored) return
  if (persistTimer !== null) clearTimeout(persistTimer)
  // The state is read when the timer fires, not when it is set: a drag's
  // hundred widths must collapse to the width it ended on.
  persistTimer = setTimeout(() => {
    persistTimer = null
    const state: UiState = {
      route: $state.snapshot(app.route),
      sidebarWidth: app.sidebarWidth,
      reportWrapLines: app.reportWrap,
      // The window is the main process's to know; it fills this in.
      window: null
    }
    void window.coco.saveUi(state)
  }, 300)
}

/**
 * Applies one batch of backend events. The renderer never judges change —
 * the backend already did; this only makes the model say what it was told.
 */
export function applyEvents(events: CocoEvent[]): void {
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
        upsertRun(world.job_runs, world.runs_by_job, event.run, event.run.job_id)
        break
      case 'job-run-removed':
        removeRun(world.job_runs, world.runs_by_job, event.jobId, event.id)
        break
      case 'bench-run-upserted':
        upsertRun(world.bench_runs, world.runs_by_bench, event.run, event.run.bench_id)
        break
      case 'bench-run-removed':
        removeRun(world.bench_runs, world.runs_by_bench, event.benchId, event.id)
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
function upsertRun<Run extends { id: string; started_at: string }>(
  runs: RunsByEntity<Run>,
  index: Record<string, string[]>,
  run: Run,
  ownerId: string
): void {
  // Read both back after creating them. `x[o] ?? (x[o] = {})` hands back the
  // raw value the assignment evaluated to, not the `$state` proxy that now
  // stands in its place — every later write would then go through the back of
  // the store and change nothing on screen. That is why an entity's *first*
  // run never lit its Explorer dot, and it applies to the run map for exactly
  // the same reason it applies to the index.
  if (runs[ownerId] === undefined) runs[ownerId] = {}
  const mine = runs[ownerId]
  mine[run.id] = run

  if (index[ownerId] === undefined) index[ownerId] = []
  const list = index[ownerId]
  const existing = list.indexOf(run.id)
  if (existing >= 0) list.splice(existing, 1)
  const startMs = Date.parse(run.started_at)
  let position = list.length
  for (let i = 0; i < list.length; i += 1) {
    const other = mine[list[i]]
    if (other !== undefined && Date.parse(other.started_at) > startMs) {
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
function removeRun(
  runs: RunsByEntity<JobRun> | RunsByEntity<BenchRun>,
  index: Record<string, string[]>,
  ownerId: string,
  id: string
): void {
  const mine = runs[ownerId]
  if (mine !== undefined) delete mine[id]
  const list = index[ownerId]
  if (list === undefined) return
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
}

export function entityOf(id: string): Entity | undefined {
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
export function selectedEntityId(): string | null {
  const route = app.route
  switch (route.page) {
    case 'empty':
      return null
    case 'entity':
    case 'start':
      return route.entityId
    case 'jobRun':
      return route.jobId
    case 'benchRun':
    case 'benchChild':
      return route.benchId
    case 'report':
      return contextEntityId(route.context)
  }
}

export function contextEntityId(context: ReportContext): string {
  return context.kind === 'jobRun' ? context.jobId : context.benchId
}

/**
 * Whose folder the report file is actually in — which is not the same
 * question as whose context it is being read under. A run dispatched by a
 * bench writes its report into the *job's* folder, because that is where the
 * run happened; the bench is only how the reader arrived (§2.3.1, §20.1).
 */
export function reportOwnerId(context: ReportContext, runId: string): string {
  if (context.kind === 'benchChild') {
    return dispatchedOwner(context.benchId, context.benchRunId, runId) ?? context.benchId
  }
  return contextEntityId(context)
}

/**
 * Which job a dispatched run belongs to, read from the bench run's own plan.
 *
 * The plan is the authoritative link between the two (§2.3.1), and now the
 * only one: a run id means nothing without the experiment it was allocated
 * in, so there is no map to look a bare child id up in.
 */
export function dispatchedOwner(
  benchId: string,
  benchRunId: string,
  runId: string
): string | undefined {
  const bench = benchRun(app.world, benchId, benchRunId)
  return bench?.plan.steps.find((step) => step.run_id === runId)?.job_id
}

/** Repairs a route — and closes an overlay — the world can no longer answer for. */
export function recover(): void {
  const route = app.route
  const world = app.world

  const entityGone = (id: string): boolean => entityOf(id) === undefined

  // A confirmation about a run that is no longer listed has nothing left to
  // confirm; it closes rather than asking about a ghost.
  // An overlay with an operation in flight is left alone: it is about to
  // answer for itself, and closing it here would throw that answer away —
  // including the confirmation for a removal that has just succeeded.
  const overlay = app.overlay
  if (overlay !== null && !overlay.busy) {
    const gone =
      overlay.kind === 'confirmCancel'
        ? overlay.target.kind === 'jobRun'
          ? jobRun(world, overlay.target.jobId, overlay.target.runId) === undefined
          : benchRun(world, overlay.target.benchId, overlay.target.runId) === undefined
        : entityGone(overlay.entityId)
    if (gone) app.overlay = null
  }
  // A menu about a row that is no longer there closes with it.
  if (app.menu !== null && entityGone(app.menu.entityId)) app.menu = null

  switch (route.page) {
    case 'empty':
      return
    case 'entity':
    case 'start':
      if (entityGone(route.entityId)) {
        app.route = { page: 'empty' }
        notify('That experiment is no longer in the Explorer.')
      }
      return
    case 'jobRun':
      if (jobRun(world, route.jobId, route.runId) === undefined) {
        app.route = entityGone(route.jobId)
          ? { page: 'empty' }
          : { page: 'entity', entityId: route.jobId }
        notify('That run is no longer listed.')
      }
      return
    case 'benchRun':
      if (benchRun(world, route.benchId, route.runId) === undefined) {
        app.route = entityGone(route.benchId)
          ? { page: 'empty' }
          : { page: 'entity', entityId: route.benchId }
        notify('That run is no longer listed.')
      }
      return
    // Two runs have to still exist for this address to mean anything: the
    // dispatched run it shows, and the bench run whose context it is seen in.
    // Losing the child falls back to the bench run, which is where the user
    // came from; losing the bench run itself falls back further.
    case 'benchChild': {
      if (benchRun(world, route.benchId, route.benchRunId) === undefined) {
        app.route = entityGone(route.benchId)
          ? { page: 'empty' }
          : { page: 'entity', entityId: route.benchId }
        notify('That run is no longer listed.')
        return
      }
      // Which job the child belongs to comes from the bench's plan; if the
      // plan no longer lists it, it is gone by the same test.
      const jobId = dispatchedOwner(route.benchId, route.benchRunId, route.runId)
      if (jobId === undefined || jobRun(world, jobId, route.runId) === undefined) {
        app.route = { page: 'benchRun', benchId: route.benchId, runId: route.benchRunId }
        notify('That dispatched run is no longer listed.')
      }
      return
    }
    case 'report': {
      // A report is read from disk on open, so the world cannot say whether
      // the file is still there; what it can say is whether the run and its
      // entity are still listed.
      const entityId = contextEntityId(route.context)
      // A report opened from a dispatched run is a *job* run's report, even
      // though the context is the bench's — the same two-addresses rule. The
      // owner is what says which map to look in, and for a dispatched run
      // that owner comes from the plan.
      const ownerId = reportOwnerId(route.context, route.runId)
      const run =
        route.context.kind === 'benchRun'
          ? benchRun(world, ownerId, route.runId)
          : jobRun(world, ownerId, route.runId)
      if (run === undefined) {
        app.route = entityGone(entityId) ? { page: 'empty' } : { page: 'entity', entityId }
        notify('That run is no longer listed.')
      }
      return
    }
  }
}

/** Whether an entity has any active run — the sidebar's activity dot. */
export function hasActiveRun(entity: Entity): boolean {
  const world = app.world
  if (entity.kind === 'Job') {
    const ids = world.runs_by_job[entity.id] ?? []
    return ids.some((id) => {
      const run = jobRun(world, entity.id, id)
      return run !== undefined && isActive(run.status)
    })
  }
  const ids = world.runs_by_bench[entity.id] ?? []
  return ids.some((id) => {
    const run = benchRun(world, entity.id, id)
    return run !== undefined && isActive(run.status)
  })
}

/** Top-bar count, mirroring `World::active_run_count`: direct job runs plus
 * bench runs, never counting dispatched children twice. */
export function activeRunCount(): number {
  const world = app.world
  const direct = Object.values(world.job_runs)
    .flatMap((runs) => Object.values(runs))
    .filter(
      (run) => isActive(run.status) && (run.origin === 'Human' || run.origin === 'Agent')
    ).length
  const benches = Object.values(world.bench_runs)
    .flatMap((runs) => Object.values(runs))
    .filter((run) => isActive(run.status)).length
  return direct + benches
}
