// The engine's check of a whole set of parameters, which names every fault at
// once.

import { describe, expect, it } from 'vitest'
import { param_problems } from '../../../src/main/engine/params'
import { spec } from '../../support/param_specs'

describe('param_problems', () => {
  const declared = [
    spec({ name: 'gpu', type: 'enum', values: ['0', '1'] }),
    spec({ name: 'profile', type: 'enum', values: ['true', 'false'] })
  ]

  it('is silent when the set matches and every value fits', () => {
    expect(param_problems(declared, { gpu: '1', profile: 'true' })).toEqual([])
  })

  it('names what is missing, what is extra, and what does not fit — all of it', () => {
    expect(param_problems(declared, { gpu: '2', mesh: '1' })).toEqual([
      'missing `profile`',
      'extra `mesh`',
      '`gpu` must be one of `0`, `1`, found `2`'
    ])
  })
})
