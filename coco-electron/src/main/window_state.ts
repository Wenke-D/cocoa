// The window's own record: how big it was and where it sat, restored at
// launch and persisted at the endings. This is all the arrangement the main
// process still owns — the renderer keeps its half (route, sidebar, wrap) to
// itself, in localStorage (`renderer/src/ui_state.ts`), and the two never
// meet in one object.
//
// Nothing is written as it goes. The file is written when the window has
// closed and again at will-quit — plus once at the very first launch, so a
// session always has a file rather than only leaving one behind. A launch
// that finds a file never rewrites it: what is on disk records what a
// session actually had, and `sanitize_window_state` repairs it on the way
// in, never on the way out. What a crash costs is the session's geometry,
// which for a window rectangle is a trade worth making.
//
// Geometry is not tracked as it changes, either: `window.ts` takes one look
// at it as the window closes, and `persist_window_state` reads that look
// back. A resize therefore has no listener at all.
//
// The file is `window_state_file.ts`'s business, and the two layers are told
// apart by their verbs: that one *reads* and *writes* the file, this one
// *restores* a state, *parses* what the file said, and *persists* it at the
// end.

import type { Maybe } from '@shared/maybe'
import { None, Some, empty, some } from '@shared/maybe'
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
let path: Maybe<string> = empty()

/**
 * Restores the window state from its file, creating that file when there is
 * none yet. A created file records the defaults — that there is a file at
 * all, nothing more: no session has arranged anything yet.
 */
export function restore_window_state(user_data_dir: string): WindowState {
  const file = window_state_path(user_data_dir)
  path = some(file)
  // The read is also the existence check: one look at the disk, so "is there
  // a file" and "what does it say" can never disagree.
  const text = read_window_state_file(file)
  if (text.is_empty()) {
    const state = default_window_state()
    write_window_state(file, state)
    return state
  }
  return parse_window_state(text.value)
}

/**
 * Writes the file with the freshest geometry the caller could get
 * (`window_bounds()`), keeping what the state already held when there was
 * none. Geometry comes in as an argument so this module never touches
 * Electron — the window is `window.ts`'s.
 */
export function persist_window_state(state: WindowState, freshest: Maybe<WindowState>): void {
  if (path.is_empty()) {
    throw new Error('window state persisted before it was restored')
  }
  Object.assign(state, freshest.or(state))
  write_window_state(path.value, state)
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
