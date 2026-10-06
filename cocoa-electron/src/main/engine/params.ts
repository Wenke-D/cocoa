// What a start must supply (convention §2.1): every declared parameter, no
// other, each a value of its declared shape. One check for every way in — the
// form, the row menu, a campaign's plan, an agent — so a refusal reads the same
// wherever it came from, and names every fault at once.

import type { ParamSpec, Params } from '@shared/params'
import { check_value } from '@shared/params'
import { EngineError } from './errors'

export function describe_names(names: string[]): string {
  if (names.length === 0) {
    return 'none'
  }
  return names.map((name) => `\`${name}\``).join(', ')
}

/**
 * The problems with `provided` against `declared`, or none: names missing,
 * names not declared, values of the wrong shape. All of them, not the first.
 */
export function param_problems(declared: ParamSpec[], provided: Record<string, unknown>): string[] {
  const problems: string[] = []
  const declared_names = new Set(declared.map((spec) => spec.name))
  const missing = declared
    .map((spec) => spec.name)
    .filter((name) => !(name in provided))
    .sort()
  const extra = Object.keys(provided)
    .filter((name) => !declared_names.has(name))
    .sort()
  if (missing.length > 0) {
    problems.push(`missing ${describe_names(missing)}`)
  }
  if (extra.length > 0) {
    problems.push(`extra ${describe_names(extra)}`)
  }
  for (const spec of declared) {
    if (!(spec.name in provided)) {
      continue
    }
    const problem = check_value(spec, provided[spec.name])
    if (problem !== null) {
      problems.push(`\`${spec.name}\` ${problem}`)
    }
  }
  return problems
}

/** Refuses `provided` unless it is exactly `declared`, each value well-shaped; returns it typed. */
export function validate_params(
  declared: ParamSpec[],
  provided: Record<string, unknown>,
  set: string
): Params {
  const problems = param_problems(declared, provided)
  if (problems.length > 0) {
    throw EngineError.validation(
      `${set} parameters must match the manifest exactly and each one needs a value; ` +
        problems.join('; ')
    )
  }
  return provided as Params
}
