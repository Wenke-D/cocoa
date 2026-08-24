// The shared formatting helpers (src/shared/world.ts): a duration is a clock
// while the run is live and a length once it has ended; a moment is said
// relative to now, in the largest unit that fits (§22.2).

import { describe, expect, it } from 'vitest'
import { format_duration, format_relative } from '../src/shared/world'

const STARTED = '2026-08-23T10:00:00Z'
const at = (seconds: number): string => new Date(Date.parse(STARTED) + seconds * 1000).toISOString()

describe('format_duration', () => {
  it('ticks as a clock while the run is live', () => {
    expect(format_duration(STARTED, null, Date.parse(at(0)))).toBe('00:00:00')
    expect(format_duration(STARTED, null, Date.parse(at(5)))).toBe('00:00:05')
    expect(format_duration(STARTED, null, Date.parse(at(3600 + 120 + 3)))).toBe('01:02:03')
    expect(format_duration(STARTED, null, Date.parse(at(100 * 3600)))).toBe('100:00:00')
  })

  it('is a length once the run has ended, with empty leading units dropped', () => {
    expect(format_duration(STARTED, at(0), 0)).toBe('0s')
    expect(format_duration(STARTED, at(5), 0)).toBe('5s')
    expect(format_duration(STARTED, at(120), 0)).toBe('2m 0s')
    expect(format_duration(STARTED, at(3600 + 120 + 3), 0)).toBe('1h 2m 3s')
    expect(format_duration(STARTED, at(2 * 3600 + 7), 0)).toBe('2h 0m 7s')
    expect(format_duration(STARTED, at(100 * 3600), 0)).toBe('100h 0m 0s')
  })

  it('never runs backwards', () => {
    expect(format_duration(STARTED, null, Date.parse(at(-30)))).toBe('00:00:00')
    expect(format_duration(STARTED, at(-30), 0)).toBe('0s')
  })
})

describe('format_relative', () => {
  const since = (seconds: number): string => format_relative(STARTED, Date.parse(at(seconds)))

  it('names the largest unit that fits, singular when it is one', () => {
    expect(since(0)).toBe('just now')
    expect(since(1)).toBe('1 second ago')
    expect(since(59)).toBe('59 seconds ago')
    expect(since(60)).toBe('1 minute ago')
    expect(since(119)).toBe('1 minute ago')
    expect(since(3599)).toBe('59 minutes ago')
    expect(since(3600)).toBe('1 hour ago')
    expect(since(86399)).toBe('23 hours ago')
    expect(since(86400)).toBe('1 day ago')
    expect(since(2 * 86400)).toBe('2 days ago')
    expect(since(29 * 86400)).toBe('29 days ago')
    expect(since(30 * 86400)).toBe('1 month ago')
    expect(since(364 * 86400)).toBe('12 months ago')
    expect(since(365 * 86400)).toBe('1 year ago')
    expect(since(3 * 365 * 86400)).toBe('3 years ago')
  })

  it('never runs ahead of now', () => {
    expect(since(-30)).toBe('just now')
  })
})
