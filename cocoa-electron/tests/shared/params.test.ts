// A parameter's shape: what a value of each shape may be, and how it goes on
// the wire.

import { describe, expect, it } from 'vitest'
import { argv_of, check_value, describe_values, format_params } from '../../src/shared/params'
import { spec } from '../support/param_specs'

const STRING = spec({})

const ENUM = spec({ type: 'enum', values: ['a', 'b'] })

const STRINGS = spec({ list: true })

const ENUMS = spec({ type: 'enum', values: ['a', 'b'], list: true })

describe('check_value', () => {
  it('takes a non-blank string for a string, and nothing else', () => {
    expect(check_value(STRING, 'x')).toBeNull()
    expect(check_value(STRING, '')).toBe('is empty')
    expect(check_value(STRING, '  ')).toBe('is empty')
    expect(check_value(STRING, true)).toBe('must be a string')
    expect(check_value(STRING, ['x'])).toBe('must be a string')
  })

  it('takes one of the declared values for an enum, exactly', () => {
    expect(check_value(ENUM, 'a')).toBeNull()
    expect(check_value(ENUM, 'A')).toBe('must be one of `a`, `b`, found `A`')
    expect(check_value(ENUM, '')).toBe('is empty')
    expect(check_value(ENUM, ['a'])).toBe('must be one of `a`, `b`')
  })

  // There is no boolean type: a yes/no parameter is an enum of the words,
  // and a JSON boolean is a wrong shape like any other.
  it('refuses a JSON boolean everywhere', () => {
    expect(check_value(STRING, true)).toBe('must be a string')
    expect(check_value(spec({ type: 'enum', values: ['true', 'false'] }), 'false')).toBeNull()
    expect(check_value(spec({ type: 'enum', values: ['true', 'false'] }), false)).toBe(
      'must be one of `true`, `false`'
    )
  })

  it('takes one or more strings for a list, each a value, none twice', () => {
    expect(check_value(STRINGS, ['x'])).toBeNull()
    expect(check_value(STRINGS, ['x', 'y'])).toBeNull()
    expect(check_value(STRINGS, [])).toBe('must list at least one value')
    expect(check_value(STRINGS, ['x', ''])).toBe('is empty')
    expect(check_value(STRINGS, ['x', 'x'])).toBe('lists `x` twice')
    expect(check_value(STRINGS, 'x')).toBe('must be a list of strings')
    expect(check_value(STRINGS, ['x', 1])).toBe('must be a list of strings')
  })

  it('holds a list of enums to the declared values', () => {
    expect(check_value(ENUMS, ['a', 'b'])).toBeNull()
    expect(check_value(ENUMS, ['a', 'c'])).toBe('must be one of `a`, `b`, found `c`')
    expect(check_value(ENUMS, 'a')).toBe('must be a list of `a`, `b`')
  })
})

describe('describe_values', () => {
  it('says what may be put there, from the filling-in side', () => {
    expect(describe_values(STRING)).toBe('a string')
    expect(describe_values(ENUM)).toBe('a / b')
    expect(describe_values(spec({ type: 'enum', values: ['true', 'false'] }))).toBe('true / false')
    expect(describe_values(STRINGS)).toBe('[strings]')
    expect(describe_values(ENUMS)).toBe('[a, b]')
  })
})

describe('argv_of', () => {
  it('is always pairs, a list as the pair repeated', () => {
    expect(argv_of('mesh', '256')).toEqual(['--mesh', '256'])
    expect(argv_of('tags', ['a', 'b'])).toEqual(['--tags', 'a', '--tags', 'b'])
  })

  it('reads back as the wire form, names sorted', () => {
    expect(format_params({ tags: ['a', 'b'], gpu: '0', profile: 'false' })).toBe(
      '--gpu 0 --profile false --tags a --tags b'
    )
    expect(format_params({})).toBe('')
  })
})
