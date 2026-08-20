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
import type { Maybe } from '@shared/maybe'
import { empty, some } from '@shared/maybe'

let window: Maybe<BrowserWindow> = empty()

/** The geometry taken at the last close, for the persist that follows it. */
let last_bounds: Maybe<WindowState> = empty()

/**
 * `COCO_HIDE_WINDOW` opens the window without showing it.
 *
 * For a drive run that is only there to be *checked*, not watched: Playwright
 * drives the page over CDP and screenshots it the same way, neither of which
 * needs the window on screen — but eleven scenarios in a row each stealing
 * focus makes the machine unusable while they run. Never set in normal use;
 * `npm run drive` still opens a window you can watch, which is its whole point.
 */
const HIDDEN = process.env.COCO_HIDE_WINDOW === '1'

export function create_window(old_win: WindowState, on_closing: () => void): void {
  const size = old_win.size
  // A remembered position is a pair or nothing (`window_state.ts`); nothing
  // means no x/y keys at all, which leaves the platform to place the window.
  const position = old_win.position.or({})
  const opened = new BrowserWindow({
    show: !HIDDEN,
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
  window = some(opened)

  // The last look at the geometry, taken while there is still a window to
  // ask; will-quit, after the window is gone, keeps what this look took.
  opened.on('close', () => {
    last_bounds = some(bounds_of(opened))
    on_closing()
  })

  opened.on('closed', () => {
    window = empty()
  })

  const dev_server_url = process.env['ELECTRON_RENDERER_URL']
  if (dev_server_url !== undefined && dev_server_url !== '') {
    void opened.loadURL(dev_server_url)
  } else {
    void opened.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function send(events: CocoEvent[]): void {
  if (events.length > 0 && window.is_present()) {
    window.value.webContents.send('coco:events', events)
  }
}

/**
 * Sends a menu item's command to the window (`menu.ts`).
 *
 * The window this module owns — not the focused one, which a hidden window
 * is not.
 */
export function send_command(command: string): void {
  if (window.is_present()) {
    window.value.webContents.send('coco:command', command)
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
 * minimised — which is the only geometry worth reopening at: the window's,
 * read now, or the look `close` took once there is no window left to ask.
 */
export function window_bounds(): Maybe<WindowState> {
  if (window.is_present() && !window.value.isDestroyed()) {
    return some(bounds_of(window.value))
  }
  return last_bounds
}

/** For the macOS `activate` convention: reopen only when none is left. */
export function any_window_open(): boolean {
  return BrowserWindow.getAllWindows().length > 0
}
