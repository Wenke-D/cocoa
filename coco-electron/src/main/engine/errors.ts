// Port of engine/error.rs. One class, a kind tag, and a message built to read
// exactly as the Rust Display impl words it, so the UI's sentences match.

export type EngineErrorKind =
  | 'io'
  | 'store'
  | 'manifest'
  | 'template'
  | 'invocation'
  | 'validation'
  | 'not-found'
  | 'already-registered'
  | 'name-collision'
  | 'invalid-plan'

export class EngineError extends Error {
  readonly kind: EngineErrorKind
  /** Set for invalid-plan: one line per bad call. */
  readonly problems: string[]

  private constructor(kind: EngineErrorKind, message: string, problems: string[] = []) {
    super(message)
    this.kind = kind
    this.problems = problems
  }

  static io(path: string, cause: unknown): EngineError {
    return new EngineError('io', `${path}: ${describe_cause(cause)}`)
  }

  static store(path: string, message: string): EngineError {
    return new EngineError('store', `${path}: ${message}`)
  }

  static manifest(path: string, message: string): EngineError {
    return new EngineError('manifest', `${path}: ${message}`)
  }

  static template(path: string, message: string): EngineError {
    return new EngineError('template', `${path}: ${message}`)
  }

  static invocation(
    script: string,
    exit: number | null,
    timed_out: boolean,
    output: string
  ): EngineError {
    const cause = timed_out ? 'timed out' : exit !== null ? `exited ${exit}` : 'was killed'
    const trimmed = output.trimEnd()
    const message = trimmed === '' ? `\`${script}\` ${cause}` : `\`${script}\` ${cause}: ${trimmed}`
    return new EngineError('invocation', message)
  }

  static validation(message: string): EngineError {
    return new EngineError('validation', message)
  }

  static not_found(what: string): EngineError {
    return new EngineError('not-found', `not found: ${what}`)
  }

  static already_registered(path: string): EngineError {
    return new EngineError('already-registered', `already registered: ${path}`)
  }

  static name_collision(name: string): EngineError {
    return new EngineError('name-collision', `an entity named \`${name}\` is already registered`)
  }

  static invalid_plan(calls: number, problems: string[]): EngineError {
    const noun = calls === 1 ? 'call' : 'calls'
    const listing = problems.map((problem) => `  ${problem}`).join('\n')
    return new EngineError(
      'invalid-plan',
      `${problems.length} of ${calls} plan ${noun} cannot be dispatched:\n\n${listing}`,
      problems
    )
  }
}

function describe_cause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return String(cause)
}

/** Coerces an unknown thrown value into an EngineError, as an io failure. */
export function as_engine_error(path: string, cause: unknown): EngineError {
  if (cause instanceof EngineError) {
    return cause
  }
  return EngineError.io(path, cause)
}
