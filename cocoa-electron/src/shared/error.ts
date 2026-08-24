// Cocoa's own error class, and the one way to throw it.

/**
 * An error cocoa raised on purpose: an invariant of cocoa's own design was
 * broken. The class tells these apart from errors the platform or a
 * dependency threw, and from expected failure paths that carry their own
 * meaning (a parse that may fail, a socket already taken).
 */
export class CocoaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CocoaError'
  }
}

/**
 * Throws a `CocoaError`. Typed `never`, so a call ends its branch and the
 * compiler narrows what follows — usable mid-expression where a `throw`
 * statement is not.
 */
export function throw_cocoa(message: string): never {
  throw new CocoaError(message)
}
