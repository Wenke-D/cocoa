// The window's own record: how big it was and where it sat, restored at
// launch and persisted at the endings. This is all the arrangement the main
// process still owns — the renderer keeps its half (route, sidebar, wrap) to
// itself, in localStorage (`renderer/src/ui_state.ts`), and the two never
// meet in one object.
//
// Nothing is written as it goes. The read at launch writes nothing back —
// restoring answers from the file or the defaults and leaves the disk alone.
// The file is written once the window is open, recording the geometry the
// window actually got rather than what was asked for, and again at the one
// ending: the window's close. A quit closes the window first (will-quit only
// fires after every window has closed), so the close's write is always the
// last word. `sanitize_window_state` repairs a record on the way in, never
// on the way out. What a crash costs is the session's geometry, which for a
// window rectangle is a trade worth making.
//
// Geometry is not tracked as it changes, either: the close-time persist
// takes one look while there is still a window to ask. A resize therefore
// has no listener at all.
//
// The file is `window_state_file.ts`'s business, and the two layers are told
// apart by their verbs: that one *reads* and *writes* the file, this one
// *restores* a state, *parses* what the file said, and *persists* it at the
// end.

import type { Maybe } from '@shared/maybe'
import { None, Some, empty, some } from '@shared/maybe'
import { throw_coco } from '@shared/error'
import { read_window_state_file, window_state_path, write_window_state } from './window_state_file'

/** How big the window was. */
export interface WindowSize {
  width: number
  height: number
}

/** Where the window sat. */
export interface WindowPosition {
  x: number
  y: number
}

/**
 * Size and position of the window. A position is a pair or nothing — never
 * half of one — and nothing leaves the platform to place the window.
 */
export interface WindowState {
  size: WindowSize
  position: Maybe<WindowPosition>
}

/** The window the first launch gets, and the floor a restored one is held to. */
export const WINDOW_DEFAULT_SIZE = { width: 1280, height: 820 }
export const WINDOW_MIN_SIZE = { width: 900, height: 600 }

/** The window a first launch gets: default size, placed by the platform. */
export function default_window_state(): WindowState {
  return { size: { ...WINDOW_DEFAULT_SIZE }, position: empty() }
}

/** The file the state came from — set by `restore_window_state`, never after. */
let state_file_path: Maybe<string> = empty()

/**
 * Restores the window state from its file, or the defaults when there is
 * none. Nothing is written here — the first write comes once the window is
 * open, from its actual geometry.
 */
export function restore_window_state(user_data_dir: string): WindowState {
  const file = window_state_path(user_data_dir)
  state_file_path = some(file)
  // The read is also the existence check: one look at the disk, so "is there
  // a file" and "what does it say" can never disagree.
  const text = read_window_state_file(file)
  if (text.is_empty()) {
    return default_window_state()
  }
  return parse_window_state(text.value)
}

/**
 * Writes the state to its file as it is. Reading the window's geometry is
 * the caller's business (`window_bounds()`), so this module never touches
 * Electron.
 */
export function persist_window_state(state: WindowState): void {
  if (state_file_path.is_empty()) {
    throw_coco('window state persisted before it was restored')
  }
  write_window_state(state_file_path.value, state)
}

/**
 * The window state a file's text describes, repaired on the way in: text
 * that is not JSON gives the defaults back, and text that is goes through
 * `sanitize_window_state`.
 */
export function parse_window_state(text: string): WindowState {
  try {
    return sanitize_window_state(JSON.parse(text) as Partial<WindowState>)
  } catch {
    return default_window_state()
  }
}

export function sanitize_window_state(state: Partial<WindowState> | null | undefined): WindowState {
  if (state === null || state === undefined || typeof state !== 'object') {
    return default_window_state()
  }
  return { size: sanitize_size(state.size), position: sanitize_position(state.position) }
}

function sanitize_size(size: WindowSize | null | undefined): WindowSize {
  if (size === null || size === undefined || typeof size !== 'object') {
    return { ...WINDOW_DEFAULT_SIZE }
  }
  return {
    width: clamp(size.width, WINDOW_MIN_SIZE.width, WINDOW_DEFAULT_SIZE.width),
    height: clamp(size.height, WINDOW_MIN_SIZE.height, WINDOW_DEFAULT_SIZE.height)
  }
}

function clamp(value: number, low: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(low, value)
}

// A position is restored only as a pair of real numbers; anything else is
// nothing, and the platform places the window. Both sides of the boundary
// pass through here: a live `Some`/`None` is unwrapped and rebuilt, a file's
// plain `{x, y} | null` is revived.
function sanitize_position(position: unknown): Maybe<WindowPosition> {
  if (position instanceof Some) {
    return sanitize_position(position.value)
  }
  if (position instanceof None || position === null || position === undefined) {
    return empty()
  }
  if (typeof position !== 'object') {
    return empty()
  }
  const pair = position as Partial<WindowPosition>
  if (
    typeof pair.x !== 'number' ||
    !Number.isFinite(pair.x) ||
    typeof pair.y !== 'number' ||
    !Number.isFinite(pair.y)
  ) {
    return empty()
  }
  return some({ x: pair.x, y: pair.y })
}
