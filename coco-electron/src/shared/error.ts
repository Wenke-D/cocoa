// Coco's own error class, and the one way to throw it.

/**
 * An error coco raised on purpose: an invariant of coco's own design was
 * broken. The class tells these apart from errors the platform or a
 * dependency threw, and from expected failure paths that carry their own
 * meaning (a parse that may fail, a socket already taken).
 */
export class CocoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CocoError'
  }
}

/**
 * Throws a `CocoError`. Typed `never`, so a call ends its branch and the
 * compiler narrows what follows — usable mid-expression where a `throw`
 * statement is not.
 */
export function throw_coco(message: string): never {
  throw new CocoError(message)
}
