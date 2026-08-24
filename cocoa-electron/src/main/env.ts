// Reading the environment. One rule, applied in one place: a variable set to
// the empty string is as good as absent.

import type { Maybe } from '@shared/maybe'
import { empty, some } from '@shared/maybe'

/** The variable's value, with "set but empty" counting as not there. */
export function env_var(name: string): Maybe<string> {
  const value = process.env[name]
  if (value === undefined || value === '') {
    return empty()
  }
  return some(value)
}
