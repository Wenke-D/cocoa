// Where the user was, and how they had things arranged: the live copy of the
// ui state. Read once at launch and then held here — the renderer sends its
// half back on every change, and the window's own geometry is this side's to
// know.
//
// The file is `ui_state_file.ts`'s business, and the two layers are told apart
// by their verbs: that one *reads* and *writes* a path, this one *loads* what
// the process will use and decides when to *persist* it.

import type { UiState } from '@shared/ui'
import { default_ui_state } from '@shared/ui'
import type { Maybe } from './types'
import { read_ui_state, ui_state_path, write_ui_state } from './ui_state_file'
import { window_bounds } from './window'

/**
 * The path is only known after `app.whenReady()`, so this starts as the
 * defaults and is replaced by `load_ui_state` — a bootstrap cannot arrive
 * before then.
 */
let state_path: Maybe<string> = null
let state: UiState = default_ui_state()

/** Coalesces a window drag's stream of resize events into one write. */
let save_timer: Maybe<NodeJS.Timeout> = null

/** Reads the file into memory. Only callable once `userData` has an answer. */
export function load_ui_state(user_data_dir: string): void {
  state_path = ui_state_path(user_data_dir)
  state = read_ui_state(state_path)
}

/** What to restore the window to, and what to hand the page at bootstrap. */
export function ui_state(): UiState {
  return state
}

/** Writes now rather than in 300 ms — for the one event that has no later. */
export function persist_ui_state_now(): void {
  if (save_timer !== null) {
    clearTimeout(save_timer)
    save_timer = null
  }
  if (state_path === null) return
  state.window = window_bounds() ?? state.window
  write_ui_state(state_path, state)
}

/**
 * Every write reads the window's geometry first, whatever prompted it. A user
 * who never moves the window still has one — and a file that only learns the
 * geometry from a resize would have nothing to restore for exactly the people
 * who leave it where it opens.
 */
export function persist_ui_state(): void {
  if (state_path === null) return
  if (save_timer !== null) clearTimeout(save_timer)
  save_timer = setTimeout(() => {
    save_timer = null
    persist_ui_state_now()
  }, 300)
}

/**
 * The renderer owns the route, the sidebar width and the report's wrap; the
 * window's geometry is this side's. Both halves live in one file, so the
 * renderer's half is merged in rather than allowed to overwrite.
 */
export function merge_from_renderer(from_renderer: UiState): void {
  state = { ...from_renderer, window: state.window }
  // Written straight through: the renderer has already coalesced a drag's
  // hundred widths into this one message, and debouncing it again here would
  // only double how long the file lags behind the window.
  persist_ui_state_now()
}
