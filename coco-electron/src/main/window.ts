// The window: making it, sending to it, and reading its geometry.
//
// It takes what it needs as arguments rather than importing the arrangement —
// the arrangement has to read the geometry back out of here, and one of the
// two directions had to give way for the graph to stay acyclic.

import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { CocoEvent } from '@shared/world'
import type { WindowBounds } from '@shared/ui'
import { WINDOW_DEFAULT, WINDOW_MIN } from '@shared/ui'
import type { Maybe } from './types'

let window: Maybe<BrowserWindow> = null

/** What the window wants told when its geometry moves, and when it closes. */
export interface WindowHooks {
  onGeometryChanged: () => void
  onClosing: () => void
}

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

export function createWindow(remembered: Maybe<WindowBounds>, hooks: WindowHooks): void {
  window = new BrowserWindow({
    show: !HIDDEN,
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
  window.on('resize', hooks.onGeometryChanged)
  window.on('move', hooks.onGeometryChanged)
  window.on('close', hooks.onClosing)

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

export function send(events: CocoEvent[]): void {
  if (events.length > 0) window?.webContents.send('coco:events', events)
}

/**
 * What a menu item asks the window to do (`menu.ts`).
 *
 * The window, not the focused one. There is exactly one, and it is this
 * module's — asking `getFocusedWindow()` was asking a question with a
 * different answer: a window that is not on screen is not focused, and the
 * command went nowhere at all.
 */
export function sendCommand(command: string): void {
  window?.webContents.send('coco:command', command)
}

/**
 * Where the window is, or `null` when there is nothing worth remembering.
 *
 * A maximised or full-screen window would otherwise be recorded as the size of
 * the screen, and open that way for ever after.
 */
export function windowBounds(): Maybe<WindowBounds> {
  if (window === null || window.isDestroyed() || window.isMinimized()) return null
  if (window.isMaximized() || window.isFullScreen()) return null
  const bounds = window.getBounds()
  return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }
}

/** For the macOS `activate` convention: reopen only when none is left. */
export function anyWindowOpen(): boolean {
  return BrowserWindow.getAllWindows().length > 0
}
