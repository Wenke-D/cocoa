// The one file the window's own arrangement lives in. The engine's `store.json`
// is the *experiments'* memory (convention §5) and has no business holding
// which page was open, so this is a second, smaller file next to it — in
// Electron's `userData`, which is per-app and per-user.
//
// eframe does this for the Rust app without being asked; here it is explicit,
// which at least makes it testable.

import fs from 'node:fs'
import path from 'node:path'
import type { UiState } from '@shared/ui'
import { default_ui_state, sanitize } from '@shared/ui'
import { write_atomic } from './engine/store'

/**
 * A file that fails to parse is not an error worth stopping for: the worst
 * case is a window that opens where it always opens. Everything that comes
 * back is put through `sanitize` — this is untrusted JSON, older or newer than
 * this build, and possibly edited by hand.
 */
export function read_ui_state(file_path: string): UiState {
  let text: string
  try {
    text = fs.readFileSync(file_path, 'utf8')
  } catch {
    return default_ui_state()
  }
  try {
    return sanitize(JSON.parse(text) as Partial<UiState>)
  } catch {
    return default_ui_state()
  }
}

/**
 * Written atomically, like every other file this app owns (§12): a relaunch
 * after a crash mid-write should find the previous arrangement, never half of
 * this one. A failure is swallowed — losing the sidebar width is not worth an
 * error in the user's face.
 *
 * What is written is what the session actually had, including a Start page or
 * a report — repair belongs to the restore, where the rule is about what a
 * relaunch should *land on*, not about what was true.
 */
export function write_ui_state(file_path: string, state: UiState): void {
  try {
    write_atomic(file_path, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('ui state:', error)
  }
}

/**
 * Where the window's arrangement is kept: `ui-state.json` in Electron's
 * `userData`, beside the engine's `store.json`.
 *
 * `userData` is per-application and per-user, and the platform already has an
 * answer for where that is — `~/Library/Application Support/coco` on macOS,
 * `~/.config/coco` on Linux. That is the whole reason to use it rather than a
 * path of coco's own choosing.
 *
 * The directory arrives as an argument rather than being read from
 * `app.getPath` here, which is what keeps this module free of Electron. A
 * module that imports Electron can only be tested with an app around it; this
 * one is tested against a temp directory (`tests/ui_state_file.test.ts`).
 *
 * @param user_data_dir Electron's `userData`, from `app.getPath('userData')`.
 *   The caller reads it once at `whenReady` and passes it down (`index.ts`).
 * @returns The file's absolute path — or whatever `COCO_UI_STATE_PATH` names,
 *   if it is set. That override exists for one reason: a drive run (§28) has
 *   to quit and relaunch the app to see what survives a launch, and it must
 *   not decide where the real window opens next. `scripts/drive.mjs` points it
 *   at a scratch file under `.drive/`; nothing else sets it, and nothing else
 *   reads it.
 */
export function ui_state_path(user_data_dir: string): string {
  const override = process.env['COCO_UI_STATE_PATH']
  if (override !== undefined && override !== '') {
    return override
  }
  return path.join(user_data_dir, 'ui-state.json')
}
