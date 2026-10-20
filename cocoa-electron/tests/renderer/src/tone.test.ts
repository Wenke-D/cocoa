import { describe, expect, it } from 'vitest'
import { tone_of, tone_color } from '../../../src/renderer/src/tone'

describe('tone_of', () => {
  it('reads a status as the dot and the journal both draw it (§23)', () => {
    expect(tone_of('Succeeded')).toBe('good')
    expect(tone_of('Failed')).toBe('bad')
    expect(tone_of('Error')).toBe('bad')
    expect(tone_of('Cancelled')).toBe('neutral')
    expect(tone_of('Pending')).toBe('info')
    expect(tone_of('Cancelling')).toBe('info')
  })

  it('draws each tone in its own colour', () => {
    expect(tone_color('warn')).toBe('var(--chart-yellow)')
    expect(
      new Set((['good', 'bad', 'warn', 'neutral', 'info'] as const).map(tone_color)).size
    ).toBe(5)
  })
})
