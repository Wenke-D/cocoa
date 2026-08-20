// Lexical command splitting. Ported from engine/words.rs's inline tests.

import { describe, expect, it } from 'vitest'
import { splitCommand } from '../src/main/engine/words'

describe('splitCommand', () => {
  it('splits plain words', () => {
    expect(splitCommand('python3 tools/report.py --strict')).toEqual([
      'python3',
      'tools/report.py',
      '--strict'
    ])
  })

  it('groups quoted text', () => {
    expect(splitCommand(`prog 'a b' "c d" e`)).toEqual(['prog', 'a b', 'c d', 'e'])
  })

  it('escapes characters with a backslash', () => {
    expect(splitCommand('prog a\\ b\\ c')).toEqual(['prog', 'a b c'])
  })

  it('keeps empty quoted words', () => {
    expect(splitCommand(`prog "" ''`)).toEqual(['prog', '', ''])
  })

  it('collapses leading and trailing whitespace', () => {
    expect(splitCommand('  a  b  ')).toEqual(['a', 'b'])
  })

  it('rejects unclosed quotes', () => {
    expect(() => splitCommand(`prog 'oops`)).toThrow('unclosed single quote')
    expect(() => splitCommand(`prog "oops`)).toThrow('unclosed double quote')
  })

  it('rejects a trailing backslash', () => {
    expect(() => splitCommand('prog \\')).toThrow('bad escape')
  })

  it('finds no words in empty input', () => {
    expect(splitCommand('')).toEqual([])
    expect(splitCommand('   ')).toEqual([])
  })
})
