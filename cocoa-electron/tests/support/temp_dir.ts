import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const created: string[] = []

/**
 * A temp directory, canonicalized — on macOS `/var` is a symlink to
 * `/private/var`, and the engine keys everything by the canonical path it
 * gets from `register`.
 */
export function temp_dir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cocoa-test-')))
  created.push(dir)
  return dir
}

/** Removes every directory `temp_dir` handed out. For `afterEach`. */
export function cleanup_temp_dirs(): void {
  while (created.length > 0) {
    fs.rmSync(created.pop() as string, { recursive: true, force: true })
  }
}
