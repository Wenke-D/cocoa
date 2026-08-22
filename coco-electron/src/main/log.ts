// The main process's log. Printing, nothing more: every line says when, how
// bad, and which file it came from.
//
// It reaches a terminal: `alors dev` has one, and a drive run echoes the
// process's streams as `[main]`. A packaged app launched from Finder has
// none, and nothing here keeps a file — not needed yet.

/** What a module logs with. `error` and `warn` go to stderr, `info` to stdout. */
export interface Log {
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
