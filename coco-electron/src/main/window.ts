// The window: making it, sending to it, and reading its geometry.
//
// It takes what it needs as arguments rather than importing the arrangement —
// the arrangement has to read the geometry back out of here, and one of the
// two directions had to give way for the graph to stay acyclic.

import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { CocoEvent } from '@shared/world'
import type { WindowState } from './window_state'
import { WINDOW_MIN_SIZE } from './window_state'
import { some } from '@shared/maybe'
import { throw_coco } from '@shared/error'
import { env_var } from './env'
import { launch } from './launch'

export function create_window(old_win: WindowState, on_closing: () => void): void {
  const size = old_win.size

  // in case position empty, leave OS to pick a place
  const position = old_win.position.or({})
  const opened = new BrowserWindow({
    show: !launch.hide_window,
    width: size.width,
    height: size.height,
    ...position,
    minWidth: WINDOW_MIN_SIZE.width,
    minHeight: WINDOW_MIN_SIZE.height,
    title: 'coco (electron)',
    backgroundColor: '#1f1f1f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })
  // One window is the whole application: the shell only ever makes this one,
  // and the page may not conjure another (`window.open`, a target="_blank"
  // link). Report content is doubly barred — its iframe sandbox grants
  // scripts, not popups (`ReportViewer.svelte`).
  opened.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // `close` is the last moment the geometry can be read — the window leaves
  // the registry at `closed` — so the persist inside `on_closing` still finds
  // a window to ask, and writes what it finds into the state it keeps.
  opened.on('close', on_closing)

  const dev_server_url = env_var('ELECTRON_RENDERER_URL')
  if (dev_server_url.is_present()) {
    void opened.loadURL(dev_server_url.value)
  } else {
    void opened.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function send(events: CocoEvent[]): void {
  if (events.length === 0) {
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('coco:events', events)
  }
}

function bounds_of(win: BrowserWindow): WindowState {
  // `getNormalBounds`, not `getBounds`: the latter reports the screen for a
  // maximised or full-screen window, which would then open that way for ever
  // after. This one answers with the restored rectangle in every state.
  const bounds = win.getNormalBounds()
  return {
    size: { width: bounds.width, height: bounds.height },
    position: some({ x: bounds.x, y: bounds.y })
  }
}

/**
 * Where the window would be if it were neither maximised, full-screen nor
 * minimised — which is the only geometry worth reopening at. A minimised
 * window still answers: it is neither gone nor destroyed, and
 * `getNormalBounds` reports its restored rectangle, so quitting a minimised
 * coco keeps the place it would have come back to.
 *
 * Callers ask while there is a window to ask — at the open, and at its
 * close. No window is not an answer here but a mistake, and throws.
 */
export function window_bounds(): WindowState {
  const open = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
  if (open === undefined) {
    throw_coco('window bounds read with no window to ask')
  }
  return bounds_of(open)
}

/**
 * Brings the window to the front, restoring it if it is minimised.
 *
 * For now it is only called when a second coco launches: the second one
 * quits, and the first shows itself in front.
 */
export function focus_window(): void {
  const open = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
  if (open === undefined) {
    // This happens when the first coco is quitting as the second one is
    // clicked, so there is no window. Nothing needs bringing to the front —
    // letting the first one finish quitting is enough.
    return
  }
  if (open.isMinimized()) {
    open.restore()
  }
  open.focus()
}
