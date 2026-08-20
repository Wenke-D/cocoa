# Architecture

How the workbench is built, and which of its boundaries are load-bearing.

The short version: the renderer is a web client that holds no domain logic,
the main process is a server that holds all of it, and the folders on disk are
the record. Everything below is an elaboration of those three facts, or a
consequence of them.

Covered here: §5 (the stack, and why it changed), §6 (platforms), §26–§27 (the
engine boundary and the run lifecycle), §32–§35 (persistence, project layout,
state, performance), §41 (the constraints that must hold).

---

## 5. Technology Baseline

The workbench is the classic Electron shape: the renderer is a web client, the
main process is the server, and the whole domain lives on the server side.

```jsonc
// coco-electron/package.json — the versions that matter
{
  "dependencies": {
    "nunjucks":  "^3.2.4",   // template rendering (§15.2)
    "smol-toml": "^1.8.0"    // coco.toml
  },
  "devDependencies": {
    "electron":         "^43.4.1",
    "svelte":           "^5.56.9",   // runes; no store library
    "typescript":       "^6.0.3",
    "vite":             "^7.3.6",
    "electron-vite":    "^5.0.0",
    "vitest":           "^4.1.11",
    "electron-builder": "^26.15.3",
    "playwright-core":  "^1.62.1"    // drives the built app (§28)
  }
}
```

Commit `package-lock.json`.

**The renderer is a client, not the application.** It holds no domain logic. It
renders what the main process sends and asks for operations by name (§26). Node
integration stays off and context isolation stays on: the page's entire
vocabulary is what `src/preload/index.ts` puts on `window.coco` through
`contextBridge`: eight operations — `bootstrap`, `start_run`, `cancel`,
`add_folder`, `remove_folder`, `report`, `refresh_now`, `save_ui` — and two
event subscriptions, `on_command` and `on_events`. Nothing else crosses.

**Templates are Jinja on both sides.** The engine renders an experiment's
templates with nunjucks; the egui implementation used minijinja. Both are
Jinja-family with the same delimiters and the same `{{ name }}` substitution, so
one experiment folder renders identically under either, which is what makes the
folders interchangeable. Template analysis is exact-match in both directions and
imports are rejected (§15.2).

**Names are `snake_case`, and the case tells you whose they are.** Everything
coco declares is `snake_case` — functions, methods, class fields, local
variables, parameters, the fields of `Route` and `UiState`, the preload
bridge's members, and the IPC channel names. What stays `camelCase` is what
belongs to somebody else: `fs.statSync`, `app.getPath`, Electron's
`webPreferences`, Playwright's `executablePath`, vitest's `testTimeout`. A
`camelCase` name in this codebase is a name from outside it.

The on-disk record format is not part of this rule, though it agrees with it.
`job_id`, `runs_by_job`, `last_successful_query` were `snake_case` before any
of it, because they are what serde writes and what `doc/convention.md`
specifies. They are fixed by the convention; the rest is fixed by this
paragraph, and the two must not be confused when one of them changes.

Component files stay `PascalCase.svelte` and `state.svelte.ts` keeps its
suffix: those are the frameworks' own conventions, and the rule above is about
names we choose.

**No async framework beyond what Node gives.** The engine's own operations are
synchronous and deterministic; the asynchrony in the application is the refresh
tick, the spawned scripts, and IPC.

Additional dependencies may be added only when clearly justified. Do not let
them float; do not upgrade without recording the reason.

### 5.1 Why a Web View, Reversed

This section previously argued that Tauri, Electron, and an embedded WebView
were non-goals, and that the question had been *closed on measurement rather
than on preference*. The decision was reversed on 2026-08-20. Both records are
kept, because the reversal is only legible next to what it overturned.

**What the old argument said, and what became of each part.**

*Not for appearance.* Rendered side by side at 1280×820 on a 2× display — same
palette, same metrics, same Inter cuts — egui and a web view were
indistinguishable. This was measured and it still holds; nothing about it was
wrong. It was an argument that switching would buy no *fidelity*, and it did
not. What it did not measure is the cost of arriving at a given design, which is
where the difference turned out to be.

*Not for text handling.* Labels were already selectable and the report viewer
already searched, highlighted, and copied. Also still true, also not what
decided it.

*The engine would not move.* This was the load-bearing objection: behind a web
view the step that renders templates into an argv list and executes it has to be
reachable from page script, and the scope wide enough to allow that is the scope
that turns any injection into arbitrary command execution. **The classic
Electron split answers it.** The engine did not move into page script — it moved
into the main process, a Node process the page cannot call into except through
the ten declared members above. The property that actually mattered — that the
page's vocabulary is declared experiments and declared parameters, never a
command line — is preserved exactly, and by the same reasoning. The objection
was sound against an embedded WebView driving the engine. It was never an
argument against a main process holding it.

*What would re-open it.* The old record named the trigger: reports needing rich
rendering in-app, at which point the report viewer becomes a primary surface and
a web view is what renders one. That trigger fired — §20 now renders HTML
reports in a sandboxed frame instead of handing them to the system browser.

**What actually decided it.** Iteration speed and legibility of the programming
model, stated as preference and recorded as such rather than dressed up as a
measurement. A visual change is faster to make and to judge in CSS than in
immediate-mode layout code; the retained-mode, event-driven model is the one the
author reasons about most readily; and a workbench whose look is still being
worked out is worth more when its look is cheap to change. None of this
contradicts the measurements above — it is a different axis, and it is the axis
that mattered.

**What would re-open it again.** A hard startup-time or memory requirement that
Electron cannot meet; a target platform without a Chromium build; or a Linux-at-1×
comparison that finds the two renderers meaningfully different in the direction
the old record flagged as unmeasured. None of these is in play, and the egui
implementation is kept in `coco-egui/` so the comparison remains possible rather
than hypothetical.

**What the reversal did not throw away.** The convention the folders follow, the
protocol §43 serves, and the questions the test suites ask were all worked out in
the egui implementation and all survived the move intact — which is the argument
for having written them down separately from the UI in the first place. The MCP
server survived as a *running artifact*: it was extracted to `coco-mcp/` and
drives the workbench without a line changed, because it only ever knew the
socket.

---

## 6. Supported Platforms

### 6.1 Mandatory

The application must run and build using:

```bash
npm install
npm run dev            # electron-vite, hot reload in the renderer
npm run build          # type-check and bundle main, preload, renderer
npm run package        # electron-builder, an installable coco.app
```

on:

- macOS on the developer's native architecture.
- Linux on the developer's native architecture.

The implementation must not contain architecture-specific code that prevents
either Apple Silicon or Intel macOS builds.

### 6.2 macOS Requirements

On macOS:

- Use the normal operating-system window frame and title bar.
- Do not implement a custom frameless title bar.
- Respect Retina/HiDPI scaling.
- Use platform-aware command shortcuts: the application menu declares
  `CmdOrCtrl` accelerators, and a menu pick and a click must route through the
  same operation (§25).
- Do not assume `/home/...` paths.
- Do not depend on Bash-specific commands.
- Do not depend on Homebrew packages to run the application.
- The application must remain usable at 100%, 150%, and Retina scaling.

### 6.3 Linux Requirements

On Linux:

- The same source tree must build without UI forks.
- Do not hardcode macOS-specific paths or keyboard labels.
- Support normal window resizing.
- Preserve the application's main two-column structure at small sizes.
- Document any required distribution packages in the README.

### 6.4 No Browser Target

coco is a desktop application. The renderer is a web client, but it is not a web
page: it depends on the main process for every fact it shows and every operation
it performs, and that process spawns local scripts against local folders. There
is no hosted build and none is planned.

---

## 26. The Engine Boundary

The engine is the whole domain: manifests, templates, the run lifecycle, the
poll protocol, reports, cancel, bench fan-out. It lives in the **main process**
(`src/main/engine/`) and the renderer never contains a copy of any of it.

The renderer reads a snapshot and asks for operations by name. It must not
mutate domain state, and there must be no path by which it could.

```ts
// src/main/operations.ts — plain functions over the engine, so they can be
// exercised without an Electron app around them. The ipcMain handlers in
// index.ts are wiring: call one of these, publish, answer.
start(engine, name, parameters, trigger): StartResult
cancel(engine, target): CancelResult
addFolder(engine, picked): AddFolderResult
remove_folder(engine, entity_id): RemoveFolderResult
report(engine, target): ReportResult
refresh(engine): RefreshReport
```

Every one of them **answers rather than throws**. A refusal is an outcome the
user reads — an invalid manifest, a bench plan with a bad call, a report too
large to send — not a crash and not an exception the renderer has to catch.

`start` on a Bench entity performs the whole fan-out: it produces the plan,
validates it against the Explorer, dispatches every call, and returns the Bench
run id. Plan production lives behind this boundary — the UI never builds a plan.

Because a Bench dispatch creates several Job runs at once, `start` must be
atomic from the UI's perspective: either the Bench run and all its child runs
exist, or nothing was created.

`trigger` — `Human` or `Agent` — is the whole difference between a click and an
agent's call (§43): same lookup, same validation, same queue, one word on the
record (§10.6).

### 26.1 Memory Is the Truth

The engine holds the domain in memory. Reads never touch disk. Writes go to
memory first and are then written through to the experiment folders, so the
folders stay the record ([convention.md](convention.md)) without being on the read path.

Each refresh tick runs a reconcile pass that pulls hand-edited files back in by
mtime. A file edited by hand between two ticks while coco writes the same run is
a lost update, and that is accepted: coco is a single local instance and the
alternative is a locking protocol over a directory tree.

`store.json` persists only what is not in the folders — the registered folders,
and nothing else — not the runs, which live in the folders, and not a run-id
counter, which was retired in favour of deriving an id from the experiment's
own records (convention §5).

### 26.2 One Turn at a Time

Operations are serialized (`src/main/serial.ts`). A poll, a start, and a cancel
run one after another and never interleave.

This is not optional bookkeeping. Every operation awaits a script, so without a
queue a poll that *started* before a cancel can *finish* after it and write the
pre-cancel status back over `CANCELLING`. A "refresh in progress" flag does not
help: it only stops two refreshes overlapping.

Queued, not dropped — a user's cancel waits its turn rather than being lost. A
failed turn does not cancel the queue; the next one runs either way and each
caller still sees its own outcome.

### 26.3 The Backend Judges Change

The renderer is told conclusions, never asked to work them out.

The main process keeps its own model of the world, rebuilds it each cycle, and
turns the difference into events (`diffWorlds` in `src/main/sync.ts`):

```text
coco:bootstrap   once, on load — the one full-state message
coco:events      batches thereafter:
                   entity   | job-run | bench-run   upserted | removed
                   notice
                   refreshed                        (content-free heartbeat)
```

Rules that make this safe:

- **Upserts carry the whole entry.** Entry-level over-push, never field diffs.
- **A removal names the experiment as well as the run.** An upsert does not
  need to — the run carries its own `job_id` — but a removal has no run left to
  carry it, and a run id alone no longer identifies anything (§10).
- **One batch per logical operation**, so the renderer never sees a torn world.
  A start's events are sent *before* its answer resolves.
- **`last_successful_query` is excluded from entry identity.** It changes on
  every rebuild, so including it would mark every entry changed on every tick.
  When query health actually flips, other fields change with it.
- A fresh page owns nothing, which is why bootstrap is irreducible.

### 26.4 Notices

A refresh that fails sends a `notice` event. The engine refreshes every three
seconds, so a cluster answering badly answers badly on every tick: the question
worth putting on screen is never "did this pass fail" but "is this a new
failure". `src/main/notices.ts` announces a failure once and then holds still
while it repeats.

A refresh the user asked for always answers, including `Refreshed.` when there
is nothing else to say. Errors stay until dismissed; anything else fades.

---

## 27. Lifecycle Progression

### 27.1 Job Start

```text
Starting → Running → Completed → Analyzing → Succeeded
```

`Starting` means the launch script was spawned, not that it answered (§3). The
refresh tick harvests the submission id. The poll script's reported word drives
the rest; `Completed` and `Analyzing` are the report's half (§10.2).

Also reachable:

```text
Running → Failed
Running → Cancelling → Cancelled
anywhere → Error          (coco could not carry out its own side)
```

### 27.2 Bench Start

Starting a Bench creates a Bench run plus one Job run per plan call, all at once.

```text
Bench: Starting

Call 1: Starting
Call 2: Starting
Call 3: Starting
...
```

Every call starts together. No call is ever `Pending` on coco's account — only
the cluster can make a run pending.

Children advance independently, and finish out of order:

```text
Bench Running · 0 / 6 finished
Call 2 Succeeded          Bench Running · 1 / 6
Call 5 Failed             Bench Running · 2 / 6   ← siblings keep running
Call 1 Succeeded          Bench Running · 3 / 6
Call 3 Succeeded          Bench Running · 4 / 6
Call 6 Succeeded          Bench Running · 5 / 6
Call 4 Succeeded          Bench Failed  · 6 / 6   ← aggregate resolves last
```

The Bench must not reach a terminal status while any child is still active, and
a failed child must not stop its siblings. The Bench's status is **derived** from
its children, not stored independently of them.

### 27.3 The Refresh Tick

One interval drives everything: `REFRESH_INTERVAL_MS = 3000` in
`src/main/index.ts`. On each tick the engine harvests pending launches, polls
active runs, takes reports that are due, reconciles hand-edited files, rebuilds
the world, and publishes the difference.

There is no filesystem watcher (§4.3) and no per-run timer. Duration fields tick
in the renderer off a clock of its own; they are display, and they must not
cause a request.

---

## 32. Persistence

The window's own arrangement lives in `ui-state.json` in Electron's `userData`
directory, written by `src/main/ui_state_file.ts`. It is a **second, smaller file**
next to the engine's `store.json`: the store is the *experiments'* memory
(convention §5) and has no business holding which page was open.

`COCO_UI_STATE_PATH` overrides the location, which is what lets a drive run
(§28) keep its hands off the user's real window.

Persist:

- Route, when it is a place worth returning to.
- Sidebar width.
- Report wrap setting.
- Window geometry.

Geometry is recorded as it changes, not only on close: on macOS, quitting with
the window open never fires a close at all.

Do not persist:

- Anything about runs. The experiment folders hold their own records, and the
  engine's store holds the run counter and the values each experiment last used
  (convention §5) — the UI keeps no copy of either.
- Overlays. A modal is an action, not a place (§9).
- Transient notices.
- Parameter drafts. A draft survives a failed submission (§31) and nothing
  longer.

**What comes back is untrusted.** The file may be older or newer than this
build, or edited by hand. Everything loaded goes through `sanitize()` in
`src/shared/ui.ts`, which clamps the sidebar width and the window box and
repairs the route:

- A `report` route is **never** restored. A report is something you opened, not
  somewhere you live, and the file may be gone.
- A `start` route comes back as its experiment. Half a filled-in form is not a
  place either.
- A route naming an entity or run the world no longer contains is recovered to
  the nearest valid ancestor, with a message (`recover`, mirroring the Rust
  `Route::recover`).

A file that fails to parse is not an error worth stopping for. The worst case is
a window that opens where it always opens.

---

## 33. Project Structure

```text
coco-electron/
├── package.json
├── electron.vite.config.ts        # three builds: main, preload, renderer
├── electron-builder.yml
├── vitest.config.ts
├── svelte.config.mjs
├── tsconfig.node.json             # main + preload
├── tsconfig.web.json              # renderer
│
├── src/
│   ├── shared/                    # both sides import these; one definition
│   │   ├── world.ts               #   domain types + the IPC protocol (§10, §26.3)
│   │   └── ui.ts                  #   Route, UiState, sanitize (§9, §32)
│   │
│   ├── main/                      # the server: owns everything
│   │   ├── index.ts               #   window, menu, IPC handlers, refresh tick
│   │   ├── engine/                #   the domain — no Electron import anywhere
│   │   │   ├── coco.ts            #     the engine proper
│   │   │   ├── manifest.ts        #     coco.toml, fully validated
│   │   │   ├── template.ts        #     analyze / render (§15.2)
│   │   │   ├── invoke.ts          #     lexical command split, spawn
│   │   │   ├── record.ts          #     run.json, byte-compatible
│   │   │   ├── status.ts          #     the poll protocol (§10.2)
│   │   │   ├── store.ts           #     store.json, atomic writes
│   │   │   ├── words.ts           #     the protocol's vocabulary
│   │   │   ├── world.ts           #     folders → World
│   │   │   └── errors.ts
│   │   ├── operations.ts          #   what the renderer may ask for (§26)
│   │   ├── serial.ts              #   one turn at a time (§26.2)
│   │   ├── sync.ts                #   diffWorlds — the backend judges change (§26.3)
│   │   ├── notices.ts             #   announce once, then hold still (§26.4)
│   │   ├── ui_state_file.ts             #   ui-state.json (§32)
│   │   ├── menu.ts                #   application menu, routed through the window
│   │   └── agent.ts               #   the unix socket (§43)
│   │
│   ├── preload/index.ts           # the typed bridge — the page's whole vocabulary
│   │
│   └── renderer/                  # the client: renders, asks, holds nothing
│       ├── index.html
│       └── src/
│           ├── main.ts
│           ├── App.svelte
│           ├── state.svelte.ts    #   the one rune (§34)
│           ├── theme.css          #   the design system (ui-system.md)
│           ├── lib/               #   Sidebar, StatusBar, StatusPill, Breadcrumbs,
│           │                      #   ModalFrame, CancelModal, RemoveModal,
│           │                      #   ContextMenu, RunFacts
│           └── pages/             #   Empty, EntityOverview, StartRun,
│                                  #   JobRunDetail, BenchRunDetail,
│                                  #   BenchChildRunDetail, ReportViewer
│
├── scripts/drive.mjs + scenarios/ # drive the built app (§28)
└── tests/                         # vitest (§37)
```

Beside it in the repository:

```text
coco-mcp/         the MCP server (§43.5) — one binary, serde_json, nothing else
coco-egui/        the superseded first implementation (§5.1)
mock/             the demonstration library, shared; .fixtures/ for the suites
doc/              this documentation
```

Two boundaries are structural rather than stylistic, and must hold:

1. **`src/main/engine/` imports nothing from Electron.** It is the domain over a
   filesystem, and that is what makes it testable against real temp folders with
   no app around it, and portable between the two implementations.
2. **`src/renderer/` imports nothing from `src/main/`.** Its only channel is
   `window.coco` (§5). If the renderer needs a fact, the fact belongs in the
   world or in an operation's answer.

`RunFacts.svelte` exists because a dispatched run has two addresses (§2.3.1,
§19): the job-run page and the bench-child page show the same record, so the
facts come from one component and cannot drift.

---

## 34. Application State

Domain state and application state are separate, and they live in separate
processes — which is the strongest form of that separation available.

The renderer's whole mutable state is one rune:

```ts
// src/renderer/src/state.svelte.ts
export const app = $state({
  connected: false,
  world: emptyWorld() as World,     // a mirror; only events write it
  route: { page: 'empty' } as Route,
  overlay: null as Overlay | null,  // never persisted (§9)
  menu: null as ContextMenu | null,
  notice: null as Notice | null,
  sidebar_width: ...,                // arrangement, persisted (§32)
  report_wrap: ...,
  now_ms: Date.now()                 // the clock durations tick off
})
```

`world` is a **mirror, not a source**. Only `coco:bootstrap` and `coco:events`
write it. No component may edit it to reflect an action it just took — the
action's events are what update the screen, and they arrive before the action's
answer resolves (§26.3).

There is exactly one `notice`: the newest thing to say is the thing worth
saying, and a stack of them is the verbose log §8.5 rules out.

Do not let route changes modify execution state.

Do not let a refresh reset route state. A refresh may *invalidate* a route — the
entity was removed, the run is gone — and then it is recovered explicitly, with
a message (§32), never silently.

---

## 35. Performance Requirements

The application must remain responsive with:

- 500 historical runs.
- A Bench run that dispatched 50 concurrent child runs.
- Many simultaneously active runs across several Jobs.
- A report containing thousands of lines.
- A continuously updating duration field.

Avoid:

- Putting report text in the world (§10.5). Reports are fetched when opened, and
  refused above `MAX_REPORT_BYTES` rather than sent whole.
- Re-sorting large history arrays on every render where a derived value would do.
- A timer per run. One clock updates `now_ms`; durations are computed from it.
- Blocking the main process. It answers IPC, serves the agent socket, and runs
  the tick; a synchronous read of a large file there stalls all three.
- Re-bootstrapping to recover from a missed event. If events can be missed, the
  protocol is wrong (§26.3).

The world is re-sent as **entries**, never as a whole, after the first message.
This is the v1 protocol: entry-level over-push. It is sized for a local library
of tens of experiments, and the note on the v2 keyed protocol records what would
justify moving to it.

---

## 41. Implementation Constraints

1. Keep the domain in the main process. Do not move engine logic into the
   renderer, and do not add a second copy of it there.
2. Do not let `src/main/engine/` import from Electron (§33).
3. Do not let the renderer import from `src/main/` (§33).
4. Do not widen the preload bridge to a general channel. Every capability the
   page has is a named member of that object, and that is the security property
   §5.1 turns on.
5. Do not let the renderer mutate `app.world` to reflect an action it took.
   Events update the screen (§34).
6. Do not make the renderer judge change or compute a diff (§26.3).
7. Do not bypass the serialized turn (§26.2).
8. Do not put report text in the world (§10.5).
9. Do not run a shell from the UI. Commands are split lexically from the
   manifest and spawned without a shell (`invoke.ts`).
10. Do not trust a report's content. It renders in a sandboxed frame without
    `allow-same-origin` (§20).
11. Do not trust `ui-state.json`. Everything loaded goes through `sanitize`
    (§32).
12. Do not create a permanent right-side inspector.
13. Do not put the parameter field permanently on overview pages.
14. Do not display full run details only in a sidebar.
15. Do not conflate query failure with experiment failure, or coco's `Error`
    with the experiment's `Failed` (§10.2).
16. Do not model a Bench as owning, defining, or sequencing Jobs.
17. Do not duplicate a run record to serve both the Job and Bench views.
18. Do not reintroduce a concurrency policy or block Start on active runs.
19. Do not make the Query operation a prominent manual action.
20. Do not remove active runs from the UI when navigating elsewhere.
21. Do not silently discard user-entered parameters after a failed Start.
22. Do not let dependency versions float; do not upgrade without recording the
    reason.
23. Keep the on-disk convention byte-compatible with `coco-egui/`. A folder that
    stops being interchangeable is a regression, and the ported test suites are
    what catch it.

---
