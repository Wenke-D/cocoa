// A value that may not be there — a container, `Some<T>` holding a value or
// `None<T>` holding nothing, asked with verbs instead of symbols. Absence and
// the data shape `| null` are different types, so the two cannot mix
// silently: `from_nullable` is the bridge in, `or_null` the bridge out, and
// every crossing is written where it happens.
//
// In `shared` because a domain object either process holds may carry one.
// Disk and wire still speak `T | null`: `toJSON` makes `JSON.stringify`
// write a Maybe as its plain form, and whoever parses revives it on the way
// in (`sanitize` in `ui.ts`). structuredClone — the IPC channel — grants no
// such courtesy: a Maybe that crosses IPC arrives as a dead plain object, so
// revive it on arrival or leave it untouched, as the renderer does with
// `window`.
//
// Deliberately not used in `world.ts` — the serde mirror spells `| null` out
// byte for byte, so a reader sees what the JSON carries without following an
// alias — nor in `engine/`, which imports nothing from outside itself: that
// is what keeps it testable with no app around it and portable between
// implementations.

/** The value that is there. `value` is only reachable on this half. */
export class Some<T> {
  // Classes compare structurally, and `Some` has every public member `None`
  // has — without a discriminant, narrowing on `this is None<T>` would keep
  // both halves. The literal type is what tells them apart.
  readonly present = true as const

  constructor(readonly value: T) {}

  is_present(): this is Some<T> {
    return true
  }

  is_empty(): this is None<T> {
    return false
  }

  /** The value, or `fallback` when there is none. */
  or<F>(_fallback: F): T | F {
    return this.value
  }

  /** The value, or `null` — the bridge out, into `| null` data shape. */
  or_null(): T | null {
    return this.value
  }

  /** Whether the value is there and is `candidate`. */
  contains(candidate: T): boolean {
    return this.value === candidate
  }

  /** `JSON.stringify` writes the value itself: the wire form is `T | null`. */
  toJSON(): T {
    return this.value
  }
}

/** The value that is not there. */
export class None<T> {
  readonly present = false as const

  is_present(): this is Some<T> {
    return false
  }

  is_empty(): this is None<T> {
    return true
  }

  or<F>(fallback: F): T | F {
    return fallback
  }

  or_null(): T | null {
    return null
  }

  contains(_candidate: T): boolean {
    return false
  }

  /** `JSON.stringify` writes `null`: the wire form is `T | null`. */
  toJSON(): null {
    return null
  }
}

/**
 * A value that may not be there. It marks *control flow* — a slot not filled
 * yet, a lookup with no answer — and not data shape. A field describing what
 * a value IS keeps `| null` written out.
 */
export type Maybe<T> = Some<T> | None<T>

/** A maybe with the value there. */
export function some<T>(value: T): Maybe<T> {
  return new Some(value)
}

/** A maybe with nothing in it. */
export function empty<T>(): Maybe<T> {
  return new None<T>()
}

/** The bridge in, from `| null` data shape. */
export function from_nullable<T>(value: T | null): Maybe<T> {
  return value === null ? new None<T>() : new Some(value)
}
