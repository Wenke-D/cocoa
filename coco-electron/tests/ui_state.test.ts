// What a relaunch does with the arrangement the last session left in
// localStorage. Two separable questions: what `sanitize` makes of a restored
// arrangement (the port of `UiState::sanitize`), and what survives the round
// trip through storage (`load_ui_state`/`store_ui_state`).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiState } from '../src/renderer/src/ui_state'
import {
  SIDEBAR_DEFAULT_WIDTH,
  default_ui_state,
  load_ui_state,
  sanitize,
  store_ui_state
} from '../src/renderer/src/ui_state'

// The renderer runs in a page; these tests run in node. The stub is the
// smallest thing `load_ui_state`/`store_ui_state` need a page to be.
const storage = new Map<string, string>()
vi.stubGlobal('window', {
  localStorage: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      storage.set(key, value)
    }
  }
})

beforeEach(() => {
  storage.clear()
})

describe('sanitize', () => {
  it('keeps an ordinary arrangement as it is', () => {
    const state: UiState = {
      route: { page: 'job_run', job_id: 'solver', run_id: '3' },
      sidebar_width: 260,
      report_wrap_lines: true
    }
    expect(sanitize(state)).toEqual(state)
  })

  // A report is read from disk when it is opened; restoring the address would
  // make the first thing a launch does a disk read nobody asked for.
  it('never restores a report', () => {
    const restored = sanitize({
      ...default_ui_state(),
      route: { page: 'report', context: { kind: 'job_run', job_id: 'solver' }, run_id: '3' }
    })
    expect(restored.route).toEqual({ page: 'empty' })
  })

  // The draft is not persisted, so the page would come back empty (§15).
  it('turns a start page into the experiment it belonged to', () => {
    const restored = sanitize({
      ...default_ui_state(),
      route: { page: 'start', entity_id: 'solver' }
    })
    expect(restored.route).toEqual({ page: 'entity', entity_id: 'solver' })
  })

  it('restores a bench child run, context and all', () => {
    const route = {
      page: 'bench_child',
      bench_id: 'nightly',
      bench_run_id: '7',
      run_id: '8'
    } as const
    expect(sanitize({ ...default_ui_state(), route }).route).toEqual(route)
  })

  it('clamps a sidebar that was dragged or edited out of range', () => {
    expect(sanitize({ sidebar_width: 10_000 }).sidebar_width).toBe(400)
    expect(sanitize({ sidebar_width: 5 }).sidebar_width).toBe(180)
    expect(sanitize({ sidebar_width: Number.NaN }).sidebar_width).toBe(SIDEBAR_DEFAULT_WIDTH)
  })

  it('drops a route this build cannot answer for', () => {
    expect(sanitize({ route: { page: 'nowhere' } as never }).route).toEqual({ page: 'empty' })
    expect(sanitize({ route: { page: 'entity' } as never }).route).toEqual({ page: 'empty' })
    expect(sanitize({ route: null as never }).route).toEqual({ page: 'empty' })
  })
})

describe('storage', () => {
  it('loads the defaults when nothing was stored yet', () => {
    expect(load_ui_state()).toEqual(default_ui_state())
  })

  // Losing the sidebar width is never worth a failed launch.
  it('shrugs off stored text that is not JSON', () => {
    storage.set('ui-state', '{ this is not json')
    expect(load_ui_state()).toEqual(default_ui_state())
  })

  it('sanitizes what it loads', () => {
    storage.set(
      'ui-state',
      JSON.stringify({ route: { page: 'start', entity_id: 'solver' }, sidebar_width: 9999 })
    )
    const restored = load_ui_state()
    expect(restored.route).toEqual({ page: 'entity', entity_id: 'solver' })
    expect(restored.sidebar_width).toBe(400)
  })

  it('round-trips an arrangement', () => {
    const state: UiState = {
      route: { page: 'bench_run', bench_id: 'nightly', run_id: '2' },
      sidebar_width: 300,
      report_wrap_lines: true
    }
    store_ui_state(state)
    expect(load_ui_state()).toEqual(state)
  })
})
