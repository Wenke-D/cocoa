// Where the engine's store lives, and the one-time move that got it there.
//
// It used to be `~/.local/share/coco/store.json`, hardcoded identically in
// both implementations so a folder registered in one appeared in the other.
// That was the point while there were two; there is one now, and the path was
// the only reason two cocos could race each other.
//
// It lives in Electron's `userData` instead — the per-app, per-user directory
// the platform already has an answer for, next to `ui-state.json`.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { env_var } from './env'

/** Where it lived until 2026-08-20, and where coco-egui still looks. */
export function legacy_store_path(): string {
  return path.join(os.homedir(), '.local', 'share', 'coco', 'store.json')
}

/**
 * The store's path, having moved anything that was at the old one.
 *
 * `COCO_STORE_PATH` wins outright and skips the move: a drive run points at a
 * scratch store, and must not touch the real one on the way past.
 */
export function resolve_store_path(user_data_dir: string, legacy = legacy_store_path()): string {
  const override = env_var('COCO_STORE_PATH')
  if (override.is_present()) {
    return override.value
  }

  const target = path.join(user_data_dir, 'store.json')
  carry_over(legacy, target)
  return target
}

/**
 * Copies the old store to the new place, if there is one and nothing is there
 * yet. Copies rather than moves, so `coco-egui/` keeps reading the old file.
 *
 * A failure is logged and swallowed: it is not worth stopping a launch for.
 */
function carry_over(legacy: string, target: string): void {
  try {
    if (fs.existsSync(target) || !fs.existsSync(legacy)) {
      return
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(legacy, target)
    console.log('store: carried over from', legacy)
  } catch (error) {
    console.error('store: could not carry over from', legacy, error)
  }
}
