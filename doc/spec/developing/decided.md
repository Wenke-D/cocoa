# What is already decided

## Settled questions (asked and answered — do not re-open without new facts)

- **The renderer keeps IPC; the agent gets its own unix socket** (asked and
  decided 2026-08-19; built 2026-08-20 and the reasoning held). One transport for both was considered: it would have to
  be a TCP port, because Chromium cannot `fetch` a unix socket — which means
  token auth and an Origin check to keep every local process and every web
  page off it, and SSE with its own reconnect/heartbeat instead of
  `webContents.send`. The unification that actually pays is at the operation
  layer, and that already exists: `operations.ts` is what both callers use, so
  a second transport is a thin adapter, not a second implementation. Keeping
  the socket also means the Rust `cocoa_mcp_server` binary connects unchanged,
  and `curl --unix-socket` debugs it just as well.
  What would re-open it: wanting cocoa in a browser, or across machines — the
  network trigger. The IPC layer is thin enough that the swap stays cheap.
  As built, the socket adapter is a set of routes over `operations.ts`,
  driving the same engine as the IPC handlers, which is what keeps the two
  transports from being two implementations.
- **A launch that lost the single-instance lock still needs the `ready` guard
  in `index.ts`** (asked and answered 2026-08-22, by reading Electron 43.4.1
  and Chromium, and by instrumented launches on macOS). cocoa's platforms are
  macOS and Linux (architecture.md §6), and they differ here.
  `app.quit()` before `ready` does not cancel `ready`: `Browser::Shutdown`
  finds no message loop yet and waits — "exiting now would leave defunct
  processes behind" — and once the loop is about to run the exit is *posted*,
  "to make sure we quit after message loop has run for once", because on
  Linux and Windows `ready` is emitted unconditionally in
  `PreMainMessageLoopRun`, before that pass. So on Linux a losing launch gets
  `ready` after its own `quit()`, and the guard is what keeps it from opening
  a window on the way out.
  On macOS `ready` is AppKit's `applicationDidFinishLaunching:`, sent while
  handling the process's launch Apple Event — and a lost lock eats that event:
  Chromium's `ProcessSingleton::WaitForAndForwardOpenURLEvent` pulls the
  first Apple Event off the queue to forward a URL to the running instance,
  finds the launch event instead, and drops it unhandled. Measured: the losing
  instance gets `will-finish-launching` and never `ready`, quit or not
  (`app.isReady()` still false 2 s later); a plain early `quit()` without the
  lock does get `ready`, 26 ms later. The guard is unreachable on macOS and
  necessary on Linux; the `debug` line inside it prints only on Linux.
  What would re-open it: Chromium changing the mac singleton's event
  forwarding, or Electron emitting `ready` from `PreMainMessageLoopRun` on
  macOS as well.
---

## Deliberate divergences (do not "fix")

- Script invocation is async (`invoke.ts`) — the main process must not block;
  the Rust engine blocks its dedicated worker thread instead.
- The single-owner worker thread becomes guarded writes on the event loop
  (§26.2): synchronous work is atomic for free, and every write after an
  `await` checks the world has not moved. It started as a `refreshing` flag,
  passed through a serializing queue, and settled here; the bug that drove it
  is below.
- Memory-is-truth replaces the Rust engine's read-everything-fresh statelessness
  (user decision; the Rust engine keeps disk as truth to protect hand-edits).
- Runs started from this UI are `origin: human` (the v1 socket-client
  prototype could only produce `agent`).
- **Add Folder registers only the folder that was picked** (user decision,
  2026-08-19; **no longer a divergence** — §11.5 was rewritten to say this on
  2026-08-20, and the scan is not wanted). One pick = one experiment; a
  directory of experiments is added one at a time. `coco-egui/` kept its scan
  (`experiment_folders`, `SCAN_DEPTH` in `coco-egui/src/adapter/engine.rs`),
  which is now the older behaviour rather than the specified one. Knock-on: the
  `AddFolderReport` modal existed because one pick could refuse a whole batch;
  with one folder per pick a refusal is a single sentence, so that modal is not
  being ported.
- **The automatic tick reports its failures**, where the Rust adapter's tick
  swallows them (`let _ = self.coco.refresh()` in `coco-egui/src/adapter/engine.rs`) and
  only an explicit Refresh reports. Rust's silence is a flood-control measure —
  a cluster that fails answers on every three-second tick — and it costs more
  than it saves: a poll script that will not run at all is invisible until
  somebody happens to press refresh, and no run row can carry it, because the
  failure is that there is no answer. `src/main/bridge/notices.ts` keeps the quiet and
  the first sentence both: a failure is announced once, repeats say nothing,
  and a pass that works re-arms it.

- **HTML reports render in-app** (user decision, 2026-08-19). This was a
  divergence when it was made — §20 handed HTML to the system browser, because
  "embedding a browser engine is out of the question", which is precisely the
  constraint this form does not have. §20 was rewritten on 2026-08-20 and now
  specifies the in-app viewer, so this is the rule rather than a departure
  from it. `coco-egui/` shelled out, and could not do otherwise.
  The part that stays load-bearing: report HTML is written by experiment
  scripts and is not trusted. It loads in a sandboxed frame without
  `allow-same-origin`, so a report can never reach `window.cocoa`.
