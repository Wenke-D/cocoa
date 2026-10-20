// Files a test writes into an experiment folder, and reads back.

import fs from 'node:fs'
import path from 'node:path'

export function write(folder: string, name: string, contents: string): void {
  fs.writeFileSync(path.join(folder, name), contents)
}

export function write_script(folder: string, name: string, body: string): void {
  const file = path.join(folder, name)
  fs.writeFileSync(file, `#!/bin/sh\n${body}`)
  fs.chmodSync(file, 0o755)
}

/**
 * Writes a file the way a person outside cocoa would, and moves its mtime
 * forward so the change is unambiguous to the reconcile pass. Real hand-edits
 * arrive seconds apart from the engine's own writes; a test writes in the same
 * millisecond, which would otherwise be indistinguishable from "unchanged".
 */
export function hand_edit(file: string, contents: string): void {
  fs.writeFileSync(file, contents)
  const later = new Date(Date.now() + 2_000)
  fs.utimesSync(file, later, later)
}

export function exists(...parts: string[]): boolean {
  return fs.existsSync(path.join(...parts))
}

export function is_file(...parts: string[]): boolean {
  const file = path.join(...parts)
  return fs.existsSync(file) && fs.statSync(file).isFile()
}

export function read_text(...parts: string[]): string {
  return fs.readFileSync(path.join(...parts), 'utf8')
}
