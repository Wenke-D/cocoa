// What a relaunch does with the file the last session left behind. Two
// separable questions: what `sanitize` makes of a restored arrangement
// (`@shared/ui`, the port of `UiState::sanitize`), and what survives the round
// trip through disk (`src/main/uiState.ts`).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { UiState } from '../src/shared/ui'
import { SIDEBAR_DEFAULT_WIDTH, defaultUiState, sanitize } from '../src/shared/ui'
import { loadUiState, saveUiState } from '../src/main/uiState'

const temps: string[] = []

function tempFile(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-ui-')))
  temps.push(dir)
  return path.join(dir, 'ui-state.json')
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('sanitize', () => {
  it('keeps an ordinary arrangement as it is', () => {
    const state: UiState = {
      route: { page: 'jobRun', jobId: 'solver', runId: '3' },
      sidebarWidth: 260,
      reportWrapLines: true,
      window: { width: 1400, height: 900, x: 20, y: 40 }
    }
    expect(sanitize(state)).toEqual(state)
  })

  // A report is read from disk when it is opened; restoring the address would
  // make the first thing a launch does a disk read nobody asked for.
  it('never restores a report', () => {
    const restored = sanitize({
      ...defaultUiState(),
      route: { page: 'report', context: { kind: 'jobRun', jobId: 'solver' }, runId: '3' }
    })
    expect(restored.route).toEqual({ page: 'empty' })
  })

  // The draft is not persisted, so the page would come back empty (§15).
  it('turns a start page into the experiment it belonged to', () => {
    const restored = sanitize({ ...defaultUiState(), route: { page: 'start', entityId: 'solver' } })
    expect(restored.route).toEqual({ page: 'entity', entityId: 'solver' })
  })

  it('restores a bench child run, context and all', () => {
    const route = { page: 'benchChild', benchId: 'nightly', benchRunId: '7', runId: '8' } as const
    expect(sanitize({ ...defaultUiState(), route }).route).toEqual(route)
  })

  it('clamps a sidebar that was dragged or edited out of range', () => {
    expect(sanitize({ sidebarWidth: 10_000 }).sidebarWidth).toBe(400)
    expect(sanitize({ sidebarWidth: 5 }).sidebarWidth).toBe(180)
    expect(sanitize({ sidebarWidth: Number.NaN }).sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH)
  })

  it('drops a route this build cannot answer for', () => {
    expect(sanitize({ route: { page: 'nowhere' } as never }).route).toEqual({ page: 'empty' })
    expect(sanitize({ route: { page: 'entity' } as never }).route).toEqual({ page: 'empty' })
    expect(sanitize({ route: null as never }).route).toEqual({ page: 'empty' })
  })

  it('takes a window position only as a pair', () => {
    const half = sanitize({ window: { width: 1200, height: 800, x: 10, y: null } })
    expect(half.window).toEqual({ width: 1200, height: 800, x: null, y: null })
  })

  it('will not remember a window smaller than the app can be', () => {
    expect(sanitize({ window: { width: 100, height: 100, x: null, y: null } }).window).toEqual({
      width: 900,
      height: 600,
      x: null,
      y: null
    })
  })
})

describe('the file', () => {
  it('gives the defaults when there is nothing to read', () => {
    expect(loadUiState(tempFile())).toEqual(defaultUiState())
  })

  it('round-trips an arrangement', () => {
    const file = tempFile()
    const state: UiState = {
      route: { page: 'benchRun', benchId: 'nightly', runId: '2' },
      sidebarWidth: 300,
      reportWrapLines: true,
      window: { width: 1000, height: 700, x: 5, y: 5 }
    }
    saveUiState(file, state)
    expect(loadUiState(file)).toEqual(state)
  })

  // Losing the sidebar width is never worth a failed launch.
  it('shrugs off a file that does not parse', () => {
    const file = tempFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{ this is not json')
    expect(loadUiState(file)).toEqual(defaultUiState())
  })

  it('sanitizes what it reads, not only what it is given', () => {
    const file = tempFile()
    fs.writeFileSync(
      file,
      JSON.stringify({ route: { page: 'start', entityId: 'solver' }, sidebarWidth: 9999 })
    )
    const restored = loadUiState(file)
    expect(restored.route).toEqual({ page: 'entity', entityId: 'solver' })
    expect(restored.sidebarWidth).toBe(400)
  })
})
