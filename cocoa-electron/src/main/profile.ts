// Which profile a launch runs: `--profile <name>` on its command line, or the
// default profile without one. A profile is a cocoa of its own — data
// directory, store, single-instance lock and agent socket — so two profiles
// run side by side, and the same one launched twice still hands over to the
// one running. Experiment folders are not the profile's: two profiles that
// register the same folder both act on it.

import type { Maybe } from '@shared/maybe'
import { empty, some } from '@shared/maybe'

// It becomes part of a directory and a socket file name, and a leading `-`
// would be the next flag, taken for a name.
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/

/**
 * The profile `argv` names, as `--profile <name>` or `--profile=<name>`.
 * Throws when the flag has no name, or one that cannot be a file name.
 */
export function profile_of(argv: readonly string[]): Maybe<string> {
  for (const [index, arg] of argv.entries()) {
    const name = arg === '--profile' ? (argv[index + 1] ?? '') : arg.match(/^--profile=(.*)$/)?.[1]
    if (name === undefined) {
      continue
    }
    if (!NAME.test(name)) {
      throw new Error(`--profile needs a name of letters, digits, - and _, got '${name}'`)
    }
    return some(name)
  }
  return empty()
}

/** What `name` is called in `profile`: itself in the default, `<name>-<profile>` in any other. */
export function in_profile(name: string, profile: Maybe<string>): string {
  return profile.is_present() ? `${name}-${profile.value}` : name
}
