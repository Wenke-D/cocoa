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
  const override = process.env.COCO_STORE_PATH
  if (override !== undefined && override !== '') return override

  const target = path.join(user_data_dir, 'store.json')
  carry_over(legacy, target)
  return target
}

/**
 * Copies rather than moves, and only into an empty place.
 *
 * Copy, because the old file is the one coco-egui still reads: taking it would
 * empty that Explorer for a tree that is meant to keep working. And only when
 * nothing is at the destination, so this is a migration exactly once — after
 * that the new file is the truth and the old one is a fossil.
 *
 * A failure here is not worth stopping a launch for. The worst case is an
 * Explorer that has forgotten its folders, which the user can add back; the
 * experiment records were never in this file.
 */
function carry_over(legacy: string, target: string): void {
  try {
    if (fs.existsSync(target) || !fs.existsSync(legacy)) return
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(legacy, target)
    console.log('store: carried over from', legacy)
  } catch (error) {
    console.error('store: could not carry over from', legacy, error)
  }
}
