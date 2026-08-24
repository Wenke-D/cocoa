// What a relaunch does with the arrangement the last session left in
// localStorage. Two separable questions: what `sanitize` makes of a restored
// arrangement (the port of `UiState::sanitize`), and what survives the round
// trip through storage (`load_ui_state`/`store_ui_state`).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiState } from '../src/renderer/src/ui_state'
import {
  EXPLORER_DEFAULT_SPLIT,
  EXPLORER_MAX_SPLIT,
  EXPLORER_MIN_SPLIT,
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
      sidebar_width: 260,
      explorer_split: 0.5,
      report_wrap_lines: true
    }
    expect(sanitize(state)).toEqual(state)
  })

  // Where the user was is not the arrangement's business: a launch always
  // opens on the Explorer with nothing selected (§32), so a route stored by
  // an older build is simply not read.
  it('ignores fields this build no longer keeps', () => {
    const restored = sanitize({
      route: { page: 'job_run', job_id: 'solver', run_id: '3' },
      sidebar_view: 'events',
      sidebar_open: false,
      sidebar_width: 260
    } as never)
    expect(restored).toEqual({ ...default_ui_state(), sidebar_width: 260 })
  })

  it('keeps the Explorer divider inside the sidebar', () => {
    expect(sanitize({ explorer_split: 0.02 }).explorer_split).toBe(EXPLORER_MIN_SPLIT)
    expect(sanitize({ explorer_split: 2 }).explorer_split).toBe(EXPLORER_MAX_SPLIT)
    expect(sanitize({ explorer_split: Number.NaN }).explorer_split).toBe(EXPLORER_DEFAULT_SPLIT)
  })

  it('clamps a sidebar that was dragged or edited out of range', () => {
    expect(sanitize({ sidebar_width: 10_000 }).sidebar_width).toBe(400)
    expect(sanitize({ sidebar_width: 5 }).sidebar_width).toBe(180)
    expect(sanitize({ sidebar_width: Number.NaN }).sidebar_width).toBe(SIDEBAR_DEFAULT_WIDTH)
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
    expect(restored).toEqual({ ...default_ui_state(), sidebar_width: 400 })
  })

  it('round-trips an arrangement', () => {
    const state: UiState = {
      sidebar_width: 300,
      explorer_split: 0.5,
      report_wrap_lines: true
    }
    store_ui_state(state)
    expect(load_ui_state()).toEqual(state)
  })
})
