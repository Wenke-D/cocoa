// Where the engine's store lives: Electron's `userData`, the per-app,
// per-user directory the platform already has an answer for, next to
// `ui-state.json`. A store found at the path the app used under its former
// name, coco, is carried over once.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Maybe } from '@shared/maybe'
import { env_var } from './env'
import { log_for } from './log'

const log = log_for('store_path')

/** The store's path under the app's former name. */
export function legacy_store_path(): string {
  return path.join(os.homedir(), '.local', 'share', 'coco', 'store.json')
}

/**
 * The store's path, having moved anything that was at the old one.
 *
 * `COCOA_STORE_PATH` wins outright and skips the move: a drive run points at a
 * scratch store, and must not touch the real one on the way past.
 */
export function resolve_store_path(user_data_dir: string, legacy: Maybe<string>): string {
  const override = env_var('COCOA_STORE_PATH')
  if (override.is_present()) {
    return override.value
  }

  const target = path.join(user_data_dir, 'store.json')
  if (legacy.is_present()) {
    carry_over(legacy.value, target)
  }
  return target
}

/**
 * Copies the old store to the new place, if there is one and nothing is there
 * yet. Copies rather than moves; the old file is left where it was.
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
    log.info('carried over from', legacy)
  } catch (error) {
    log.error('could not carry over from', legacy, error)
  }
}
