// The main process is the server side of the classic Electron shape: it owns
// the engine (the TypeScript port of coco's Rust engine), runs the refresh
// loop, and is the only party that judges change. The renderer bootstraps
// once, then receives typed events — never the world, never a diff to judge.

import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import type {
  AddFolderResult,
  BootstrapPayload,
  CancelResult,
  CancelTarget,
  CocoEvent,
  RemoveFolderResult,
  ReportResult,
  ReportTarget,
  StartResult,
  World
} from '@shared/world'
import type { UiState } from '@shared/ui'
import { WINDOW_DEFAULT, WINDOW_MIN, defaultUiState } from '@shared/ui'
import type { AgentServer } from './agent'
import { serve, socketPath } from './agent'
import { Coco } from './engine/coco'
import { nowStamp } from './engine/record'
import { buildWorld, defaultStorePath } from './engine/world'
import { buildMenu } from './menu'
import { NoticeGate, refreshSummary } from './notices'
import { defaultUiStatePath, loadUiState, saveUiState } from './uiState'
import * as operations from './operations'
import { serialize } from './serial'
import { diffWorlds } from './sync'

/** How often the engine refreshes: polls, auto-reports, harvests (§7.5). */
const REFRESH_INTERVAL_MS = 3_000

const engine = new Coco(defaultStorePath())
let window: BrowserWindow | null = null
let lastRefresh: string | null = null

/**
 * Where the user was, and how they had things arranged. Read once at launch
 * and then held here: the renderer sends its half back on every change, and
 * the window's own geometry is this side's to know.
 *
 * The path is only known after `app.whenReady()`, so this starts as the
 * defaults and is replaced there — a bootstrap cannot arrive before then.
 */
let uiStatePath: string | null = null
let ui: UiState = defaultUiState()

/** Coalesces a window drag's stream of resize events into one write. */
let uiSaveTimer: NodeJS.Timeout | null = null

/**
 * Every write reads the window's geometry first, whatever prompted it. A user
 * who never moves the window still has one — and a file that only learns the
 * geometry from a resize would have nothing to restore for exactly the people
 * who leave it where it opens.
 */
function persistUiState(): void {
  if (uiStatePath === null) return
  if (uiSaveTimer !== null) clearTimeout(uiSaveTimer)
  uiSaveTimer = setTimeout(() => {
    uiSaveTimer = null
    persistUiStateNow()
  }, 300)
}

/** Writes now rather than in 300 ms — for the one event that has no later. */
function persistUiStateNow(): void {
  if (uiSaveTimer !== null) {
    clearTimeout(uiSaveTimer)
    uiSaveTimer = null
  }
  if (uiStatePath === null) return
  rememberWindow()
  saveUiState(uiStatePath, ui)
}

function rememberWindow(): void {
  if (window === null || window.isDestroyed() || window.isMinimized()) return
  // A maximised or full-screen window would otherwise be remembered as the
  // size of the screen, and open that way for ever after.
  if (window.isMaximized() || window.isFullScreen()) return
  const bounds = window.getBounds()
  ui.window = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }
}

/**
 * The backend's own model of the world. Rebuilt from disk every cycle —
 * the filesystem is a shared truth (humans edit manifests, scripts write
 * reports), so knowing "what changed" means comparing against what it said
 * last time. That comparison happens in `diffWorlds`, entry by entry; the
 * renderer only ever hears its conclusions, as events.
 */
let model: World | null = null

/**
 * One publish cycle: rebuild the model from disk, turn the difference into
 * events, send them as one batch. The `refreshed` heartbeat rides along when
 * a refresh pass completed, so an idle engine sends heartbeats and nothing
 * else.
 */
function publishCycle(refreshedAt: string | null, extra: CocoEvent[] = []): void {
  let next: World
  try {
    next = buildWorld(engine, refreshedAt ?? lastRefresh)
  } catch (error) {
    console.error('world build failed:', error)
    // Nothing can be said about the world, but something must still be said
    // about the failure: a build that throws leaves the page showing a world
    // that has quietly stopped being updated.
    send([...extra, ...announce(notices.automatic(messageOf(error)))])
    return
  }
  const events: CocoEvent[] = model === null ? [] : diffWorlds(model, next)
  model = next
  if (refreshedAt !== null) {
    events.push({ kind: 'refreshed', at: refreshedAt })
  }
  // The notice rides in the same batch as the changes it is about: one batch
  // per logical operation, so the page never shows the message before the
  // state it explains.
  events.push(...extra)
  send(events)
}

function send(events: CocoEvent[]): void {
  if (events.length > 0) window?.webContents.send('coco:events', events)
}

/**
 * Whether the page has asked for its starting state yet. Events sent before
 * that are harmless — the bootstrap supersedes them — but a *notice* is not
 * in the bootstrap, so one said during startup would simply be lost. The
 * agent interface failing to bind is exactly that case.
 */
let bootstrapped = false
const pendingNotices: CocoEvent[] = []

function announce(notice: CocoEvent | null): CocoEvent[] {
  return notice === null ? [] : [notice]
}

/** Says something that must survive the window not being ready to hear it. */
function announceWhenHeard(events: CocoEvent[]): void {
  if (events.length === 0) return
  if (!bootstrapped) {
    pendingNotices.push(...events)
    return
  }
  send(events)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every engine operation takes its turn; see `serial.ts` for why. */
const onEngine = serialize()

/** What the user hears about a refresh, and how often; see `notices.ts`. */
const notices = new NoticeGate()

// A tick that arrives while one is still going is dropped, not queued: two
// refreshes in a row would only run the same poll scripts twice. (A user's
// operation is never dropped — it queues.)
let refreshing = false

/**
 * One refresh. `manual` is the difference between the clock asking and a
 * person asking: a person's refresh is never dropped, and always answers.
 */
async function refreshAndPublish(manual = false): Promise<void> {
  if (refreshing && !manual) return
  refreshing = true
  try {
    await onEngine(async () => {
      const report = await engine.refresh()
      lastRefresh = nowStamp()
      const summary = refreshSummary(report)
      for (const error of [...report.launchErrors, ...report.pollErrors, ...report.reportErrors]) {
        console.error('refresh:', error.message)
      }
      const notice = manual ? notices.manual(summary) : notices.automatic(summary)
      publishCycle(lastRefresh, announce(notice))
    })
  } catch (error) {
    // The refresh itself came apart — no report, and so nothing to publish.
    // The gate still decides whether this is news.
    console.error('refresh failed:', error)
    const message = messageOf(error)
    send(announce(manual ? notices.manual(message) : notices.automatic(message)))
  } finally {
    refreshing = false
  }
}

function createWindow(): void {
  const remembered = ui.window
  window = new BrowserWindow({
    width: remembered?.width ?? WINDOW_DEFAULT.width,
    height: remembered?.height ?? WINDOW_DEFAULT.height,
    // A remembered position is restored only as a pair; half of one would put
    // the window somewhere nobody left it.
    ...(remembered?.x !== null && remembered?.x !== undefined && remembered.y !== null
      ? { x: remembered.x, y: remembered.y }
      : {}),
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    title: 'coco (electron)',
    backgroundColor: '#1f1f1f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  // Geometry is remembered as it changes rather than only on close: on macOS
  // quitting with the window open never fires a close at all.
  window.on('resize', persistUiState)
  window.on('move', persistUiState)
  window.on('close', persistUiStateNow)

  window.on('closed', () => {
    window = null
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl !== undefined && devServerUrl !== '') {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// The renderer pulls its starting state; a reload is its own resync. Events
// sent before the bootstrap answer are applied to the old page state and then
// overwritten by the (newer) bootstrap — order-safe either way.
ipcMain.handle('coco:bootstrap', (): BootstrapPayload => {
  if (model === null) {
    model = buildWorld(engine, lastRefresh)
  }
  bootstrapped = true
  // After the answer, so the page has its world before it is told anything
  // about it.
  if (pendingNotices.length > 0) {
    const waiting = pendingNotices.splice(0)
    setImmediate(() => send(waiting))
  }
  return { world: model, ui }
})

// The renderer owns the route, the sidebar width and the report's wrap; the
// window's geometry is this side's. Both halves live in one file, so the
// renderer's half is merged in rather than allowed to overwrite.
ipcMain.handle('coco:saveUi', (_event, state: UiState): void => {
  ui = { ...state, window: ui.window }
  // Written straight through: the renderer has already coalesced a drag's
  // hundred widths into this one message, and debouncing it again here would
  // only double how long the file lags behind the window.
  persistUiStateNow()
})

// Events go out before the answer (publish-before-emit): by the time the
// renderer learns the run id, it has already applied the run.
ipcMain.handle(
  'coco:start',
  async (_event, name: string, parameters: Record<string, string>): Promise<StartResult> =>
    onEngine(async () => {
      const result = await operations.startRun(engine, name, parameters)
      publishCycle(null)
      return result
    })
)

// A cancel that was accepted has already moved the run to `CANCELLING`, and
// the modal closes on the answer — so the events must precede it here too, or
// the page behind the modal would still read `RUNNING`.
ipcMain.handle(
  'coco:cancel',
  async (_event, target: CancelTarget): Promise<CancelResult> =>
    onEngine(async () => {
      const result = await operations.cancel(engine, target)
      publishCycle(null)
      return result
    })
)

// Nothing stands between the click and the picker, and a path is never typed
// by hand (§11.5). The picker itself is deliberately *outside* the engine
// queue — a dialog can stay open for minutes, and the refresh tick must not
// wait on the user's file browsing. Only the registration takes a turn.
ipcMain.handle('coco:addFolder', async (): Promise<AddFolderResult> => {
  const picked = await dialog.showOpenDialog({
    title: 'Add experiment folder',
    properties: ['openDirectory']
  })
  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: false, cancelled: true, message: '' }
  }
  return onEngine(async () => {
    const result = operations.addFolder(engine, picked.filePaths[0])
    publishCycle(null)
    return result
  })
})

ipcMain.handle(
  'coco:removeFolder',
  async (_event, entityId: string): Promise<RemoveFolderResult> =>
    onEngine(async () => {
      const result = operations.removeFolder(engine, entityId)
      publishCycle(null)
      return result
    })
)

// Reading a report neither changes engine state nor runs a script, so it
// does not take a turn: it must not queue behind a slow poll.
ipcMain.handle('coco:report', (_event, target: ReportTarget): ReportResult =>
  operations.readReport(engine, target)
)

// The status bar's refresh: it takes its turn like everything else, but it is
// never the tick that gets dropped, and it says how it went.
ipcMain.handle('coco:refresh', async (): Promise<void> => {
  await refreshAndPublish(true)
})

/**
 * The agent interface (§43), if it can have the socket. A second window must
 * not steal the first one's — it would be a second owner of the same store —
 * so a refusal here leaves this window running without an interface, and says
 * so once.
 */
let agent: AgentServer | null = null

async function startAgentInterface(): Promise<void> {
  const file = socketPath()
  try {
    agent = await serve(file, {
      // Reads are answered from the model the window renders from, so they
      // never wait on the engine — at most one pass old, which is what a read
      // over a socket is anyway.
      world: () => model ?? (model = buildWorld(engine, lastRefresh)),
      // Writes take exactly the path a click takes: the same operation, the
      // same queue, the same publish. Only the trigger differs.
      start: (name, parameters) =>
        onEngine(async () => {
          const result = await operations.startRun(engine, name, parameters, 'agent')
          publishCycle(null)
          return result
        })
    })
    console.log('agent interface listening on', file)
  } catch (error) {
    console.error('agent interface:', messageOf(error))
    announceWhenHeard(announce(notices.automatic(`Agent interface is off: ${messageOf(error)}`)))
  }
}

app.whenReady().then(() => {
  // Read once, here: `userData` has no answer before the app is ready.
  uiStatePath = defaultUiStatePath(app.getPath('userData'))
  ui = loadUiState(uiStatePath)
  buildMenu()
  createWindow()
  void refreshAndPublish()
  setInterval(() => void refreshAndPublish(), REFRESH_INTERVAL_MS)
  void startAgentInterface()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// A launch script gets its grace period before the process exits (§10).
let shuttingDown = false
app.on('will-quit', (event) => {
  persistUiStateNow()
  // The socket file is this process's to remove; leaving it behind makes the
  // next launch decide whether a live coco owns it.
  void agent?.close()
  agent = null
  if (shuttingDown) return
  if (engine.launchesInFlight() === 0) return
  event.preventDefault()
  shuttingDown = true
  void engine.shutdownLaunches(5_000).then(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
