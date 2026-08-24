// The main process's log. Printing, nothing more: every line says when, how
// bad, and which file it came from.
//
// It reaches a terminal: `alors dev` has one, and a drive run echoes the
// process's streams as `[main]`. A packaged app launched from Finder has
// none, and nothing here keeps a file — not needed yet.

import { env_var } from './env'

// `debug` is a developer's breadcrumb, and stays quiet unless asked for.
const DEBUG = env_var('COCOA_DEBUG').or('') === '1'

/**
 * What a module logs with. `error` and `warn` go to stderr, `info` and
 * `debug` to stdout — `debug` only under `COCOA_DEBUG=1`.
 */
export interface Log {
  debug(...parts: unknown[]): void
  info(...parts: unknown[]): void
  trace(...parts: unknown[]): void
  warn(...parts: unknown[]): void
  error(...parts: unknown[]): void
}

/**
 * A file's logger; `scope` is the file's name, so its lines say where they
 * came from. Spelled out rather than derived: the main process is bundled into
 * one file, so at runtime nothing remembers which source a call was in.
 */
export function log_for(scope: string): Log {
  return {
    debug: (...parts) => {
      if (DEBUG) {
        console.debug(prefix('debug', scope), ...parts)
      }
    },
    info: (...parts) => console.log(prefix('info', scope), ...parts),
    trace: (...parts) => console.log(prefix('trace', scope), ...parts),
    warn: (...parts) => console.warn(prefix('warn', scope), ...parts),
    error: (...parts) => console.error(prefix('error', scope), ...parts)
  }
}

/** `12:34:56 [error] refresh:` — local time to the second, level, scope. */
function prefix(level: string, scope: string): string {
  const time = new Date().toTimeString().slice(0, 8)
  return `${time} [${level}] ${scope}:`
}
