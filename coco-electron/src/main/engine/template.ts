// Template validation and rendering (convention §6.1). Port of
// engine/template.rs, on nunjucks instead of minijinja.
//
// A template's variables and `[render].params` must match exactly: an
// undefined variable is an error, not an empty string, and a declared param
// the template never uses is equally an error. `include`/`extends`/`import`
// are rejected because they pull in variables from outside the file.

import { createRequire } from 'node:module'
import nunjucks from 'nunjucks'

// nunjucks ships its compiler as an undocumented-but-stable internal API.
// createRequire keeps this working whether the bundle lands as ESM or CJS.
const require_module = createRequire(import.meta.url)
const parser = require_module('nunjucks/src/parser') as { parse(source: string): AstNode }
const nodes = require_module('nunjucks/src/nodes') as Record<
  string,
  new (...args: never[]) => AstNode
>

interface AstNode {
  typename?: string
  children?: unknown[]
  [key: string]: unknown
}

export class TemplateError extends Error {}

/**
 * Names the language provides that are not experiment data: nunjucks'
 * globals, exactly. `loop` is deliberately not among them — it exists only
 * inside a `for` body, where the walker binds it as a local, so
 * `{{ loop.index }}` outside a loop is the undefined variable it really is
 * (engine/template.rs draws the same line over minijinja's globals).
 */
const BUILTINS = new Set(['range', 'cycler', 'joiner'])

const IMPORTING = new Set(['Include', 'Extends', 'Import', 'FromImport'])

function type_name(node: AstNode): string {
  return node.typename ?? node.constructor?.name ?? 'unknown'
}

function is_node(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && value instanceof (nodes.Node as never)
}

class Collector {
  readonly referenced = new Set<string>()
  private readonly scopes: Set<string>[] = [new Set()]
  private readonly macros = new Set<string>()

  private is_local(name: string): boolean {
    return this.scopes.some((scope) => scope.has(name))
  }

  private bind(name: string): void {
    this.scopes[this.scopes.length - 1].add(name)
  }

  private reference(name: string): void {
    if (!this.is_local(name) && !this.macros.has(name) && !BUILTINS.has(name)) {
      this.referenced.add(name)
    }
  }

  /** First pass: macro names, so calling one is not a variable reference. */
  collect_macro_names(node: AstNode): void {
    if (type_name(node) === 'Macro') {
      const name = (node.name as AstNode | undefined)?.value
      if (typeof name === 'string') {
        this.macros.add(name)
      }
    }
    for (const child of children_of(node)) {
      this.collect_macro_names(child)
    }
  }

  walk(node: AstNode): void {
    const type = type_name(node)

    if (IMPORTING.has(type)) {
      throw new TemplateError(`uses \`{% ${type.toLowerCase()} %}\`, which pulls in another file`)
    }

    switch (type) {
      case 'Symbol': {
        if (typeof node.value === 'string') {
          this.reference(node.value)
        }
        return
      }
      case 'For': {
        this.walk(node.arr as AstNode)
        this.scopes.push(new Set())
        bind_target(node.name as AstNode, (name) => this.bind(name))
        this.bind('loop')
        if (node.body !== undefined && node.body !== null) {
          this.walk(node.body as AstNode)
        }
        if (node.else_ !== undefined && node.else_ !== null) {
          this.walk(node.else_ as AstNode)
        }
        this.scopes.pop()
        return
      }
      case 'Set': {
        if (node.value !== undefined && node.value !== null) {
          this.walk(node.value as AstNode)
        }
        if (node.body !== undefined && node.body !== null) {
          this.walk(node.body as AstNode)
        }
        for (const target of (node.targets as AstNode[] | undefined) ?? []) {
          bind_target(target, (name) => this.bind(name))
        }
        return
      }
      case 'Macro': {
        const definition = node.name as AstNode | undefined
        if (typeof definition?.value === 'string') {
          this.macros.add(definition.value)
        }
        this.scopes.push(new Set())
        const args = (node.args as AstNode | undefined)?.children ?? []
        for (const arg of args) {
          if (is_node(arg)) {
            bind_target(arg, (name) => this.bind(name))
          }
        }
        if (node.body !== undefined && node.body !== null) {
          this.walk(node.body as AstNode)
        }
        this.scopes.pop()
        return
      }
      case 'Filter':
      case 'FunCall': {
        // A filter's name node is a Symbol but names a filter, not data. A
        // called name that is a defined macro or builtin is likewise no
        // reference; anything else falls through to Symbol handling.
        const name = node.name as AstNode | undefined
        if (type === 'Filter') {
          for (const child of children_of(node)) {
            if (child !== name) {
              this.walk(child)
            }
          }
          if (name !== undefined) {
            const args_only = name.children ?? []
            for (const child of args_only) {
              if (is_node(child)) {
                this.walk(child)
              }
            }
          }
          return
        }
        for (const child of children_of(node)) {
          this.walk(child)
        }
        return
      }
      case 'Is': {
        // `x is defined`, `x is divisibleby(n)` — the right side names a
        // test, which is language rather than experiment data. Its
        // arguments, if it takes any, are data and are walked.
        this.walk(node.left as AstNode)
        const test = node.right as AstNode | undefined
        if (test !== undefined && type_name(test) === 'FunCall') {
          for (const child of children_of(test)) {
            if (child !== test.name) {
              this.walk(child)
            }
          }
        }
        return
      }
      case 'LookupVal': {
        // `a.b` — only the root target is a variable; the key is data access.
        this.walk(node.target as AstNode)
        return
      }
      default: {
        for (const child of children_of(node)) {
          this.walk(child)
        }
      }
    }
  }
}

function children_of(node: AstNode): AstNode[] {
  const found: AstNode[] = []
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (is_node(value)) {
      found.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (is_node(item)) {
          found.push(item)
        }
      }
    }
  }
  return found
}

function bind_target(target: AstNode, bind: (name: string) => void): void {
  const type = type_name(target)
  if (type === 'Symbol' && typeof target.value === 'string') {
    bind(target.value)
    return
  }
  for (const child of children_of(target)) {
    bind_target(child, bind)
  }
}

/** Validates that a template's variable references are exactly `params`. */
export function analyze(source: string, params: string[]): void {
  let root: AstNode
  try {
    root = parser.parse(source)
  } catch (cause) {
    throw new TemplateError(`does not parse: ${(cause as Error).message}`)
  }

  const collector = new Collector()
  collector.collect_macro_names(root)
  collector.walk(root)

  const declared = new Set(params)
  const undefined_names = [...collector.referenced].filter((name) => !declared.has(name)).sort()
  const unused = params.filter((name) => !collector.referenced.has(name)).sort()

  if (undefined_names.length === 0 && unused.length === 0) {
    return
  }

  const parts: string[] = []
  if (undefined_names.length > 0) {
    parts.push(
      `undefined variable${undefined_names.length === 1 ? '' : 's'}: ${undefined_names.join(', ')}`
    )
  }
  if (unused.length > 0) {
    parts.push(`declared param${unused.length === 1 ? '' : 's'} never used: ${unused.join(', ')}`)
  }
  throw new TemplateError(parts.join('; '))
}

const strict_environment = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true
})

/**
 * Renders a template with strict undefined-variable behavior. The caller
 * re-runs `analyze` before rendering, so a template edited between one
 * refresh and the next can never produce a half-rendered submission (§6.1).
 */
export function render(source: string, params: Record<string, string>): string {
  try {
    return strict_environment.renderString(source, params)
  } catch (cause) {
    throw new TemplateError(`does not parse: ${(cause as Error).message}`)
  }
}
