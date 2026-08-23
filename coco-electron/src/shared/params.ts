// A parameter, typed (convention §2.1): what a manifest declares, what a
// value is, and the one check both sides run on a value — the engine before
// a start, the renderer when it refills a form from a past run.
//
// To coco a value is a string with a shape: one string, one of a declared
// set, a flag, or one or more of the first two. The scripts read them however
// they like; the shape is what coco can check and what the form can ask for.

export type ParamType = 'flag' | 'string' | 'enum'

export interface ParamSpec {
  name: string
  type: ParamType
  /** `enum` only: what the value may be, in declaration order; `null` otherwise. */
  values: string[] | null
  /** `string` and `enum` only: the value is one or more of them, never none. */
  list: boolean
  description: string
}

/** A value as coco holds it, records it and hands it on: the JSON is the type. */
export type ParamValue = string | boolean | string[]

export type Params = Record<string, ParamValue>

const quote = (value: string): string => `\`${value}\``
const quoted = (values: string[]): string => values.map(quote).join(', ')

/**
 * Why `value` is not a value for `spec`, or `null` when it is. Nothing is
 * coerced: a flag is a boolean, a list is an array, and `"true"` is a string
 * that is no flag at all.
 */
export function check_value(spec: ParamSpec, value: unknown): string | null {
  if (spec.type === 'flag') {
    return typeof value === 'boolean' ? null : 'must be true or false'
  }
  if (spec.list) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return spec.values === null
        ? 'must be a list of strings'
        : `must be a list of ${quoted(spec.values)}`
    }
    const items = value as string[]
    if (items.length === 0) {
      return 'must list at least one value'
    }
    const seen = new Set<string>()
    for (const item of items) {
      const problem = check_one(spec, item)
      if (problem !== null) {
        return problem
      }
      if (seen.has(item)) {
        return `lists ${quote(item)} twice`
      }
      seen.add(item)
    }
    return null
  }
  if (typeof value !== 'string') {
    return spec.values === null ? 'must be a string' : `must be one of ${quoted(spec.values)}`
  }
  return check_one(spec, value)
}

function check_one(spec: ParamSpec, value: string): string | null {
  if (value.trim() === '') {
    return 'is empty'
  }
  if (spec.values !== null && !spec.values.includes(value)) {
    return `must be one of ${quoted(spec.values)}, found ${quote(value)}`
  }
  return null
}

/**
 * What may be put here, for the person about to: `a string`, the values
 * themselves for an enum, `true or false`, `one or more strings`, `one or
 * more of a, b`. Phrased from the filling-in side, not the type system's.
 */
export function describe_values(spec: ParamSpec): string {
  if (spec.type === 'flag') {
    return 'true or false'
  }
  if (spec.values === null) {
    return spec.list ? 'one or more strings' : 'a string'
  }
  return spec.list ? `one or more of ${spec.values.join(', ')}` : spec.values.join(', ')
}

/**
 * A value on the wire (§6): always `--name value` pairs. A flag is `--name
 * true` or `--name false`, never present-or-absent, so every script parses
 * every parameter the same way; a list is the pair repeated, one per item.
 */
export function argv_of(name: string, value: ParamValue): string[] {
  if (typeof value === 'boolean') {
    return [`--${name}`, value ? 'true' : 'false']
  }
  if (typeof value === 'string') {
    return [`--${name}`, value]
  }
  return value.flatMap((item) => [`--${name}`, item])
}

/**
 * A whole set as a person reads it back: the wire form, names sorted —
 * `--gpu 0 --profile false --tags a --tags b` — which is also exactly what
 * the script was given (§6), so what is read is what ran.
 */
export function format_params(params: Params): string {
  return Object.keys(params)
    .sort()
    .flatMap((name) => argv_of(name, params[name]))
    .join(' ')
}
