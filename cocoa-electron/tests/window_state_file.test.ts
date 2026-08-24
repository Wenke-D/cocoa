// What a relaunch does with the window state the last session left behind:
// what `sanitize_window_state` makes of a restored record, what
// `parse_window_state` makes of a file's text, and what survives the round
// trip through disk (`src/main/shell/window_state_file.ts`).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { empty, some } from '../src/shared/maybe'
import type { WindowState } from '../src/main/shell/window_state'
import {
  default_window_state,
  parse_window_state,
  sanitize_window_state
} from '../src/main/shell/window_state'
import { read_window_state_file, write_window_state } from '../src/main/shell/window_state_file'

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

describe('sanitize', () => {
  it('keeps an ordinary record as it is', () => {
    const state: WindowState = {
      size: { width: 1400, height: 900 },
      position: some({ x: 20, y: 40 })
    }
    expect(sanitize_window_state(state)).toEqual(state)
  })

  it('takes a position only as a pair', () => {
    const half = sanitize_window_state({
      size: { width: 1200, height: 800 },
      position: { x: 10, y: null } as never
    })
    expect(half).toEqual({ size: { width: 1200, height: 800 }, position: empty() })
  })

  it('will not remember a window smaller than the app can be', () => {
    expect(sanitize_window_state({ size: { width: 100, height: 100 }, position: empty() })).toEqual(
      {
        size: { width: 900, height: 600 },
        position: empty()
      }
    )
  })

  it('gives the defaults for a record that is not one', () => {
    expect(sanitize_window_state(null)).toEqual(default_window_state())
    expect(sanitize_window_state('window' as never)).toEqual(default_window_state())
  })
})

describe('parse', () => {
  // Losing the geometry is never worth a failed launch.
  it('shrugs off text that is not JSON', () => {
    expect(parse_window_state('{ this is not json')).toEqual(default_window_state())
  })
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
