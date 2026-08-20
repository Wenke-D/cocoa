// Template analysis and rendering. Ported from engine/template.rs's inline
// tests — the same templates, held to the same verdicts, over nunjucks
// instead of minijinja.

import { describe, expect, it } from 'vitest'
import { analyze, render } from '../src/main/engine/template'

/** The message of a rejected analyze; fails loudly if it is accepted. */
function rejected(source: string, params: string[]): string {
  try {
    analyze(source, params)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error(`expected \`${source}\` to be rejected`)
}

describe('analyze', () => {
  it('accepts an exact match', () => {
    expect(() =>
      analyze('#SBATCH --nodes={{ size }}\n./solver --backend {{ backend }}\n', [
        'size',
        'backend'
      ])
    ).not.toThrow()
  })

  it('rejects undefined variables and unused params', () => {
    expect(rejected('{{ size }}', ['size', 'backend'])).toBe(
      'declared param never used: backend'
    )
    expect(rejected('{{ size }} {{ nodes }}', ['size'])).toBe('undefined variable: nodes')
    expect(rejected('{{ nodes }}', ['size', 'backend'])).toBe(
      'undefined variable: nodes; declared params never used: backend, size'
    )
  })

  it('accepts loops, conditionals, filters and set', () => {
    expect(() =>
      analyze(
        '{% set n = size|int %}{% for i in range(n) %}{{ i }} {% endfor %}' +
          '{% if backend == "cuda" %}gpu{% endif %}',
        ['size', 'backend']
      )
    ).not.toThrow()
  })

  it('does not count loop and set targets as params', () => {
    expect(() =>
      analyze('{% for mesh in meshes %}{{ mesh }}{% endfor %}{% set x = size %}{{ x }}', [
        'meshes',
        'size'
      ])
    ).not.toThrow()
  })

  it('treats the loop variable outside a loop as undefined', () => {
    expect(rejected('{{ loop.index }}', [])).toContain('loop')
  })

  it('accepts the loop variable inside a loop', () => {
    expect(() =>
      analyze('{% for m in meshes %}{{ loop.index }} {{ m }}{% endfor %}', ['meshes'])
    ).not.toThrow()
  })

  it('rejects include, extends and import', () => {
    for (const source of [
      '{% include "other.tmpl" %}',
      '{% extends "base.tmpl" %}',
      '{% import "m.tmpl" as m %}',
      '{% from "m.tmpl" import foo %}'
    ]) {
      expect(rejected(source, []), source).toContain('pulls in another file')
    }
  })

  it('does not count filters or tests as variables', () => {
    expect(() => analyze('{{ size|int }}', ['size'])).not.toThrow()
    expect(() => analyze('{{ size is defined }}', ['size'])).not.toThrow()
    // A test's arguments are data, and are checked like any other reference.
    expect(() => analyze('{{ size is divisibleby(step) }}', ['size', 'step'])).not.toThrow()
    expect(rejected('{{ size is divisibleby(step) }}', ['size'])).toBe(
      'undefined variable: step'
    )
  })

  it('does not count macro calls as variable references', () => {
    expect(() =>
      analyze('{% macro label(x) %}[{{ x }}]{% endmacro %}{{ label(size) }}', ['size'])
    ).not.toThrow()
  })

  it('counts only the root of an attribute read', () => {
    expect(() => analyze('{{ solver.gpu }}', ['solver'])).not.toThrow()
  })

  it('accepts method calls on params', () => {
    expect(() => analyze('{{ text|upper }}', ['text'])).not.toThrow()
    expect(() => analyze('{{ params.get("a") }}', ['params'])).not.toThrow()
  })
})

describe('render', () => {
  it('renders with strict undefined', () => {
    expect(render('nodes={{ size }}', { size: '256' })).toBe('nodes=256')
    expect(() => render('nodes={{ nope }}', { size: '256' })).toThrow()
  })
})
