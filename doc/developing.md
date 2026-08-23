# Developing coco

This is the working record: how to run the trees, what is covered, what is
known to be missing, and which questions are already settled. It is the merge
of what used to be `coco-electron/HANDOFF.md` and the process half of the
old `SPECIFICATION.md`.

Read it before changing anything here. Several of the entries below are the
scar tissue from bugs that a green test suite could not see.

Covered here: §28 (development controls), §29 (demonstration fixtures),
§37–§38 (testing), §40 (current state), §42/§44/§45 (deliverables, done, and
how to work on this).

> §39 used to specify what the README must contain. The README exists now, so
> the section is retired rather than renumbered — nothing cites it.

---

## The two trees

| | |
|---|---|
| `coco-electron/` | the workbench. The only implementation under development. |
| `coco-mcp/` | the MCP server. Its own crate, in continued use; `serde_json` its only dependency. |

Beside them: `mock/` is the demonstration library, `doc/` is this
documentation.

---

## Running it

```bash
cd coco-electron
env -u ELECTRON_RUN_AS_NODE npm run dev     # VSCode terminals leak ELECTRON_RUN_AS_NODE; it breaks Electron

npm run gate                                # format:check → lint → check → test
npm run format                              # prettier --write .
npm run lint                                # eslint, type-aware
npm run check                               # svelte-check + tsc (includes tests/)
npm test                                    # vitest, ~10 s
npm run test:watch                          # vitest in watch mode

npm run build && npm run drive scripts/scenarios/cancel.mjs   # drive the real app
DRIVE_HEADLESS=1 npm run drive scripts/scenarios/cancel.mjs   # ... without a window on screen
npm run package                             # electron-builder → release/ (unsigned)
npm run package:dir                         # unpacked .app only, for driving
DRIVE_PACKAGED=1 npm run drive scripts/scenarios/agent.mjs    # drive the packaged app
```

`npm run gate` is the one command that has to pass. It runs cheapest-failure
first.

The other tree:

```bash
cd coco-mcp  && cargo build && cargo test   # the MCP server; serde_json only
```

### Or through alors

`tasks.alors` in the repository root wraps all of the above, so two trees with
two build systems answer to one verb. It reads only the current directory's task
file, so run it **from the root**:

```bash
alors                       # list the tasks
alors dev                   # the workbench, with ELECTRON_RUN_AS_NODE unset for you
alors gate                  # the workbench's gate
alors gate all              # both trees
alors drive cancel          # build, then drive a scenario
alors mcp                   # build, lint and test the MCP server
```

One task per invocation; tokens after it are arguments or a subcommand. It is a
convenience over the commands above, never a second definition of them — the
`gate` task shells out to `npm run gate` rather than restating its sequence.

---

## Driving the built app

`npm run drive` launches the **built** app under Playwright, against a scratch
copy of `mock/` in `.drive/` with a store of its own — never the real store, so
it cannot disturb the real Explorer. Screenshots land in
`.drive/shots/`; renderer console errors are reported at the end, including
when the scenario fails. Scenarios live in `scripts/scenarios/` and are plain
modules exporting `run({ page, app, shot, log, waitText })`. Rebuild before
driving — it runs `out/`, not the dev server.

Scenarios that exist today: `cancel.mjs`, `cancel-bench.mjs`, `report.mjs`,
`add-folder.mjs`, `remove-folder.mjs`, `notice.mjs`, `persistence.mjs`,
`bench-child.mjs`, `agent.mjs`, `events.mjs`, `history.mjs`. A scenario may
also call `relaunch()` — quit and start again against the same store and
ui-state file, the only way to drive what is supposed to survive a launch —
and `DRIVE_PACKAGED=1` runs any of them against the packaged `.app` instead of
the dev binary. A scenario may `export const seed = 'library-only'` to launch
against a store with nothing registered — the engine reads `store.json` exactly
once, at construction, so an empty store is a launch-time decision, not
something a scenario can arrange afterwards.

`DRIVE_HEADLESS=1` opens the window without showing it (`COCO_HIDE_WINDOW` on
the app side). Playwright drives the page over CDP and screenshots it the same
way, so nothing is lost but the view — and sweeping every scenario stops taking
the focus eleven times in a row, which made the machine unusable while it ran.
Off by default, because watching it is the point.

This is a verification tool, not a test suite. Scenarios are written to be
watched and to leave screenshots, and they are not run by `npm test` — an
Electron launch per scenario is too slow and too environment-dependent.

---

## 28. Development Controls

There are no mock controls, because there is no mock: state advances because a
real script said so. What replaces them is a way to drive the real application.

`npm run drive scripts/scenarios/<name>.mjs` launches the **built** app under
Playwright over Electron's own binary and runs a scenario against it — the
"click it and look" path, not headless CI. A scenario is a module exporting
`run({ page, app, shot, log, waitText })`.

A drive run is fully isolated from the real one, and must stay that way:

```text
COCO_STORE_PATH      a scratch store    — a drive run registers folders; not in the real one
COCO_UI_STATE_PATH   a scratch layout   — a drive run must not move the user's window
COCO_SOCKET_PATH     a scratch socket   — must not take the socket a real coco answers on
```

The library is seeded as a private copy of `mock/`, never the user's own.

Scenarios cover: add-folder, remove-folder, cancel, cancel-bench, bench-child,
report, notice, persistence, agent.

Everything else is a test (§37). Do not add developer affordances to the
production UI, and do not put them inside run-history rows.

---

## 29. Required Demo Fixtures

Initial demo data should include at least:

### Jobs

Every Job referenced by any Bench plan must exist here.

```text
Prepare Data
Build Solver
Generate Mesh
Solver GPU
Solver CPU
Post Process
Generate Report
Invalid Job Manifest
```

### Benches

```text
Nightly Benchmark
Parameter Sweep
Smoke Test
Broken Plan Bench
```

### Nightly Benchmark Plan

Dispatches distinct Jobs, all at once:

```text
call 1  Prepare Data       --dataset=nightly
call 2  Build Solver       --release
call 3  Generate Mesh      --resolution=fine
call 4  Solver GPU         --mesh=256 --gpu=0
call 5  Post Process       --all
call 6  Generate Report    --summary
```

These have no dependency on one another. The names are legacy vocabulary from an
earlier sequential design and must not be implemented as stages.

### Parameter Sweep Plan

Dispatches the same Job repeatedly with different parameters. This is the case
the dispatch table must handle well:

```text
call 1  Solver GPU  --mesh=64
call 2  Solver GPU  --mesh=128
call 3  Solver GPU  --mesh=256
call 4  Solver GPU  --mesh=512
call 5  Solver GPU  --mesh=1024
```

### Broken Plan Bench

Its plan references `Invalid Job Manifest`, so Start always fails validation and
dispatches nothing. This fixture exists to exercise §2.3.2 and §15.4.

### Historical States

Fixtures must include examples of:

```text
Starting
Running
Succeeded
Failed
Cancelling
Cancelled
Query unavailable
Report available
Report generating
Report missing
Report read error
```

### Reports

Provide, as plain text:

1. A short successful Job report.
2. A failed Job report.
3. A Bench summary report.
4. A long report with at least several hundred lines.
5. A report containing very long unwrapped lines.
6. A report with repeated searchable terms.

And, as HTML, at least three reports with *deliberately unrelated* stylesheets —
the point of the fixtures is to demonstrate that report styling is outside this
application's control:

7. A dark report carrying an inline SVG chart.
8. A light, document-styled failure report.
9. A table-heavy Bench summary.

Both formats must appear in the demo Explorer so the viewer's two paths are both
exercised without touching the developer controls.

---

## 37. Testing

Tests run under vitest against **real temp folders and real executable
scripts** — never mocks of the filesystem or of a process. The shared fixtures
live in `mock/.fixtures/` (see its README); a suite copies one, points it at a
scratch store, and drives it.

The end-to-end scenarios began as ports of the first implementation's suite;
the questions outlived it.

Current coverage: 195 cases across 18 files — `engine`, `manifest`, `template`,
`invoke`, `status`, `store`, `words`, `world`, `operations`, `races`, `sync`,
`notices`, `uiState`, `agent`, `state.svelte`, `mock-library`.

### 37.1 Engine Tests

At minimum, test:

1. Starting a Job creates a `Starting` run.
2. Advancing a Job moves it from `Starting` to `Running`.
3. Cancelling a Job moves it through `Cancelling` to `Cancelled`.
4. Starting a Bench dispatches one run per plan call, all active at once.
5. Every run a Bench dispatches also appears in the referenced Job's own history,
   stored exactly once, with `RunOrigin::BenchStep`.
6. A plan may reference the same Job several times; each call gets its own run
   and its own parameters.
7. A failed child does not stop its siblings; the Bench stays `Running` until
   every child is terminal, then becomes `Failed`.
8. A Bench whose plan references an invalid or missing Job fails to start and
   dispatches nothing.
9. Cancelling a Bench cancels exactly its still-active children, leaves finished
   children intact, and leaves unrelated runs of the same Jobs untouched.
10. Cancelling one child run does not cancel the Bench run or its siblings.
11. Query failure does not overwrite the last known execution status.
12. Report generation changes report state to Available.
13. Starting a Job while runs are active always succeeds and creates an
    independent run.

### 37.2 Route Tests

Test:

- Selecting an entity opens its overview.
- Opening a Job run produces the correct route.
- Opening a Bench child run preserves Bench context and Explorer selection.
- Opening the same run from the Job's history yields `JobRunDetail` and selects
  the Job instead — same run record, different context.
- Opening and closing a report returns to the correct parent.
- Missing entity and missing run routes recover without panic.

### 37.3 Sync and Protocol Tests

Test:

- A rebuild with no change produces only the `refreshed` heartbeat.
- A `last_successful_query` stamp moving on its own produces no upsert.
- One logical operation produces one batch.
- A removed entity produces a `removed` event, and its runs go with it.
- A restored `ui-state.json` that is stale, malformed, or hand-edited comes back
  sanitized rather than rejected (§32).

### 37.4 Build Checks

The repository should pass:

```bash
npm run gate       # format:check → lint → check → test, cheapest failure first
npm run build      # the three bundles
```

or each on its own:

```bash
npm run format:check   # prettier
npm run lint           # eslint, with type-aware rules
npm run check          # svelte-check on the renderer, tsc --noEmit on main + preload
npm test               # vitest
```

Run these on both macOS and Linux where CI is available.

Three ESLint rules are on for a reason rather than by default:

- `no-floating-promises`, because an unawaited engine call runs unobserved and
  its failure vanishes (§26.2), and `no-misused-promises` with it.
- `curly: all`, so a body always gets braces and Prettier then always puts it
  on its own line. `if (x) return` reads as one thought and hides that it is
  two — the condition, and what happens — and a body on its own line is also
  what leaves room to add to it without restructuring first.

One is off for a reason: `require-await`, because here `async` is usually the
*contract* — an IPC handler answers a promise, a `Turn` takes one — and a body
that does not await yet is not a defect.

---

### 37.5 What the suites actually cover

`npm test` — vitest, 190 cases, ~10 s, no mocks of the filesystem or of
`child_process`: every scenario writes real folders and real executable
scripts into a temp directory and lets the engine spawn them.

| File                                                                                                                                        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/engine.test.ts`                                                                                                                      | All 20 end-to-end scenarios of `coco-egui/tests/coco_engine.rs`, plus registration idempotence + unregister and the records-read-once rule the Rust engine has no equivalent of: a corrupt `run.json` fails only its own run at the next open, and an outside edit is ignored until then. A manifest broken at the next open leaves its folder on the side it registered on; one that changes kind moves it across. Deletion (§12.1): a finished run's files go and its neighbours' stay, an active or UNREACHABLE run is refused, a settled bench run leaves its members, and the ids above what remains are handed back.                                                                                                                                                                                                     |
| `tests/mock-library.test.ts`                                                                                                                | The bundled `mock/` library end to end — port of `coco-egui/tests/coco_mock_library.rs`, but over a **copy** in a temp dir, so a test run leaves no `runs/`/`report/` in the repo.                                                                                                                                                                                                                                                                                                            |
| `tests/world.test.ts`                                                                                                                       | `buildWorld`: entity shape, run shape, report state, UNREACHABLE display (last known status + unavailable query health), bench plan steps, bench-origin members, history ordering.                                                                                                                                                                                                                                                                                                            |
| `tests/agent.test.ts`                                                                                                                       | The agent interface (§43): every route as a function of a world and a start, then the same routes over a **real unix socket** with a real HTTP client — a start crossing the wire, an oversize body refused, a socket a live coco is answering on left alone, a stale one replaced, the file removed on stop, and every reply framed with a `Content-Length` (see below).                                                                                                                     |
| `tests/uiState.test.ts`                                                                                                                     | What a relaunch restores: `sanitize` (a report never comes back, a Start page becomes its experiment, widths clamped, unknown routes dropped, a window position taken only as a pair) and the file round trip, including one that does not parse.                                                                                                                                                                                                                                             |
| `tests/notices.test.ts`                                                                                                                     | `refreshSummary` (one error in full, the rest as a count) and the `NoticeGate`: a repeating failure announced once, a changed one announced again, a clean pass re-arming it, and a manual refresh that always answers and counts as said.                                                                                                                                                                                                                                                    |
| `tests/refresh.test.ts`                                                                                                                     | The refresh gate over a hand-resolved engine: the clock's tick dropped while a pass is under way and taken once idle; a person's refresh queued behind the pass, never alongside it, keeping the clock out while it waits; a second person's refresh ignored while one is queued or running.                                                                                                                                                                                                    |
| `tests/sync.test.ts`                                                                                                                        | `diffWorlds`: silence when nothing moved, the `last_successful_query` exclusion, upserts/removals for all three entry kinds, one batch for a member and its bench.                                                                                                                                                                                                                                                                                                                            |
| `tests/operations.test.ts`                                                                                                                  | What the renderer can ask for (`src/main/operations.ts`): start by name with the manifest's parameter split, cancel a run, cancel a bench, delete a finished run (and be refused an active one), read a report (including the plain-text-wins rule the world builder also follows, an unregistered folder, and a run id that is not one), add a folder (including that a folder of experiments is _not_ searched), remove one (and that the disk is untouched) — each answered, never thrown.                                                       |
| `tests/races.test.ts`                                                                                                                       | The engine's write guards under real interleaving: a cancel during an in-flight poll survives it (below), and two concurrent starts get distinct run ids.                                                                                                                                                                                                                                                                                                                                     |
| `tests/state.svelte.test.ts`                                                                                                                | The renderer's state, compiled as runes: event application, the run index, every `recover()` rule, the notice (an error waits to be dismissed, anything else fades, an older timer never clears a newer message), and the two-addresses rules for a dispatched run (§19) — the bench stays selected, the fallbacks step back through the bench run, and a report reads from the job's folder. It covers what the state _holds_, not what it _notifies_ — see the note at the top of the file.; the journal (newest last, a hundred at most), the last change, the activity bar's view gesture, and an entry taking the page to its run.; the history's row menu — a run started again, its refusal in a modal, and a prefill with what could not be filled said. |
| `tests/journal.test.ts`                                                                                                                     | `sentences_of`: the line an event earns, judged against the entry as it was — a run that started and by whom, a status that moved (with the reason for an error), a report that landed, a run lost and found, a folder that came or went, a manifest that broke or healed, a failure the user was told about — and silence for a field moving on its own.                                                                                                   |
| `tests/format.test.ts`                                                                                                                      | `format_duration`: a clock while the run is live, a length with its empty leading units dropped once it has ended, and never backwards; `format_relative`: the largest unit that fits, from seconds to years, singular at one.                                                                                                                                                                                                                                                                                                                                                   |
| `tests/params.test.ts`                                                                                                                      | A parameter's shape (`src/shared/params.ts`): what a value of each of the five shapes may be and the message when it is not, the wire form — pairs always, a flag as the word, a list repeated — and the engine's check of a whole set, which names every fault at once.                                                                                                                                                                                          |
| `tests/manifest.test.ts` `tests/template.test.ts` `tests/words.test.ts` `tests/status.test.ts` `tests/store.test.ts` `tests/invoke.test.ts` | Ports of the corresponding Rust inline `#[cfg(test)]` modules, plus a few cases for the async spawn/harvest seam this port introduces.                                                                                                                                                                                                                                                                                                                                                        |

The fixture experiment folders are **real folders in the repository**:
`mock/.fixtures/job` and `mock/.fixtures/bench` (see their README). Tests copy
one per scenario and rename it in the copy, so one folder serves twenty-odd
cases. The `job` fixture answers from a `poll-state`/`report-state` file and
the `bench` fixture plans from a `plan-lines` file, so most tests change
behaviour by writing data, not by rewriting a script; a test whose _subject_
is a broken script still overwrites that one script in its copy. The directory
is hidden so that `tests/mock-library.test.ts`, which walks the library skipping
hidden names, sees the four demonstration experiments and none of the
fixtures.

`tests/support.ts` holds the helpers (`jobFolder`, `benchFolder`, `planLines`,
`settle`, `handEdit`). Two things it is careful about, both of which bite
otherwise: temp dirs are `realpath`-ed (on macOS `/var` is a symlink and the
engine keys state by the canonical path), and `handEdit` pushes the file's
mtime forward so a simulated hand-edit is distinguishable from the engine's
own write in the same millisecond.
---

## 38. Manual Acceptance Scenarios

### Scenario A: Job Start

1. Launch the app on macOS.
2. Select `Solver GPU`.
3. Confirm the overview shows active runs and history.
4. Click `Start Job`.
5. Enter parameters.
6. Submit with Command + Enter.
7. Confirm the modal closes.
8. Confirm a new run-detail page opens.
9. Confirm the initial state is Starting.
10. Advance the mock state.
11. Confirm the state becomes Running.
12. Complete the run.
13. Confirm the report becomes available.
14. Open the report.
15. Search and copy report text.

### Scenario B: Job Cancellation

1. Start a Job.
2. Advance it to Running.
3. Click Cancel Run.
4. Confirm the cancellation modal appears.
5. Confirm cancellation.
6. Verify the status becomes Cancelling.
7. Advance the mock state.
8. Verify the status becomes Cancelled.

### Scenario C: Query Failure

1. Open a running Job.
2. Trigger Query Unavailable.
3. Confirm the UI shows Unknown/status unavailable.
4. Confirm the last known status remains visible.
5. Confirm the run is not displayed as Failed.
6. Restore query health.
7. Confirm normal status returns.

### Scenario D: Bench Fan-Out

1. Select `Nightly Benchmark`.
2. Start the Bench.
3. Confirm navigation to Bench Run Detail.
4. Confirm all 6 calls are listed and all are active at once.
5. Confirm no call is shown as Pending.
6. Advance the mock state and confirm children finish out of order.
7. Click a completed child run.
8. Confirm a full child-run detail page opens.
9. Confirm the sidebar still highlights the Bench.
10. Return through breadcrumbs.
11. Open the referenced Job from the child-run page.
12. Confirm the same run appears in that Job's ALL RUNS table with the Bench as
    its Source.
13. Open it from there and confirm the Explorer selection moves to the Job.
14. Open a child report.

### Scenario E: Bench Partial Failure

1. Start a Bench.
2. Fail exactly one child run.
3. Confirm that child is Failed.
4. Confirm every sibling keeps running.
5. Confirm the Bench is still Running, with the failure visible in the counts.
6. Complete the remaining children.
7. Confirm the Bench becomes Failed only after the last child is terminal.
8. Confirm any generated failure report can be opened.

### Scenario H: Parameter Sweep

1. Select `Parameter Sweep`.
2. Start it.
3. Confirm 5 rows referencing the same Job, distinguished by parameters.
4. Confirm each row opens a distinct run.
5. Confirm the breadcrumb leaf disambiguates the calls.
6. Open `Solver GPU` and confirm all 5 runs appear in its history.

### Scenario I: Invalid Plan

1. Select `Broken Plan Bench`.
2. Start it.
3. Confirm Start fails with an inline error naming the offending call and Job.
4. Confirm the modal stays open and preserves the typed parameters.
5. Confirm no Bench run and no Job run were created anywhere in the Explorer.

### Scenario F: Add Folder

1. Reset to an empty Explorer.
2. Click Add Folder and confirm the operating system's folder picker opens.
3. Cancel it, and confirm the Explorer is unchanged.
4. Click Add Folder again and pick the bundled `mock/` directory.
5. Confirm its three Jobs appear in the Jobs group and its Bench in the Benches group.
6. Confirm the status bar reports how many folders were added.
7. Pick the same directory again, and confirm nothing is duplicated and the status bar says they are already in the Explorer.
8. Pick a directory with no manifest anywhere below it.
9. Confirm it appears with an error, and that Start is disabled for it.

### Scenario G: Window Resizing

Test at:

```text
900 × 600
1200 × 800
1600 × 1000
```

Confirm:

- Sidebar remains usable.
- Main content does not become a third-column layout.
- Tables remain readable, including the dispatch table with 50 rows.
- Report viewer scrolls correctly.
- Modals remain centered and reachable.
- No controls are permanently clipped.

---

## 40. Current State and Outstanding Work

The workbench is built. What follows is the standing list, not a build order.

**Working:** the engine port in full — manifests, templates, the job lifecycle,
the poll protocol, auto and manual reports with ERROR healing, cancel, bench
plan and fan-out, derived bench status, orphan detection, abandonment at close.
Memory as the truth with write-through; records read once, manifests re-read
each tick (§26.1); guarded writes, no queue (§26.2). Event-driven
sync (§26.3). Notices (§26.4). The journal and the Events view, the
activity bar with Explorer and Active Runs (§8, §11.1). The agent socket and the MCP binary (§43). The
persisted arrangement (§32). Explorer, overview, start, run detail, bench run
detail, bench child detail, report viewer for both formats, add and remove
folder, cancel with confirmation. An electron-builder package.

**Outstanding**, roughly by what each one costs:

- **Renderer component tests.** The biggest hole: the Svelte components and
  the IPC handlers in `index.ts` are covered only by the drive scenarios.
  Needs a component runner and an `index.ts` that lets a handler be called
  without `app.whenReady()`.
- The agent interface has no cancel, no registration, and no event stream
  (§43.6).
- Manual report re-run (IPC plus a button); the query-interruption banner and
  a per-run retry.
- Explorer and run filtering, search, the in-app theme toggle, Settings.
- Open a report externally; report-viewer virtualisation.
- `--dump-state`.
- Linux has not been exercised: neither the build nor the rendering comparison
  §5.1 flags as the one measurement that could revise its own record.
- Packaging is unsigned; no notarization, no auto-update (§4.2).

The gap tables below say what each of these looked like in the egui
implementation, where most of them existed.

---

## 42. Deliverables

A delivery must include:

1. Complete TypeScript source for main, preload, and renderer.
2. `package.json` and a committed `package-lock.json`.
3. The demonstration library in `mock/` and the fixtures in `mock/.fixtures/`.
4. Tests (§37).
5. README (§39).
6. macOS run verification.
7. Linux build verification or a documented limitation.
8. Screenshots of:
    - Job overview, including a Bench-sourced history row.
    - Start page.
    - Job run detail.
    - Bench run detail with the dispatch table.
    - A parameter-sweep Bench run.
    - Child-run detail.
    - Report viewer, plain text and HTML.
    - Query-unavailable state.
9. No unhandled rejection or crash in the listed acceptance scenarios.
10. No permanent right-side detail panel.

---

## 44. Definition of Done

A change is done when all of the following hold.

**Product**

- It launches as a macOS desktop application.
- It builds as a Linux desktop application.
- The Explorer registers the demonstration library in `mock/` and runs it.
- Selecting an entity shows its status and history.
- Start is a page under the experiment, not a modal over it (§15).
- Starting spawns the real launch script and the run is visible immediately (§3).
- A new run opens in full-page detail.
- Active status updates are visible without a manual action.
- Cancel uses a confirmation modal.
- Query failure is visually distinct from execution failure, and coco's `Error`
  from the experiment's `Failed` (§10.2).
- Clicking any history row opens a full run-detail page.
- Bench runs display a full-width dispatch table of every run they started.
- A Bench dispatches all of its calls at once, with no ordering or dependency.
- A run dispatched by a Bench appears in the referenced Job's own history, stored
  once and reachable from both contexts, showing the same facts either way (§19).
- Reports open in the full main-content area, plain text and HTML alike (§20).
- Reports can be searched, wrapped, selected, and copied.
- The sidebar remains the only persistent navigation panel.
- The arrangement survives a relaunch, sanitized (§32).
- The application remains usable at 900 × 600.
- The application remains responsive with 500 run-history rows.

**Architecture**

- `src/main/engine/` imports nothing from Electron.
- `src/renderer/` imports nothing from `src/main/`.
- The preload bridge gained no general-purpose channel.
- The renderer judged no change and mutated no world entry.
- Records stay readable across versions: a folder an earlier coco wrote still
  loads (`convention.md`).

**Checks**

- `npm run gate` succeeds — format, lint, types, tests.
- `npm run build` succeeds.
- README instructions reproduce the build on macOS.

---

## 45. Working on coco

This document describes a workbench that exists. Read it as the standing
description of what coco is and why, not as a build order — §40 carries what is
outstanding.

Two things are worth knowing before changing anything.

**The folder is the record.** coco keeps no database. An experiment folder holds
its own manifest, its own runs, and its own reports ([convention.md](convention.md)), and
both implementations write them identically. A change that makes a folder less
portable between them is a regression even when every test passes.

**The boundaries in §41 are the design.** The domain in the main process, the
renderer as a client, the backend as the only judge of change, guarded writes
on the engine, the page's vocabulary fixed at the preload — each of these
was arrived at for a reason recorded somewhere in this document, and the
security argument in §5.1 rests on the last of them.

Where a detail is not specified, choose the simplest implementation that
preserves the product principles here, and record the decision — in the README
if a user would meet it, in this document if a future change would otherwise
re-argue it.

---

## What is already decided

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
  As built, the socket adapter is a set of routes over `operations.ts`,
  driving the same engine as the IPC handlers, which is what keeps the two
  transports from being two implementations.
- **A launch that lost the single-instance lock still needs the `ready` guard
  in `index.ts`** (asked and answered 2026-08-22, by reading Electron 43.4.1
  and Chromium, and by instrumented launches on macOS). coco's platforms are
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

### Deliberate divergences (do not "fix")

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
  failure is that there is no answer. `src/main/notices.ts` keeps the quiet and
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
  `allow-same-origin`, so a report can never reach `window.coco`.
---

## Feature gaps against the egui implementation

The egui implementation was deleted on 2026-08-22. The `Rust reference`
column says where each feature lived in it; the tree is in git history before
that date.

### Operations wired in the engine but missing UI/IPC

| Feature                                          | Rust reference                                       | TS engine                                                                                       | Missing piece                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Manual report re-run (heals report-failed ERROR) | §11                                                  | `reportRun(folder, id, 'manual')` done                                                          | IPC + button on run detail                                                                                          |
| Retry query                                      | `RetryQuery` command, status-bar interruption banner | poll happens every tick anyway; the status bar's Refresh now forces one and reports how it went | the interruption banner (world has `query_health`), and aiming a retry at one run rather than refreshing everything |

### Missing entirely

| Feature                          | Rust reference                                            | Notes                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open report externally**       | `OpenReportExternally`                                    | Both formats now render in-app (see Deliberate divergences), so this is a convenience rather than the only way to read HTML: a `shell.openPath` on the report file, offered as a secondary action in the viewer's header (§20.1).                                                                             |
| **Report viewer virtualisation** | rows laid out only when visible (§35)                     | The viewer renders every line. Fine for the reports seen so far; a report of tens of thousands of lines wants windowing. Wrapping is off by default precisely so rows stay uniform height, which is what makes windowing possible later.                                                                      |
| **Explorer/run filtering**       | `status_filter` (persisted), `run_search`, sidebar search | None. The arrangement file has a place to keep the filter when it exists.                                                                                                                                                                                                                                     |
| **Theme setting**                | in-app Light/Dark toggle (Settings overlay), persisted    | Electron follows the system only; `theme.css` already has both palettes.                                                                                                                                                                                                                                      |
| **Overlays**                     | `ConfirmCancel`, `AddFolderReport`, `Settings`            | `ConfirmCancel` is ported, and `confirmRemove` joins it on the same `ModalFrame`; `AddFolderReport` and `Settings` are not. As in coco, overlay state is deliberately outside `Route` (§9) and never persisted.                                                                                               |
| **`--dump-state`**               | prints the exact world as JSON                            | trivial: a `node` entry point or `npm run dump` calling `buildWorld`.                                                                                                                                                                                                                                         |
| **Activity bar / view headers**  | shell chrome (§8)                                         | Built 2026-08-22: Explorer, Active Runs with its badge, and an Events view the egui shell never had (§11.1), each under its own title row; the gear is not there, since there is no theme toggle yet. Breadcrumbs stay per page (`Breadcrumbs.svelte`), not a shell-level bar.                                   |
| **Shortcuts beyond the menu**    | n/a (egui)                                                | The app menu is the platform's minimum for now (Edit roles + Quit on macOS, none elsewhere), so no Cmd+O/Cmd+R; nor an in-page keyboard surface (report search, sidebar focus, run filtering).                                                                                                                 |
| **Signed / notarised packaging** | n/a                                                       | `npm run package` builds an unsigned `coco.app` (`identity: null`) plus dmg/zip; Gatekeeper will object. mac targets are exercised, linux/win are configured but unbuilt.                                                                                                                                     |
| **Renderer tests**               | `Backend::Local` sync test seam drives the UI in-process  | The engine, world builder and sync layer are covered (see Tests); nothing exercises the Svelte components or the IPC handlers in `index.ts`. Needs a component runner (vitest browser mode or @testing-library/svelte) and an `index.ts` refactor that lets the handlers be called without `app.whenReady()`. |
---

## What testing and driving found

### Three the tests found

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
  thread (§43.3); the `refreshing` flag here only stopped two _refreshes_
  overlapping. First fixed by a serializing queue; now by the write guards of
  §26.2 — `poll_job` versions each run by its history length and drops a
  stale answer. `tests/races.test.ts` reproduces the stomp and holds the fix.
- **A `$state` proxy cannot cross IPC.** `window.coco.cancel(overlay.target)`
  passed a Svelte proxy to `ipcRenderer.invoke`, structured clone refused it,
  and the rejected promise left the modal on "Cancelling…" for ever with no
  error anywhere. Now `$state.snapshot` (the pattern `StartRun.svelte`
  already used) plus a `try`/`catch`, because nothing may wedge a modal.

One behaviour worth knowing rather than fixing: a run in `STARTING` whose
launch script has not been harvested yet has no submission id, so cancelling
it is refused with _"run 0 is still launching; there is no submission to
cancel yet"_ until the next tick (≤3 s). The button is offered because the
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
  quit the app (the platform convention, which `index.ts` followed at the
  time), so Playwright's `app.close()` waited for an exit that never came — a
  run took over ten minutes and had to be killed. It now asks nicely, waits
  three seconds, and insists. (Coco has since dropped that convention — the
  last window's close quits the app on every platform — but the driver keeps
  its insistence.)

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
  and the handle moves _with_ the sidebar it is resizing — so the moment the
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
  the message vanished. Notices raised before the first bootstrap were then
  held and delivered just after it. (That machinery is gone again: a refused
  socket now crashes the app — no agent interface, no coco — so there is no
  startup notice left to hold, and `agent-busy.mjs` went with it.)
- **A window nobody moves has no geometry to remember.** Geometry was read on
  `resize`/`move` only, so it was never recorded for exactly the people who
  leave the window where it opens. Every write reads it now, whatever prompted
  the write.

### Known inconsistency, inherited from the first implementation

A dispatched run's page shows `Call 1` and `Started by nightly-benchmark ·
call 2` for the same run. They come from two places: `plan.steps[].index` is
the plan's 0-based position, and the run record's `origin.call` is stamped
`index + 1` by the engine (`bench.ts`). The first implementation displayed both
the same way, so this was faithful rather than newly wrong — but a reader
seeing both at once has no way to know that. Fixing it means picking one
convention for display.
---

## Tech debt / pinned versions

- `vite@^7` (electron-vite 5 rejects vite 8), `typescript@~6` (svelte-check
  rejects TS 7). Revisit when electron-vite/svelte-check catch up.
- `template.ts` reaches into `nunjucks/src/parser` and `nunjucks/src/nodes`
  (undocumented-but-stable internals, loaded via `createRequire`). A nunjucks
  major bump needs a look at the AST walker.
- `fs.watch` deliberately deferred: it would only cut manifest-edit latency
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
---

## What is left

- Manual report re-run (IPC + a button); the query-interruption banner and a
  per-run retry.
- Open a report externally; report-viewer virtualisation.
- Explorer/run filtering and search; the in-app theme toggle; Settings.
- `--dump-state`.
- Renderer component tests (see the gap table) — still the biggest hole: the
  Svelte components and the IPC handlers in `index.ts` are covered only by the
  drive scenarios.
