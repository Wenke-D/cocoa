// The one file the window's geometry lives in. The engine's `store.json` is
// the *experiments'* memory (convention §5) and has no business holding how
// big a window was, so this is a second, smaller file next to it — in
// Electron's `userData`, which is per-app and per-user.
//
// The write is plain, not atomic — §12 is the engine store's convention, for
// files with readers other than this app. A crash mid-write can only leave
// truncated JSON, which `parse_window_state` already turns into the
// defaults, so the worst a torn file can cost is one session's geometry —
// the same loss this record accepts everywhere else.

import fs from 'node:fs'
import path from 'node:path'
import type { Maybe } from '@shared/maybe'
import { empty, some } from '@shared/maybe'
import type { WindowState } from './window_state'

/** Where the window state lives: `window-state.json` under `userData`. */
export function window_state_path(user_data_dir: string): string {
  return path.join(user_data_dir, 'window-state.json')
}

/**
 * The text in the window state file, or nothing when there is no file to
 * read — missing and unreadable are the same answer: nothing to restore.
 */
export function read_window_state_file(file_path: string): Maybe<string> {
  try {
    return some(fs.readFileSync(file_path, 'utf8'))
  } catch {
    return empty()
  }
}

/**
 * Writes the state to its file as JSON, making the parent directory when it
 * is missing. A failed write is logged and dropped.
 */
export function write_window_state(file_path: string, state: WindowState): void {
  try {
    fs.mkdirSync(path.dirname(file_path), { recursive: true })
    fs.writeFileSync(file_path, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('window state:', error)
  }
}
