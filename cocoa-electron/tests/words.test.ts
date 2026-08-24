// Lexical command splitting.

import { describe, expect, it } from 'vitest'
import { split_command } from '../src/main/engine/words'

describe('split_command', () => {
  it('splits plain words', () => {
    expect(split_command('python3 tools/report.py --strict')).toEqual([
      'python3',
      'tools/report.py',
      '--strict'
    ])
  })

  it('groups quoted text', () => {
    expect(split_command(`prog 'a b' "c d" e`)).toEqual(['prog', 'a b', 'c d', 'e'])
  })

  it('escapes characters with a backslash', () => {
    expect(split_command('prog a\\ b\\ c')).toEqual(['prog', 'a b c'])
  })

  it('keeps empty quoted words', () => {
    expect(split_command(`prog "" ''`)).toEqual(['prog', '', ''])
  })

  it('collapses leading and trailing whitespace', () => {
    expect(split_command('  a  b  ')).toEqual(['a', 'b'])
  })

  it('rejects unclosed quotes', () => {
    expect(() => split_command(`prog 'oops`)).toThrow('unclosed single quote')
    expect(() => split_command(`prog "oops`)).toThrow('unclosed double quote')
  })

  it('rejects a trailing backslash', () => {
    expect(() => split_command('prog \\')).toThrow('bad escape')
  })

  it('finds no words in empty input', () => {
    expect(split_command('')).toEqual([])
    expect(split_command('   ')).toEqual([])
  })
})
