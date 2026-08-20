// Where the user was, and how they had things arranged. Read once at launch
// and then held here: the renderer sends its half back on every change, and
// the window's own geometry is this side's to know.
//
// The file itself is `uiState.ts`'s business; this owns the copy in memory and
// decides when it is written.

import type { UiState } from '@shared/ui'
import { defaultUiState } from '@shared/ui'
import type { Maybe } from './types'
import { defaultUiStatePath, loadUiState, saveUiState } from './uiState'
import { windowBounds } from './window'

/**
 * The path is only known after `app.whenReady()`, so this starts as the
 * defaults and is replaced by `loadArrangement` — a bootstrap cannot arrive
 * before then.
 */
let uiStatePath: Maybe<string> = null
let ui: UiState = defaultUiState()

/** Coalesces a window drag's stream of resize events into one write. */
let uiSaveTimer: Maybe<NodeJS.Timeout> = null

/** Reads the file. Only callable once `userData` has an answer. */
export function loadArrangement(userDataDir: string): void {
  uiStatePath = defaultUiStatePath(userDataDir)
  ui = loadUiState(uiStatePath)
}

/** What to restore the window to, and what to hand the page at bootstrap. */
export function arrangement(): UiState {
  return ui
}

/** Writes now rather than in 300 ms — for the one event that has no later. */
export function persistUiStateNow(): void {
  if (uiSaveTimer !== null) {
    clearTimeout(uiSaveTimer)
    uiSaveTimer = null
  }
  if (uiStatePath === null) return
  ui.window = windowBounds() ?? ui.window
  saveUiState(uiStatePath, ui)
}

/**
 * Every write reads the window's geometry first, whatever prompted it. A user
 * who never moves the window still has one — and a file that only learns the
 * geometry from a resize would have nothing to restore for exactly the people
 * who leave it where it opens.
 */
export function persistUiState(): void {
  if (uiStatePath === null) return
  if (uiSaveTimer !== null) clearTimeout(uiSaveTimer)
  uiSaveTimer = setTimeout(() => {
    uiSaveTimer = null
    persistUiStateNow()
  }, 300)
}

/**
 * The renderer owns the route, the sidebar width and the report's wrap; the
 * window's geometry is this side's. Both halves live in one file, so the
 * renderer's half is merged in rather than allowed to overwrite.
 */
export function mergeFromRenderer(state: UiState): void {
  ui = { ...state, window: ui.window }
  // Written straight through: the renderer has already coalesced a drag's
  // hundred widths into this one message, and debouncing it again here would
  // only double how long the file lags behind the window.
  persistUiStateNow()
}
