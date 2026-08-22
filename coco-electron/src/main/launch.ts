// What this launch is: the facts settled before anything runs, read from the
// environment and the platform once, here, and asked for by name from then
// on. The store and socket overrides are not here — they are read where they
// are used, because the tests of those modules set them per case.
//
// Settled at import rather than by a call from `index.ts`: imports evaluate
// before that file's body, and `runtime.ts` builds the engine during them,
// so the profile has to be decided by the time anyone imports this.

import { app } from 'electron'
import { env_var } from './env'

// A drive run redirects everything the app keeps per-user — the window state
// file, the renderer's localStorage — so it never touches the real profile
// (`scripts/drive.mjs`). Before ready, or the default profile is already open.
const user_data_override = env_var('COCO_USER_DATA_DIR')
if (user_data_override.is_present()) {
  app.setPath('userData', user_data_override.value)
}

export const launch = Object.freeze({
  /**
   * The per-user directory: the store, the window state, the renderer's
   * localStorage. Electron's default, unless `COCO_USER_DATA_DIR` moved it.
   */
  user_data: app.getPath('userData'),

  /**
   * `COCO_HIDE_WINDOW=1` opens the window without showing it.
   *
   * For a drive run that is only there to be *checked*, not watched: Playwright
   * drives the page over CDP and screenshots it the same way, neither of which
   * needs the window on screen — but eleven scenarios in a row each stealing
   * focus makes the machine unusable while they run. Never set in normal use;
   * `npm run drive` still opens a window you can watch, which is its whole point.
   */
  hide_window: env_var('COCO_HIDE_WINDOW').or('') === '1',

  /** macOS: the platform with a dock, and a menu bar of its own. */
  is_mac: process.platform === 'darwin'
})
