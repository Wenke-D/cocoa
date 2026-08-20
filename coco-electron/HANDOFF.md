# coco-electron — Handoff

_Last updated: 2026-08-20._

The classic Electron shape of coco: the renderer is a web client (Svelte 5 +
TypeScript), the main process is the server holding the whole core logic — a
TypeScript port of the Rust engine in `src/main/engine/`. The Rust/egui coco
in the repository root is untouched and remains the reference implementation;
both engines speak the same on-disk convention (`coco.toml`, `runs/*/run.json`,
`report/`, `store.json`), so experiment folders are interchangeable.

## Current state (all verified against `mock/`)

- **Engine (TS port of `src/engine/`)**: manifests (TOML, full validation),
  template analyze/render (nunjucks, exact-match both directions, imports
  rejected), lexical command split, job lifecycle (start = spawned not
  awaited → harvest fills submission id), poll protocol incl. UNREACHABLE,
  auto/manual report with ERROR healing, cancel (engine level), bench
  plan → fan-out → derived status → members.json → bench report, orphan
  detection, shutdown grace. Records byte-compatible with the Rust engine.
- **Memory is the truth** (user decision, 2026-08-19): the engine holds all
  domain state in memory; reads never touch disk; writes go memory-first then
  write through to the folders; a reconcile pass on each 3s tick pulls
  hand-edited files back in by mtime. Lost updates from concurrent hand-edits
  are accepted (local, single instance). `store.json` persists only folders,
  `last_args`, and the run-id counter.
- **UI sync is event-driven** (user decision, same day): renderer calls
  `coco:bootstrap` once (the one full-state message), then receives
  `coco:events` batches — `entity/job-run/bench-run` `upserted|removed`
  (upserts carry the full entry; entry-level over-push, never field diffs)
  plus a content-free `refreshed` heartbeat. The backend alone judges change
  (`diffWorlds` in `src/main/sync.ts`, excluding the churning
  `last_successful_query` from entry identity). One batch per logical
  operation; a start's events are sent before its invoke answer resolves.
- **The agent interface is back** (2026-08-20): HTTP/1.1 over a unix socket in
  the main process (`src/main/agent.ts`), same paths and shapes as the Rust
  `src/agent/`, so the bundled `coco-mcp-server` binary drives coco-electron
  unchanged. Reads answer from the sync layer's `model`; a start goes through
  the same `operations.ts` and the same `onEngine` queue a click does, stamped
  `agent`.
- **The arrangement survives a relaunch** (2026-08-20): route, sidebar width,
  report wrap and the window's geometry live in `ui-state.json` next to the
  store (`COCO_UI_STATE_PATH` overrides), with `sanitize()` in `@shared/ui`
  porting `UiState::sanitize` — a report is never restored, a Start page comes
  back as its experiment.
- **A dispatched run has two addresses** (2026-08-20): the `benchChild` route
  (§19) shows the same record as `jobRun` — the facts come from one component,
  `RunFacts.svelte`, so they cannot drift — with the bench's breadcrumbs, the
  call index, and the Explorer still on the bench. Reports opened from there
  keep that trail while reading the file out of the *job's* folder.
- **It packages** (2026-08-20): `npm run package` (electron-builder, unsigned)
  builds `coco.app`; there is an application menu with Add Experiment Folder
  (Cmd+O) and Refresh Now (Cmd+R), both routed through the window so a menu
  pick and a click are one operation.
- **Notices are the backend's judgement too** (2026-08-20): a refresh that
  fails sends a `notice` event; the gate in `src/main/notices.ts` announces a
  failure once and then holds still while it repeats, and a refresh the user
  asked for always answers (`Refreshed.` included). Errors stay on screen
  until dismissed; anything else fades after four seconds.
- **Tested**: 190 vitest cases over the engine, the world builder, the sync
  layer, the agent routes and socket, the persisted arrangement and the
  renderer's state, run against real temp folders and real executable scripts
  (`npm test`). The end-to-end scenarios are ports of the Rust suite's, so
  both engines answer the same questions — see Tests below.
- **UI**: explorer (flat lists, jobs/benches), entity overview with history
  table, start page (draft preserved on refusal, fill-from-last-run), job run
  detail, bench run detail with dispatched-calls table, cancel with its
  confirmation modal (§16), report viewer (§20 — plain text and HTML, both
  in-app, with search, wrap toggle and copy), Add Folder through the native
  picker (§11.5, one pick = one folder), Remove from Explorer via the row's
  right-click menu (§36), bench child-run detail with breadcrumbs (§19),
  status bar (connection, active count, refreshed-ago, Refresh now), notices
  for anything that failed (§8.5's transient message), route recovery, fade
  transitions, pulsing active dots, VS Code Light/Dark Modern palette
  following the system theme.

## How to run

```bash
cd coco-electron
env -u ELECTRON_RUN_AS_NODE npm run dev     # VSCode terminals leak ELECTRON_RUN_AS_NODE; it breaks Electron
npm run check                               # svelte-check + tsc (includes tests/)
npm test                                    # vitest, ~9 s
npm run test:watch                          # vitest in watch mode

npm run build && npm run drive scripts/scenarios/cancel.mjs   # drive the real app
npm run package                             # electron-builder → release/ (unsigned)
npm run package:dir                         # unpacked .app only, for driving
DRIVE_PACKAGED=1 npm run drive scripts/scenarios/agent.mjs    # drive the packaged app
```

Scenarios that exist today: `cancel.mjs`, `cancel-bench.mjs`, `report.mjs`,
`add-folder.mjs`, `remove-folder.mjs`, `notice.mjs`, `persistence.mjs`,
`bench-child.mjs`, `agent.mjs`, `agent-busy.mjs`, `menu.mjs`. A scenario may also call
`relaunch()` — quit and start again against the same store and ui-state file,
the only way to drive what is supposed to survive a launch — and
`DRIVE_PACKAGED=1` runs any of them against the packaged `.app` instead of the
dev binary. A scenario may `export const seed = 'library-only'` to launch
against a store with nothing registered — the engine reads `store.json` exactly
once, at construction, so an empty store is a launch-time decision, not
something a scenario can arrange afterwards.

`npm run drive` launches the **built** app under Playwright, against a scratch
copy of `mock/` in `.drive/` with a store of its own — never the real store, so
it cannot race the Rust coco's run-id counter. Screenshots land in
`.drive/shots/`; renderer console errors are reported at the end, including
when the scenario fails. Scenarios live in `scripts/scenarios/` and are plain
modules exporting `run({ page, app, shot, log, waitText })`. Rebuild before
driving — it runs `out/`, not the dev server.

**Do not run the Rust coco and coco-electron at the same time** — they share
`~/.local/share/coco/store.json` (override: `COCO_STORE_PATH`) and would race
the run-id counter.

## Feature gaps vs the Rust/egui coco

### Operations wired in the engine but missing UI/IPC

| Feature | Rust reference | TS engine | Missing piece |
|---|---|---|---|
| Manual report re-run (heals report-failed ERROR) | §11 | `reportRun(folder, id, 'manual')` done | IPC + button on run detail |
| Retry query | `RetryQuery` command, status-bar interruption banner | poll happens every tick anyway; the status bar's Refresh now forces one and reports how it went | the interruption banner (world has `query_health`), and aiming a retry at one run rather than refreshing everything |

### Missing entirely

| Feature | Rust reference | Notes |
|---|---|---|
| **Open report externally** | `OpenReportExternally` | Both formats now render in-app (see Deliberate divergences), so this is a convenience rather than the only way to read HTML: a `shell.openPath` on the report file, offered as a secondary action in the viewer's header (§20.1). |
| **Report viewer virtualisation** | rows laid out only when visible (§35) | The viewer renders every line. Fine for the reports seen so far; a report of tens of thousands of lines wants windowing. Wrapping is off by default precisely so rows stay uniform height, which is what makes windowing possible later. |
| **Explorer/run filtering** | `status_filter` (persisted), `run_search`, sidebar search | None. The arrangement file has a place to keep the filter when it exists. |
| **Theme setting** | in-app Light/Dark toggle (Settings overlay), persisted | Electron follows the system only; `theme.css` already has both palettes. |
| **Overlays** | `ConfirmCancel`, `AddFolderReport`, `Settings` | `ConfirmCancel` is ported, and `confirmRemove` joins it on the same `ModalFrame`; `AddFolderReport` and `Settings` are not. As in coco, overlay state is deliberately outside `Route` (§9) and never persisted. |
| **`--dump-state`** | prints the exact world as JSON | trivial: a `node` entry point or `npm run dump` calling `buildWorld`. |
| **Activity bar / view headers** | shell chrome (§8) | Electron shell is minimal: sidebar + page + status bar. Breadcrumbs exist per page (`Breadcrumbs.svelte`), not as a shell-level bar. |
| **Shortcuts beyond the menu** | n/a (egui) | Cmd+O and Cmd+R come from the app menu; there is no in-page keyboard surface (report search, sidebar focus, run filtering). |
| **Signed / notarised packaging** | n/a | `npm run package` builds an unsigned `coco.app` (`identity: null`) plus dmg/zip; Gatekeeper will object. mac targets are exercised, linux/win are configured but unbuilt. |
| **Renderer tests** | `Backend::Local` sync test seam drives the UI in-process | The engine, world builder and sync layer are covered (see Tests); nothing exercises the Svelte components or the IPC handlers in `index.ts`. Needs a component runner (vitest browser mode or @testing-library/svelte) and an `index.ts` refactor that lets the handlers be called without `app.whenReady()`. |

### Settled questions (asked and answered — do not re-open without new facts)

- **The renderer keeps IPC; the agent gets its own unix socket** (asked and
  decided 2026-08-19; built 2026-08-20 and the reasoning held). One transport for both was considered: it would have to
  be a TCP port, because Chromium cannot `fetch` a unix socket — which means
  token auth and an Origin check to keep every local process and every web
  page off it, and SSE with its own reconnect/heartbeat instead of
  `webContents.send`. The unification that actually pays is at the operation
  layer, and that already exists: `operations.ts` is what both callers use, so
  a second transport is a thin adapter, not a second implementation. Keeping
  the socket also means the Rust `coco_mcp_server` binary connects unchanged,
  and `curl --unix-socket` debugs it just as well.
  What would re-open it: wanting coco in a browser, or across machines — the
  network trigger. The IPC layer is thin enough that the swap stays cheap.
  As built, the socket adapter is ~430 lines of routes over `operations.ts`
  and shares the engine queue with the IPC handlers, which is what keeps the
  two transports from being two implementations.

### Deliberate divergences (do not "fix")

- Script invocation is async (`invoke.ts`) — the main process must not block;
  the Rust engine blocks its dedicated worker thread instead.
- One `refreshing` mutex flag replaces the single-owner worker thread.
- Memory-is-truth replaces the Rust engine's read-everything-fresh statelessness
  (user decision; the Rust engine keeps disk as truth to protect hand-edits).
- Runs started from this UI are `origin: human` (the v1 socket-client
  prototype could only produce `agent`).
- **Add Folder registers only the folder that was picked** (user decision,
  2026-08-19), where §11.5 also searches three levels beneath it. One pick =
  one experiment; a directory of experiments is added one at a time. The Rust
  implementation keeps its scan (`experiment_folders`, `SCAN_DEPTH` in
  `src/adapter/engine.rs`) and the specification is unchanged — this is the
  Electron side diverging deliberately, not a spec revision. Knock-on: the
  `AddFolderReport` modal exists because one pick could refuse a whole batch
  (§11.5); with one folder per pick, a refusal is a single line and the status
  bar can carry it, so that modal is probably not worth porting.
- **The automatic tick reports its failures**, where the Rust adapter's tick
  swallows them (`let _ = self.coco.refresh()` in `src/adapter/engine.rs`) and
  only an explicit Refresh reports. Rust's silence is a flood-control measure —
  a cluster that fails answers on every three-second tick — and it costs more
  than it saves: a poll script that will not run at all is invisible until
  somebody happens to press refresh, and no run row can carry it, because the
  failure is that there is no answer. `src/main/notices.ts` keeps the quiet and
  the first sentence both: a failure is announced once, repeats say nothing,
  and a pass that works re-arms it.

- **HTML reports render in-app** (user decision, 2026-08-19), where §20 hands
  them to the system browser. That rule's stated reason is "embedding a
  browser engine is out of the question — Tauri, Electron and WebView are
  non-goals (§4.3)", which is exactly the constraint this form does not have.
  The intent behind it — render a report faithfully or not at all, never a
  half-styled approximation — is *better* served here, so §20.5's
  `Open in Browser` becomes a secondary action, not the only one.
  When implementing: report HTML is written by experiment scripts and is not
  trusted. Load it in a sandboxed frame with no preload and no node
  integration, so a report can never reach `window.coco`.

## Tests

`npm test` — vitest, 190 cases, ~10 s, no mocks of the filesystem or of
`child_process`: every scenario writes real folders and real executable
scripts into a temp directory and lets the engine spawn them.

| File | Covers |
|---|---|
| `tests/engine.test.ts` | All 20 end-to-end scenarios of `tests/coco_engine.rs`, plus registration idempotence + unregister and two reconcile cases the Rust engine has no equivalent of (a hand-edited record, a deleted run folder). The corrupt-`run.json` scenario becomes a reconcile test here: disk is not this engine's truth, so the damage lands at the next tick rather than the next read. |
| `tests/mock-library.test.ts` | The bundled `mock/` library end to end — port of `tests/coco_mock_library.rs`, but over a **copy** in a temp dir, so a test run leaves no `runs/`/`report/` in the repo. |
| `tests/world.test.ts` | `buildWorld`: entity shape, run shape, report state, UNREACHABLE display (last known status + unavailable query health), bench plan steps, bench-origin members, history ordering. |
| `tests/agent.test.ts` | The agent interface (§43): every route as a function of a world and a start, then the same routes over a **real unix socket** with a real HTTP client — a start crossing the wire, an oversize body refused, a socket a live coco is answering on left alone, a stale one replaced, the file removed on stop, and every reply framed with a `Content-Length` (see below). |
| `tests/uiState.test.ts` | What a relaunch restores: `sanitize` (a report never comes back, a Start page becomes its experiment, widths clamped, unknown routes dropped, a window position taken only as a pair) and the file round trip, including one that does not parse. |
| `tests/notices.test.ts` | `refreshSummary` (one error in full, the rest as a count) and the `NoticeGate`: a repeating failure announced once, a changed one announced again, a clean pass re-arming it, and a manual refresh that always answers and counts as said. |
| `tests/sync.test.ts` | `diffWorlds`: silence when nothing moved, the `last_successful_query` exclusion, upserts/removals for all three entry kinds, one batch for a member and its bench. |
| `tests/operations.test.ts` | What the renderer can ask for (`src/main/operations.ts`): start by name with the manifest's parameter split, cancel a run, cancel a bench, read a report (including the plain-text-wins rule the world builder also follows, an unregistered folder, and a run id that is not one), add a folder (including that a folder of experiments is *not* searched), remove one (and that the disk is untouched) — each answered, never thrown. |
| `tests/serial.test.ts` | The engine's one-turn-at-a-time queue, and the race it exists for (below). |
| `tests/state.svelte.test.ts` | The renderer's state, compiled as runes: event application, the run index, every `recover()` rule, the notice (an error waits to be dismissed, anything else fades, an older timer never clears a newer message), and the two-addresses rules for a dispatched run (§19) — the bench stays selected, the fallbacks step back through the bench run, and a report reads from the job's folder. It covers what the state *holds*, not what it *notifies* — see the note at the top of the file. |
| `tests/manifest.test.ts` `tests/template.test.ts` `tests/words.test.ts` `tests/status.test.ts` `tests/store.test.ts` `tests/invoke.test.ts` | Ports of the corresponding Rust inline `#[cfg(test)]` modules, plus a few cases for the async spawn/harvest seam this port introduces. |

The fixture experiment folders are **real folders in the repository**:
`mock/.fixtures/job` and `mock/.fixtures/bench` (see their README). Tests copy
one per scenario and rename it in the copy, so one folder serves twenty-odd
cases. The `job` fixture answers from a `poll-state`/`report-state` file and
the `bench` fixture plans from a `plan-lines` file, so most tests change
behaviour by writing data, not by rewriting a script; a test whose *subject*
is a broken script still overwrites that one script in its copy. The directory
is hidden because the Add Folder scan skips dot-names — picking `mock/` still
registers exactly the four demonstration experiments.

`tests/support.ts` holds the helpers (`jobFolder`, `benchFolder`, `planLines`,
`settle`, `handEdit`). Two things it is careful about, both of which bite
otherwise: temp dirs are `realpath`-ed (on macOS `/var` is a symlink and the
engine keys state by the canonical path), and `handEdit` pushes the file's
mtime forward so a simulated hand-edit is distinguishable from the engine's
own write in the same millisecond.

### What testing found (three engine fixes)

- **`invoke.ts` could hang forever.** The invocation was answered on Node's
  `close`, which waits for the stdio pipes rather than the process. A killed
  `#!/bin/sh` script whose own child outlives it — or any launch script that
  backgrounds something — keeps that pipe open, so a timed-out script never
  returned and the refresh tick would never run again. Now it answers on
  `exit` plus a 100 ms drain window, and `close` short-circuits it when it
  comes. Reproduced 2 runs in 3 before the fix.
- **`template.ts` accepted `{{ loop.index }}` outside a loop.** `loop` had
  been put in the builtins list; it is not a global, it is bound by the `for`
  body (which the walker already does). The list is now nunjucks' actual
  globals — `range`, `cycler`, `joiner` — so a template that would fail at
  render is refused at analysis, which is the whole point of analysis.
- **`template.ts` counted `is`-test names as variables.** `{{ size is
  defined }}` demanded a param called `defined`. The walker now handles `Is`
  nodes: the left side is data, the test name is language, and the test's
  arguments are data again.

One further tightening, not a bug: `buildWorld` now indexes runs oldest-first,
so two runs that tie on `started_at` (possible at the port's millisecond
precision, unlike chrono's nanoseconds) stay in run-id order.

### What driving the app found (two more)

Neither of these could have been found by a green test suite; both came from
`npm run drive` on the built app.

- **A cancel could be silently undone by a poll already in flight.** The
  refresh tick's `poll` script takes tens of milliseconds (the mock's is
  `python3`). A cancel asked meanwhile finished first and set `CANCELLING`;
  the poll's answer — formed before the cancellation existed — then landed on
  top, and the run read `RUNNING` again with the user's cancel visibly
  undone. The Rust engine cannot hit this because it owns its state on one
  thread (§43.3); the `refreshing` flag here only stopped two *refreshes*
  overlapping. Fixed by `src/main/serial.ts`: every engine operation —
  refresh, start, cancel — takes its turn. `tests/serial.test.ts` reproduces
  the stomp and holds the fix.
- **A `$state` proxy cannot cross IPC.** `window.coco.cancel(overlay.target)`
  passed a Svelte proxy to `ipcRenderer.invoke`, structured clone refused it,
  and the rejected promise left the modal on "Cancelling…" for ever with no
  error anywhere. Now `$state.snapshot` (the pattern `StartRun.svelte`
  already used) plus a `try`/`catch`, because nothing may wedge a modal.

One behaviour worth knowing rather than fixing: a run in `STARTING` whose
launch script has not been harvested yet has no submission id, so cancelling
it is refused with *"run 0 is still launching; there is no submission to
cancel yet"* until the next tick (≤3 s). The button is offered because the
world carries no submission id — exactly as in the Rust UI, whose snapshot
does not carry one either. The refusal is shown in the modal, which stays
open.

### What driving the app found, part two

- **An entity's first run never lit its Explorer dot.** The renderer created
  the run index with `index[id] ?? (index[id] = [])`, which hands back the
  raw array the assignment evaluated to rather than the `$state` proxy that
  now stands in its place; every later `splice` wrote through the back of the
  store and notified nobody. The data was right the whole time, which is
  exactly why it survived: value assertions cannot see it. Read the list back
  after creating it.
- **`recover()` was closing overlays out from under their own operations.**
  The rule "an overlay about something the world no longer contains closes"
  is right for an accident and wrong for a removal the user just asked for:
  the entity disappears, the overlay is closed, and the answer — including
  the confirmation — is thrown away. An overlay with `busy` set is now left
  alone; it answers for itself.
- **A removal used to explain itself as an accident.** Removing an experiment
  while its page was open let `recover()` speak first, so the user's own
  action was announced as "that run is no longer listed". `confirmRemove`
  now leaves the page before asking, and puts the route back if the removal
  is refused.
- **The driver could not end.** On macOS closing the last window does not
  quit the app (the platform convention, which `index.ts` follows), so
  Playwright's `app.close()` waited for an exit that never came — a run took
  over ten minutes and had to be killed. It now asks nicely, waits three
  seconds, and insists.

### What driving the app found, part three

- **The agent socket was answering in chunks.** Node uses
  `Transfer-Encoding: chunked` when no `Content-Length` is set, and the bundled
  `coco-mcp-server` reads a reply as "everything after the blank line" — the
  minimal HTTP a client on a private socket is entitled to. Its `coco_start`
  came back as `e\r\n{"run_id":"1"}\r\n0\r\n\r\n`: the run id was in there,
  which is exactly why a `contains` assertion would have passed. Fixed by
  framing every reply with a `Content-Length`; the test now parses the body
  rather than searching it.
- **The sidebar drag stopped halfway.** The handle relied on pointer capture,
  and the handle moves *with* the sidebar it is resizing — so the moment the
  width lagged the pointer or capture was dropped, the pointer was over the
  page instead and the drag ended at whatever width the last event it saw
  happened to name. It now listens on the window for the duration of the drag.
  Two drives in a row disagreed about the final width, which is what gave it
  away.
- **The arrangement lagged the window by two debounces.** The renderer
  coalesces a drag's hundred widths, and the main process was coalescing the
  result again. The renderer's message is already final, so it is written
  straight through; only the window's own resize/move stream is debounced.
- **A startup failure had nobody to tell.** The agent interface binds while
  the page is still loading, and a `notice` is not part of the bootstrap — so
  a refused socket was announced to a window that could not yet hear it, and
  the message vanished. Notices raised before the first bootstrap are now held
  and delivered just after it (`scripts/scenarios/agent-busy.mjs`, which binds
  the socket itself before the app launches).
- **A window nobody moves has no geometry to remember.** Geometry was read on
  `resize`/`move` only, so it was never recorded for exactly the people who
  leave the window where it opens. Every write reads it now, whatever prompted
  the write.

### Known inconsistency, shared with the Rust reference

A dispatched run's page shows `Call 1` and `Started by nightly-benchmark ·
call 2` for the same run. They come from two places: `plan.steps[].index` is
the plan's 0-based position, and the run record's `origin.call` is stamped
`index + 1` by the engine (`coco.ts`, and the Rust engine identically). The
Rust UI displays both the same way, so this port is faithful rather than
newly wrong — but a reader seeing both at once has no way to know that. Fixing
it means picking one convention for display in **both** implementations; it is
not a coco-electron change.

## Tech debt / pinned versions

- `vite@^7` (electron-vite 5 rejects vite 8), `typescript@~6` (svelte-check
  rejects TS 7). Revisit when electron-vite/svelte-check catch up.
- `template.ts` reaches into `nunjucks/src/parser` and `nunjucks/src/nodes`
  (undocumented-but-stable internals, loaded via `createRequire`). A nunjucks
  major bump needs a look at the AST walker.
- `fs.watch` deliberately deferred: it would only cut human-edit latency
  below 3s. If added, watch-as-trigger only (debounce → run the existing
  reconcile); never interpret watcher events as truth; keep the 3s sweep.
- Engine timeouts are `DEFAULT_CONFIG` constants; no settings surface.
- `electron-builder` produces an **unsigned** app (`identity: null`): a
  signature needs a certificate this prototype has no business carrying, and a
  half-configured one fails the build rather than warning. macOS will ask
  before opening it. Only the mac targets have been built; linux/win are
  configured and untried.
- The agent socket serves whoever can open the file. That is the Unix-socket
  model and the same one the Rust coco has: file permissions are the access
  control, and every caller is already on this machine (§43).
- The dev CDP scripts once used for manual verification were lost with their
  session scratchpad. `scripts/drive.mjs` replaces them and lives in the repo
  this time. It is a verification tool, not a test suite: scenarios are
  written to be watched (and to leave screenshots), and they are not run by
  `npm test` — an Electron launch per scenario is too slow and too
  environment-dependent for that.

## Suggested order of work

1. ~~Tests for the engine~~ — done; see Tests. Keep adding to them: a new
   engine behaviour without a case there is a regression waiting.
2. ~~Cancel + confirm dialog~~ — done, and verified in the running app for
   both a job run and a bench run.
3. ~~Reports~~ — done: plain text and HTML both render in-app, with search,
   wrap and copy. Verified in the running app, sandbox included.
4. ~~Add-folder flow~~ — done: native picker, one pick registers one folder,
   verified in the running app with the picker stubbed in the main process.
5. ~~UI-state persistence + sanitize~~ — done: route, sidebar width, report
   wrap and window geometry in `ui-state.json`, `sanitize()` ported to
   `@shared/ui`. Verified across two real relaunches
   (`scripts/scenarios/persistence.mjs`).
6. ~~Notices for refresh errors~~ — done: a `notice` event, the announce-once
   gate in `src/main/notices.ts`, the levelled toast, and Refresh now in the
   status bar. Verified in the running app with a deliberately broken poll
   script (`npm run drive scripts/scenarios/notice.mjs`), which also holds the
   no-repeat rule: it dismisses the error, waits two ticks with the script
   still broken, and fails if it comes back.
7. ~~Agent socket in main process~~ — done: `src/main/agent.ts`, same routes
   and socket path as the Rust `src/agent/`. Verified by driving the real
   `target/debug/coco-mcp-server` against the running app — including the
   packaged one (`scripts/scenarios/agent.mjs`).
8. ~~Bench child-run context route + breadcrumbs~~ — done: the `benchChild`
   route, `RunFacts.svelte` shared with `jobRun` so the facts cannot drift, and
   `Breadcrumbs.svelte` used by every page that is inside something
   (`scripts/scenarios/bench-child.mjs`).
9. ~~Packaging, menu, shortcuts~~ — done: `electron-builder.yml`,
   `build/icon.png`, `npm run package`, and an application menu whose items go
   through the window (`scripts/scenarios/menu.mjs`). Unsigned.

### What is left

- Manual report re-run (IPC + a button); the query-interruption banner and a
  per-run retry.
- Open a report externally; report-viewer virtualisation.
- Explorer/run filtering and search; the in-app theme toggle; Settings.
- `--dump-state`; activity bar / view headers.
- Renderer component tests (see the gap table) — still the biggest hole: the
  Svelte components and the IPC handlers in `index.ts` are covered only by the
  drive scenarios.
