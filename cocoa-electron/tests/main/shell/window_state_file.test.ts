// The window state's round trip through disk.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { some } from '../../../src/shared/maybe'
import type { WindowState } from '../../../src/main/shell/window_state'
import { parse_window_state } from '../../../src/main/shell/window_state'
import {
  read_window_state_file,
  write_window_state
} from '../../../src/main/shell/window_state_file'

const temps: string[] = []

function temp_file(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cocoa-window-')))
  temps.push(dir)
  return path.join(dir, 'window-state.json')
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('the file', () => {
  it('reads nothing when there is nothing to read', () => {
    expect(read_window_state_file(temp_file()).is_empty()).toBe(true)
  })

  it('round-trips a record', () => {
    const file = temp_file()
    const state: WindowState = {
      size: { width: 1000, height: 700 },
      position: some({ x: 5, y: 5 })
    }
    write_window_state(file, state)
    const text = read_window_state_file(file)
    expect(parse_window_state(text.or(''))).toEqual(state)
  })
})
