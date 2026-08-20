# coco  
## Electron Workbench Specification

**Document status:** Implementation specification for the workbench under development  
**Primary production platform:** Linux desktop  
**Mandatory platforms:** macOS and Linux desktop  
**Shell:** Electron  
**Renderer:** Svelte 5 and TypeScript  
**Main process:** a TypeScript engine over the folder convention (`design/CONVENTION.md`)  
**Package name:** `coco-electron`  
**Application title:** `coco`

> **Naming note.** The system is named **coco**. The earlier working title
> "Experiment Pipeline Manager" is retired: "Pipeline" was a misnomer under the
> Bench model in §2.2 — a Bench fans out, it does not sequence.

> **Which tree this describes.** The repository holds three:
>
> | | |
> |---|---|
> | `coco-electron/` | **the workbench** — what this document specifies, and the only implementation under development |
> | `coco-mcp/` | the MCP server (§43.5), its own crate, in continued use — it speaks the socket protocol and nothing else, so it drives the workbench unchanged |
> | `coco-egui/` | the first implementation, Rust and eframe/egui. No longer developed; kept for its history and for the convention it worked out |
>
> Where coco-electron and coco-egui differ, coco-electron is right and this
> document follows it. §5.1 records why the framework decision was reversed.

> **Not a mock any more.** This document began as the specification for a
> mock-data prototype, and phrases from that phase survived into sections it no
> longer describes. Both implementations read real manifests, render real
> templates, and spawn real processes. Where a section still says *mock*, it
> means the demonstration library in `mock/` — real experiment folders holding
> shell scripts — and never simulated data.

---

## 1. Mission

Build a desktop workbench for managing local experiments.

The application manages two kinds of entities:

1. **Job**
2. **Bench**

Both exist as folders on the local computer. Each folder holds a manifest
(`coco.toml`) that defines how the application starts, queries, reports on, and
cancels a run, and the folder is the record: `runs/*/run.json` and `report/` are
written where the experiment lives, not into a database (`design/CONVENTION.md`).

The application must allow a user to:

1. Select a Job or Bench.
2. See its current runs and complete run history.
3. Open the Start page.
4. Enter a free-form parameter string.
5. Start a simulated run.
6. Monitor its status.
7. Open a full run-detail page.
8. Cancel an active run.
9. Open a plain-text report.
10. For a Bench, inspect every run it dispatched.
11. Open the detail page of an individual dispatched run.
12. See successful, failed, cancelled, and unavailable-query states told apart.

The result must be a real, runnable desktop application rather than a static
mockup, and must work against real experiment folders.

---

## 2. Product Model

### 2.1 Job

A Job is an independently runnable experiment.

A Job has:

- A stable ID.
- A display name.
- A folder path.
- Manifest validity state.
- The values its last run used, for the explicit fill action (§15.3).
- Zero or more runs.
- Zero or more active runs.
- Historical reports.

A Job run has:

- A run ID.
- The owning Job's entity ID.
- Run origin: started directly by the user, or dispatched by a Bench run step.
- Start time.
- Optional end time.
- Input parameter string.
- Execution status.
- Query-health status.
- Duration.
- Optional report.
- Last successful query time.
- Optional error message.

Job runs are always independent of one another. A Job may have any number of
concurrent active runs regardless of how they were started.

### 2.2 Bench

**A Bench does not define, own, or contain Jobs. A Bench is not a pipeline.**

A Bench is a *fan-out launcher*. When started, it returns a list of calls to Jobs
that **already exist in the Explorer**, each with its own parameter string. The
Bench dispatches all of them at once and then waits.

There is no ordering, no dependency, and no sequencing between the dispatched
Jobs. The same Job may appear many times in one plan with different parameters —
a parameter sweep is the primary use case.

A Bench has:

- A stable ID.
- A display name.
- A folder path.
- Manifest validity state.
- The values its last run used, for the explicit fill action (§15.3).
- Zero or more Bench runs.

A Bench has **no** static job list. Its calls are unknown until a run starts.

A Bench run has:

- A Bench run ID.
- Start time.
- Optional end time.
- Input parameter string (the string the user typed on the Start page).
- The plan returned at start time.
- Aggregate execution status.
- Query-health status.
- Optional Bench-level report.
- Last successful query time.
- Optional error message.

A plan call has:

- A stable index, used only for display order and identity. It carries no
  execution ordering.
- The `EntityId` of an existing Job in the Explorer.
- The parameter string the Bench derived for that Job.
- The `RunId` of the dispatched run.

### 2.3 Bench Execution Rules

The plan is returned **in full at start time**, and every call is dispatched
immediately. A Bench run therefore has no pending or not-yet-started calls
after a successful start.

All dispatched runs execute concurrently and independently. Nothing waits for
anything else.

The Bench run's aggregate status is derived from its children:

```text
any child Starting or Running          → Running
all children terminal, any Failed      → Failed
all children terminal, any Cancelled   → Cancelled
all children Succeeded                 → Succeeded
```

A failing child does **not** abort its siblings. The Bench run reaches a terminal
state only when every dispatched run has reached a terminal state.

Progress is a completion count over the plan, not a position in a sequence:

```text
3 of 6 runs completed
```

### 2.3.1 Run Identity

A run dispatched by a Bench **is a real run of the referenced Job**. It is the
same run record, stored once, reachable from two places:

```text
Job overview → ALL RUNS table          → JobRunDetail
Bench run detail → dispatched runs     → BenchChildJobDetail
```

Both routes display the same underlying run. They differ only in breadcrumbs
and in which Explorer row stays highlighted. See §19.

coco must not duplicate run records to serve both views.

### 2.3.2 Start Preconditions

Before a Bench run begins, validate the returned plan:

- Every referenced `EntityId` must exist in the Explorer and must be a Job.
- Every referenced Job's manifest must be `Valid`.

If validation fails, the Bench does not start and no run is dispatched. Report
the failure inline on the Start page, naming every offending call and Job. See
§15.4 and §31.

Validation is all-or-nothing. Never dispatch a partial plan.

### 2.3.3 Failure and Cancellation

If a dispatched child run fails:

- That Job run becomes `Failed`.
- Its siblings continue running, unaffected.
- The Bench run becomes `Failed` once every child has reached a terminal state.

If the Bench run is cancelled:

- Every child run still active transitions to `Cancelling`, then `Cancelled`.
- Children that already reached a terminal state keep their result.
- The Bench run transitions to `Cancelling`, then `Cancelled`.

Cancelling a Bench must not affect any other run of the same Job that the Bench
did not dispatch. A single Job may simultaneously have a directly-started run and
several Bench-dispatched runs; cancelling the Bench touches only the latter.

---

## 3. Core Backend Operations

The real product will eventually expose three operational concepts:

```text
Start
Query
Cancel
```

Starting a Job begins execution directly. A start means *launched*: the run
exists, visibly `STARTING`, from the moment its launch script is spawned. The
script's answer arrives in its own time and is collected by the refresh tick —
a submission id completes the record; a failure or timeout moves the run to
`ERROR` with the output attached. Only a script that cannot be spawned at all
refuses the start itself, because that is a folder problem the submitter can
act on now.

Closing coco right after a start is normal, and must not lose the run. The
close waits a short grace for launches still in flight — a script answers in
seconds, so the submission id is recorded and the next open catches up on the
run like any other (§10). A script still running past the grace is killed and
its run moved to `ERROR` at the close, honestly. Only a *crash* leaves a run
mid-launch with nothing recorded; the next refresh finds it and moves it to
`ERROR`, because the stdout that carried its submission id died with the
process that read it.

Starting a Bench returns a **plan** — a list of `(existing Job, parameters)` calls,
all dispatched at once. The Bench itself executes nothing; it fans out to Jobs.
Each dispatch is an ordinary Job Start.

Who triggers what:

- **Start** is triggered by the user, or by an agent through §43.
- **Cancel** is triggered by the user after confirmation.
- **Query** is automatic, on the refresh tick.
- Query must not be presented as a primary user action.
- A small manual Refresh action must be provided as a fallback.

Report retrieval is treated as read-only data access rather than an experiment operation.

---

## 4. Scope

### 4.1 P0 Requirements

The workbench must include:

- A macOS desktop application.
- A Linux desktop application.
- Activity bar selecting the sidebar's view.
- Narrow persistent left sidebar.
- Large unified main-content region.
- No permanent right-side inspector.
- Job overview.
- Bench overview.
- Start page.
- Cancel confirmation modal.
- Job run-detail page.
- Bench run-detail page.
- Bench child-run detail page.
- Report viewer, plain text and HTML (§20).
- Active Runs section.
- All Runs table.
- Bench dispatch table.
- Breadcrumb navigation.
- Real manifests, templates, and process execution (`design/CONVENTION.md`).
- The demonstration library in `mock/` registering and running unchanged.
- Query failure shown without overwriting the last known status.
- Automatic and manual report retrieval.
- Active Runs sidebar view.
- Status filtering in run history.
- Window resizing.
- Keyboard interaction.
- Light and dark theme compatibility.
- Basic persistence of UI preferences.
- Unit tests for engine state transitions.
- README with macOS and Linux run instructions.

### 4.2 Optional P1 Features

The following may be added after all P0 requirements work:

- Sortable table headers.
- Column-width persistence.
- Keyboard selection inside tables.
- Visual snapshot tests.
- Code signing and notarization.
- Linux AppImage or package.
- Auto-update.

### 4.3 Explicit Non-Goals

Do not implement any of the following:

- Filesystem watchers. The refresh tick is the only clock (§7.5).
- Remote execution arranged by coco itself. A manifest's own scripts may reach
  a cluster over SSH or Slurm; coco runs the script and knows nothing of what it
  reaches.
- Authentication.
- User accounts.
- A network server. The agent interface is a unix socket (§43.2).
- A database. The experiment folders are the record.
- DAG editing.
- Pipeline editing.
- Drag-and-drop pipeline construction.
- System tray integration.
- Notification-center integration.
- Plugin architecture.
- Full localization.

Do not allow these non-goals to delay the workbench.

Removed from this list, and no longer non-goals: real manifest parsing, folder
scanning, the OS folder picker, process execution, polling, cancellation
signals, and stdout capture were the mock-phase exclusions, and are all
implemented. Electron was a non-goal until the decision recorded in §5.1 was
reversed; React, Flutter, and Qt were listed beside it and are simply not the
stack — see §5.

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
`contextBridge`: eight operations — `bootstrap`, `startRun`, `cancel`,
`addFolder`, `removeFolder`, `report`, `refreshNow`, `saveUi` — and two event
subscriptions, `onCommand` and `onEvents`. Nothing else crosses.

**Templates are Jinja on both sides.** The engine renders an experiment's
templates with nunjucks; the egui implementation used minijinja. Both are
Jinja-family with the same delimiters and the same `{{ name }}` substitution, so
one experiment folder renders identically under either, which is what makes the
folders interchangeable. Template analysis is exact-match in both directions and
imports are rejected (§15.2).

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

## 7. Fundamental UX Decisions

The UI must follow these decisions.

### 7.1 Viewing Has Higher Priority Than Starting

The selected Job or Bench overview primarily shows:

1. Current state.
2. Active runs.
3. Historical runs.
4. Reports.
5. Start action.

The parameter input must not permanently occupy the overview page.

Starting is a temporary action and must happen in a modal.

### 7.2 Two Persistent Regions Only

The main window has only two persistent content regions:

```text
Left: Sidebar
Right: Unified main-content region
```

Do not create a permanent third inspector column.

The activity bar (§8.2) and the status bar (§8.5) are chrome, not content regions. The activity bar chooses which view the one sidebar shows; it never holds content of its own.

Job details, Bench details, child-run details, and reports must open in the main-content region.

### 7.3 Full-Page Details

Clicking a run-history row must navigate the main-content region to a complete run-detail page.

Do not show run details only in a narrow side panel.

### 7.4 Full-Page Reports

Clicking an available report must open the report viewer in the main-content region.

Do not show long reports in a tooltip, narrow panel, or small modal.

An HTML report opens in the browser, but the viewer page still exists and is
still full-page: it identifies the report, offers the source, and hosts the
`Open in Browser` action (§20).

### 7.5 Automatic Query

The application automatically updates active runs.

The user should not need to repeatedly press Query.

A small Refresh control may exist, but it is secondary.

---

## 8. Application Shell

The persistent application shell is:

It is laid out as a workbench, in the order the panels claim space: activity bar, sidebar, main content, status bar.

```text
┌────┬───────────────────┬────────────────────────────────────────────────┐
│    │ EXPLORER         + │                                                │
│ Li │                   │                                                │
│ Ru²│ v BENCHES         │                 Main Content                   │
│    │   Nightly Bench 1 │                                                │
│    │ v JOBS            │  Entity overview, run detail, dispatch, or     │
│    │   Solver GPU      │  report                                        │
│    │   Post Process    │                                                │
│ Mg │                   │                                                │
├────┴───────────────────┴────────────────────────────────────────────────┤
│ 2 active runs   Last refresh 1 second ago   (refresh)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

There is no in-window top bar. The platform window title bar carries the application name.

### 8.1 Default Window

Use approximately:

```text
Default size: 1280 × 820 logical points
Minimum size: 900 × 600 logical points
```

The app must remain functional at the minimum size.

### 8.2 Activity Bar

A fixed-width icon strip on the far left, spanning the full height above the status bar.

It contains, top to bottom:

1. `Explorer` view icon.
2. `Active Runs` view icon, carrying the active-run count as a badge.
3. `Manage` gear, pinned to the foot of the strip.

Behavior:

- Clicking an item that is not currently open selects that sidebar view and opens the sidebar.
- Clicking the item that is already open collapses the sidebar.
- The open item carries a 2-point accent rule on its leading edge.
- Every item has a tooltip.

The badge:

- Is hidden when the count is zero.
- Reads `99+` above ninety-nine.
- Counts a Bench run once, not once per dispatched child (§21).

The gear opens a menu carrying the `Color Theme` choice (§24.3). It carries nothing else; every other global action has a home elsewhere in the workbench.

The title of the currently selected entity belongs in the main content, never in global chrome.

### 8.3 Sidebar

Recommended dimensions:

```text
Default width: 220
Minimum width: 180
Maximum width: 300
```

The sidebar is resizable within these limits, and the width the user drags to persists.

The sidebar hosts exactly one view at a time, chosen by the activity bar (§8.2). Each view opens with a title row carrying the view name in small uppercase text, followed by that view's actions.

The `Explorer` view contains:

1. Title row, whose one action is a `+` icon button opening `Add Folder` (§11.5).
2. `BENCHES` section.
3. `JOBS` section.

Both sections are collapsible, and their collapsed state persists.

The `Active Runs` view contains a title row with no actions, followed by its rows (§11.1).

The sidebar remains visible on all normal pages unless the user collapses it from the activity bar.

### 8.4 Main Content

The main content changes according to the current route.

It must support:

- Vertical scrolling.
- Wide tables.
- Breadcrumbs.
- Full-width run details.
- Full-width Bench dispatch table.
- Full-width report viewer.

### 8.5 Bottom Status Bar

Three standing items:

- Number of active runs.
- Last refresh time.
- Refresh action, as an icon.

Two conditional items, shown only when they apply:

- Query interruption warning.
- Temporary success or error message, right-aligned, with a `Dismiss` action.

The transient message is the only place a failed Refresh or Cancel reports itself.

Do not display verbose logs here.

---

## 9. Navigation Model

Use an explicit route union. A route is an **address, never content**: it names
what to show, and every fact on the page is looked up from the world by that
address at render time. A route must never carry a copy of a run.

```ts
// coco-electron/src/shared/ui.ts
export type ReportContext =
  | { kind: 'jobRun'; jobId: string }
  | { kind: 'benchRun'; benchId: string }
  | { kind: 'benchChild'; benchId: string; benchRunId: string }

export type Route =
  | { page: 'empty' }
  | { page: 'entity'; entityId: string }
  /** The start form (§15). Only the identity: what the user has typed is a
   *  draft held outside the route. */
  | { page: 'start'; entityId: string }
  | { page: 'jobRun'; jobId: string; runId: string }
  | { page: 'benchRun'; benchId: string; runId: string }
  /** A run dispatched by a bench, seen in the bench's context (§19). */
  | { page: 'benchChild'; benchId: string; benchRunId: string; runId: string }
  | { page: 'report'; context: ReportContext; runId: string }
```

Overlays are separate state, held by the renderer and never persisted:

```ts
// src/renderer/src/state.svelte.ts — `null` is "no overlay"; every overlay
// carries its own error and busy flag, because a modal that has asked for an
// operation has to show the refusal in place rather than dismiss into a toast.
export type Overlay = { error: string | null; busy: boolean } & (
  | { kind: 'confirmCancel'; target: CancelTarget }
  | { kind: 'confirmRemove'; entityId: string }
)
```

§11.5's refusal-report modal is not in this union; see the gap noted there.

Do not encode modal state inside `Route`. A modal is an action, not a place: it
does not survive a relaunch (§32) and it is not a breadcrumb.

### 9.1 Sidebar Navigation

Clicking a Job or Bench in the sidebar must:

- Select that entity.
- Navigate to its overview.
- Clear any run-history row selection.
- Leave the sidebar visible.

### 9.2 Context Preservation

A run dispatched by a Bench is reachable from two routes (§2.3.1). The route you
arrived by — not the run's origin — decides the context.

Reached from the Bench run's dispatch table:

```text
Route:   BenchChildRunDetail
Sidebar: Nightly Benchmark  (the Bench stays selected)
Crumbs:  Nightly Benchmark / Run 2026-08-15 10:24 / Solver GPU
```

Reached from the Job's own ALL RUNS table:

```text
Route:   JobRunDetail
Sidebar: Solver GPU  (the Job is selected)
Crumbs:  Solver GPU / Run 2026-08-15 10:24
```

Both render the same run record. Navigating in one context must never silently
move the Explorer selection to the other.

### 9.3 Breadcrumbs

Every detail page must show clickable breadcrumbs.

Examples:

```text
Solver GPU / Run 2026-08-15 10:24
```

```text
Nightly Benchmark / Run 2026-08-15 10:24
```

```text
Nightly Benchmark / Run 2026-08-15 10:24 / Solver GPU
```

```text
Solver GPU / Run 2026-08-15 10:24 / Report
```

Each ancestor must be clickable.

A simple back arrow may additionally be shown, but breadcrumbs are the authoritative navigation.

---

## 10. Domain Types

The domain types live in `src/shared/world.ts` because both sides need them: the
main process builds them, the renderer reads them, and one definition is what
keeps the two from drifting.

Ids are plain strings. TypeScript has no newtype, and a branded type would buy
compile-time separation at the cost of every boundary — JSON, the socket, the
records on disk — needing a cast. The field name carries the meaning instead:
`jobId`, `runId`, `benchRunId` are never spelled `id` where the kind is
ambiguous.

```ts
export type EntityKind = 'Job' | 'Bench'
```

The unions below are serialized the way serde writes an externally-tagged enum —
a unit variant is a bare string, a struct variant is `{ Variant: { ...fields } }`.
This is not a TypeScript idiom; it is deliberate. It is the wire format the
records on disk and the agent socket already use (`design/CONVENTION.md`), so a
record written by either implementation is read by the other without a
translation layer.

### 10.1 Entity Kind### 10.1 Entity Kind

An entity is a folder holding a `coco.toml`; the manifest's own `kind` decides
which of the two it is.

### 10.2 Execution Status

```ts
export type RunStatus =
  | 'Starting'    // launch script spawned, no submission id yet (§3)
  | 'Pending'     // queued by the cluster, not yet running
  | 'Running'
  | 'Completed'   // finished; the report has not been taken yet
  | 'Analyzing'   // the report script is running
  | 'Succeeded'
  | 'Failed'
  | 'Cancelling'
  | 'Cancelled'
  | 'Error'       // coco could not carry out its own side of the protocol
```

`Completed` and `Analyzing` are the report's half of the lifecycle: a run whose
work is done but whose report has not been produced is not yet `Succeeded`,
because the user opens the report to find out what happened (§7.1).

`Error` is coco's own failure, not the experiment's — a poll that cannot be
spawned, a launch whose output never arrived, a report script that exits
non-zero. It must be told apart from `Failed`, which is the experiment's verdict.

`Unknown` is not a status. It should not permanently overwrite the last known
execution status.

Instead, query availability must be tracked separately.

### 10.3 Query Health

```ts
export type QueryHealth =
  | 'Healthy'
  | 'Delayed'
  | { Unavailable: { message: string } }
```

When query health is unavailable, the UI may present the display status as:

```text
Unknown
```

The detail page should still show:

```text
Last known status: Running
Last successful query: 38 seconds ago
```

This distinction is mandatory:

```text
Execution Failed ≠ Query Unavailable
```

### 10.4 Manifest State

```ts
export type ManifestState =
  | 'Valid'
  | 'Missing'
  | { Invalid: { message: string } }
```

An invalid or missing manifest disables Start.

### 10.5 Report State

```ts
export type ReportFormat = 'PlainText' | 'Html'

export type ReportState =
  | 'Unavailable'
  | 'Generating'
  | 'Missing'
  | { Available: { format: ReportFormat; text_bytes: number } }
  | { ReadError: { message: string } }
```

`Available` carries the report's **size, not its text**. A report can be
megabytes, the world is sent to the renderer on every change (§26), and a run
list has no use for the body. The text is fetched by its own request when the
viewer opens (§20), which is also the only place a read error can be raised
against the file as it is now rather than as it was at the last tick.

Format decides presentation, never availability. See §20.

Report state is independent from execution state.

A failed run may have a report.

A succeeded run may temporarily have no report.

### 10.6 Run Origin

Every Job run records how it was started, and every Bench run records who asked.

```ts
export type RunOrigin =
  | 'Human'
  | 'Agent'
  | {
      Bench: {
        name: string
        bench_id: string | null
        bench_run_id: string
        call: number
      }
    }

/** A Bench is never dispatched by another Bench (§2.2), so who asked for one
 *  gets a type that cannot say otherwise. */
export type Trigger = 'Human' | 'Agent'
```

Exactly one of the three is true of any run, so the history's Source column is
one column with three kinds of value rather than two columns (§13.3): the Bench
name as a link, or `you`, or `agent`.

Origin is recorded at dispatch, not worked out at read time. Reconstructing it —
finding the Bench by name and scanning its members for this run — has to invent
an answer when the Bench folder is gone, and a run that outlives its Bench then
shows a confident wrong call number instead of the name it was dispatched under.
`name` and `call` are therefore recorded; `bench_id` is resolved for navigation
only, and is `None` once the Bench has left the Explorer — the run keeps its
history, the link simply stops being a link.

`call` counts from 1, as the plan's own validation errors count (§15.4). The
same call must not have two numbers.

Who asked is a property of the surface the request arrived through, and only
that surface knows it: the workbench records `Human`, and an interface built for
an agent records `Agent`. It is a parameter of the start operation rather than
something the engine decides.


Origin is presentation and navigation metadata only. It must not change how the
run executes, and it must not exclude the run from the owning Job's history.

### 10.7 Bench Plan

```ts
export interface BenchPlanStep {
  index: number
  job_id: string
  parameters: string
  run_id: string
}

export interface BenchPlan {
  steps: BenchPlanStep[]
}
```

`job_id` must resolve to a Job that exists in the Explorer. The plan holds a
reference, never an embedded copy of the Job definition.

The same `job_id` may appear in several calls with different `parameters`.
Identity within a plan is `index`, never `job_id`.

`index` fixes display order only. It implies no execution order.

---

## 11. Explorer Sidebar

### 11.1 Views

The sidebar hosts two views, selected from the activity bar (§8.2).

**Explorer.** The Benches and Jobs the user has added, grouped by kind (§11.2). This is the only persistent navigation surface. It carries no filter field: the Explorer is a short, fully visible list of folders the user added themselves. The run-history filters of §22.4 and the report search of §20.2 are unaffected.

**Active Runs.** Everything started and not yet finished. Top-level runs only: a Bench run appears once, never once per dispatched child, matching the count of §21. Rows show the entity name and the run's status badge, and navigate to that run's detail page, where Cancel lives. When nothing is running, show a subtle `Nothing is running.` note rather than an error.

### 11.2 Grouping

Display separate groups:

```text
BENCHES
JOBS
```

Empty groups may be hidden or show a subtle empty label.

### 11.3 Entity Row

Each entity row shows:

- Type indicator.
- Display name.
- Active-run count when greater than zero.
- Last-run status when there is no active run.
- Invalid-manifest warning when applicable.

Priority:

1. Active-run count.
2. Invalid-manifest warning.
3. Most recent completed status.
4. No status indicator for never-run entities.

Example:

```text
Nightly Benchmark       1
Solver GPU              Failed
Post Process
Invalid Experiment      Invalid
```

Do not rely on color alone.

Use an icon or text together with semantic color.

### 11.4 Selected Row

The selected row must have a clear background highlight.

It must remain selected when viewing:

- A run.
- A run dispatched by that Bench.
- A report.

### 11.5 Add Folder

`Add Folder` is a secondary action. It is reached from the `+` icon button in the Explorer view's title row (§8.3), and from the Empty Explorer page's button (§12).

Clicking it opens the operating system's own folder picker. Nothing stands between the click and the picker, and a path is never typed by hand. Cancelling the picker does nothing at all.

What the chosen directory registers:

- It carries a `coco.toml` manifest: the directory itself.
- It does not, but folders beneath it do (searched three levels down, skipping hidden directories and generated `runs/` and `report/` state): every such folder. One pick therefore adds a whole directory of experiments — the bundled `mock/` library, say.
- No manifest anywhere below it: nothing. The pick is refused and says so.

A folder registers only if its manifest is usable at the moment it is picked. An unusable one is refused with the reason — a missing table, a name already taken, a folder that cannot be read.

A manifest that breaks *afterwards* is the opposite case: the entity stays in the Explorer, and its page shows the validation message with Start disabled (§13.1). It is an entity the user knows and has run, and dropping it out of the list would hide both the entity and the mistake. The rule is that the Explorer never gains a row that has never worked, and never loses one that used to.

A folder already in the Explorer is a no-op, never a duplicate.

Registering must immediately update the Explorer, select the first folder added, and report what was added and what was already there in the status bar.

Refusals are reported in a modal instead. One pick can name a whole directory of experiments, so refusals arrive as a list, each with its own reason; the status bar is a single line, which is exactly where those reasons are lost. A pick that refused nothing opens no modal.

The modal names the directory that was picked, since a refused folder is one of many the pick found, and lists each refusal with its reason. When the same pick also registered something, it says so — the pick partly worked, and the Explorer has already changed behind the modal.

```text
ADD FOLDER
Some folders were not added

Added 2 folders. 1 already in the Explorer.

~/experiments

NOT ADDED

  solver-copy: an entity named `solver-gpu` is already registered
  old-sweep: coco.toml: missing required table `[launch]`

                                                       Close
```

The modal only reports. It offers no retry and no partial undo: the pick is finished, and what it registered stays registered.

> **Known gap.** The workbench does not implement the scan. `addFolder` in
> `src/main/operations.ts` calls `engine.register()` on exactly the directory
> that was picked, and `register` requires a `coco.toml` in that directory
> itself. So one pick is one folder: picking `~/experiments` — or the bundled
> `mock/` — is *refused* rather than registering everything beneath it, and
> because a pick can only refuse one folder for one reason, the refusal-list
> modal above has nothing to list and does not exist. The status-bar and
> selection rules hold; the three-levels-down search, the hidden-directory
> skip, and the modal do not. `coco-egui/` implements this section in full
> (`experiment_folders` in `coco-egui/src/adapter/engine.rs`), so the intended
> behavior can be seen there.

---

## 12. Empty Explorer Page

When no entities exist, show:

```text
No jobs or benches have been added.

Add a folder containing a valid experiment manifest to begin.

[Add Folder]
```

The button opens the operating system's folder picker (§11.5).

The empty page must not look like an error.

---

## 13. Job Overview Page

The Job overview is the default page after selecting a Job.

### 13.1 Header

Show:

- Small `JOB` type label.
- Job display name.
- Folder path.
- Manifest validity.
- `Start Job` primary button.
- Optional overflow menu.

Example:

```text
JOB

Solver GPU                                      Start Job
~/Experiments/solver-gpu
```

When the manifest is invalid:

- Show the validation message.
- Disable Start.
- Explain why Start is disabled.

### 13.2 Active Runs Section

Place Active Runs above historical runs.

Heading:

```text
ACTIVE RUNS
```

If there are no active runs:

```text
No active runs.
```

Each active-run card shows:

- Status.
- Start time.
- Live duration.
- Parameters, truncated when necessary.
- Open action.
- Cancel action.

Example:

```text
Running

Started 10:24:31 · Duration 00:06:18
--mesh=256 --gpu=0

Open    Cancel
```

Runs are independent (§30). Any number of active-run cards may be displayed, and
Start is never disabled because a run is already active.

A card for a run dispatched by a Bench must show its origin:

```text
Running                          from Nightly Benchmark · Run 10:24

Started 10:24:31 · Duration 00:06:18
--mesh=256 --gpu=0

Open    Cancel
```

### 13.3 All Runs Section

Heading:

```text
ALL RUNS
```

Controls:

- Status filter.
- Parameter search.
- Manual Refresh.
- Optional result count.

Default sorting:

```text
Newest first
```

Job columns:

```text
Started
Parameters
Source
Status
Duration
Report
```

`Source` shows where the run came from:

```text
—                     started directly by the user
Nightly Benchmark     dispatched by that Bench
```

The Bench name is a link to the owning Bench run. Clicking it opens
`BenchRunDetail`; clicking anywhere else in the row opens `JobRunDetail`.

Bench-dispatched runs are ordinary history rows. Never hide them from the Job's
own history.

An origin filter (`All` / `Direct only` / `From a Bench`) is P1.

The entire row is clickable and opens Job Run Detail.

The Report cell may contain an `Open` button. Clicking `Open` goes directly to the Report Viewer without also triggering the row navigation.

Parameters are truncated in the table but shown in full on hover and in the detail page.

---

## 14. Bench Overview Page

The Bench overview follows the same hierarchy as the Job overview.

### 14.1 Header

Show:

- Small `BENCH` type label.
- Bench display name.
- Folder path.
- Manifest validity.
- `Start Bench` primary button.

A Bench has no static job list, so the header cannot state how many Jobs it will
dispatch. Show the size of the most recent run instead, and say so:

```text
BENCH

Nightly Benchmark                              Start Bench
~/Experiments/nightly-benchmark
Last run dispatched 6 runs
```

For a Bench that has never run:

```text
BENCH

Smoke Test                                     Start Bench
~/Experiments/smoke-test
Dispatched runs are determined at start
```

Never display a fixed job count as if it were a property of the Bench.

### 14.2 Active Bench Runs

Each card shows:

- Aggregate Bench status.
- Completed count.
- Total dispatched count.
- Progress bar.
- Start time.
- Duration.
- Open action.
- Cancel action.

There is no current step, because nothing is sequenced.

Example:

```text
Running

3 of 6 runs completed · 3 running
[######################------------]

Started 10:24:31 · Duration 00:14:18

Open    Cancel
```

The progress bar measures terminal children over total dispatched. It is a
completion ratio, not a position in a sequence.

### 14.3 Bench All Runs Table

Columns:

```text
Started
Parameters
Dispatched
Progress
Status
Duration
Report
```

`Dispatched` is the total number of runs the plan produced.

Progress format:

```text
3 / 6
```

Prefer an exact run count over a percentage-only display.

Clicking the row opens Bench Run Detail.

---

## 15. Start Page

Starting must happen on a page of its own, reached from the experiment and
addressed as `experiment > Start` in the breadcrumbs (§9.2).

Do not permanently display the parameter field on the overview page.

A start is a piece of work, not a dialog: it has parameters to fill, a check to
read, and a failure worth laying out. Earlier drafts of this specification put
it in a centered modal on the principle that a modal is a temporary action and
never a place (§9). The principle stands and the classification was wrong —
this one is a place, the trail says where it sits, and the failure it can
produce is a list rather than a sentence (§15.4).

Cancel confirmation stays a modal (§16): that one really is a temporary
question, answered and gone.

### 15.1 Contents

The Start page contains:

- The experiment's name as the title, under a small `START JOB` / `START BENCH`
  type label — the identity block an entity page uses (§13.1). The title takes
  the ordinary heading colour: the accent means "interactive" everywhere else in
  the workbench, so an accented title would read as a link.
- For a Bench, a note that the runs to dispatch are decided at start.
- A `PARAMETERS` section, marked `(all required)`, holding one field per
  declared parameter.
- The last-used shortcut as the section's one icon action, at the right of the
  `PARAMETERS` row — the shape the sidebar's title row already uses.
- Active-run notice when applicable, informational only and never blocking.
- Inline validation error.
- Back button, returning to the experiment's overview.
- Primary Start button.

The form keeps a measure of its own rather than filling the editor's width: a
declared parameter is a short value, and a field the width of the window invites
a paragraph.

For a Bench, the page cannot preview the plan — the plan does not exist until
Start is pressed. Do not display a fabricated job list.

Example:

```text
START JOB
solver-gpu

PARAMETERS  (all required)                          [history]

  nodes  [ required                                        ]
  gpu    [ required                                        ]

Cancel                                            Start Job
```

Every field opens empty, and `[history]` is the icon action that fills them from
the last run (§15.3). Start stays disabled until each one has a value.

What the user has typed is a draft held outside the route: a route is a place,
and a half-filled form is not one. Leaving the page discards the draft, and so
does a start that succeeds — coming back to Start opens the empty form §15.3
asks for. A restored route on relaunch lands on the experiment's overview
instead of a form whose values are gone.

### 15.2 Parameter Semantics

Each parameter value is a free-form UTF-8 string.

The application must not:

- Parse shell syntax.
- Split arguments.
- Execute the string.
- Validate command-line semantics.

Every parameter the manifest declares is required (convention §2.1). A value
that is empty or only whitespace counts as not supplied: Start is disabled, and
the disabled Start names what is still missing on hover. The requirement is
stated once, as `(all required)` beside the section title, rather than as a
running tally of empty fields beneath them; each empty field says `required` in
its own placeholder. An experiment that declares no parameters starts with
none.

The engine refuses a blank value exactly as it refuses a missing one, so a start
reaching it by any other route — a Bench dispatching a member, say — is refused
the same way.

### 15.3 No Prefill

The modal opens with every field empty. It does not prefill from the last run,
from the manifest, or from anything else — every declared parameter is supplied
by hand, deliberately, each time (convention §2.1).

Reusing the last run's values is an explicit action, not a default: the
`PARAMETERS` section carries a history icon that fills the fields and stops
there (§15.1). It appears only once the experiment has been started at least
once, and the user still sees, edits and submits the values themselves.

A prefilled field is indistinguishable from one the user filled, and a start is
a job on a cluster. Restarting *last night's* sweep because the modal
remembered it is a mistake this application must not be able to make for you.

### 15.4 Submission

On submission:

1. Disable the Start button.
2. Show `Starting…`.
3. Call the Start operation (§26).
4. On success:
   - Close the modal.
   - Create a new run.
   - Navigate immediately to its run-detail page.
5. On failure:
   - Keep the modal open.
   - Re-enable submission.
   - Show an inline error.

For a Bench, step 3 produces the plan, validates it against the Explorer (§2.3.2),
and dispatches every call. Plan validation failure is a Start failure: the modal
stays open, nothing is dispatched, and the error names **every** call that
cannot be dispatched, not the first one found.

A plan is generated by a script, so its mistakes arrive in batches: one wrong
parameter name is usually that same name in twenty calls. Reporting the first
one makes the user fix it, start again, and meet the second — so all of them are
checked and listed together, with a count that separates one typo from a plan
that is wrong throughout.

Example inline error:

```text
Cannot start this Bench. 3 of its 12 calls cannot be dispatched:

  call 2: `solver-xl` is not a registered job
  call 5: job `solver-gpu` — missing `gpu`, extra `device`
  call 9: `solver-xl` is not a registered job

No runs were dispatched.
```

### 15.5 Keyboard

Use the platform command modifier:

```text
macOS: Command + Enter
Linux: Control + Enter
```

to submit.

`Escape` does nothing here. A page is left, not dismissed: the Back button and
the breadcrumb above it both say where to.

Do not use plain Enter when focus behavior could cause accidental launches.

---

## 16. Cancel Confirmation Modal

Cancel is destructive and requires confirmation.

### 16.1 Job Copy

```text
Cancel this Job run?

Solver GPU
Started at 10:24:31
Running for 6 minutes.

The cancellation operation defined by the manifest
will be requested.

Keep Running                         Cancel Run
```

### 16.2 Bench Copy

```text
Cancel this Bench run?

Nightly Benchmark

All 4 runs still active will be cancelled.
2 runs have already finished and keep their results.

Runs of the same Jobs started outside this Bench
are not affected.

Keep Running                       Cancel Bench
```

### 16.3 Behavior

After confirmation:

1. Close the confirmation modal.
2. Set status to `Cancelling`.
3. Keep the user on the current detail page.
4. After the mock transition, set status to `Cancelled`.
5. If the mock operation fails, restore the prior status and display an error.

Never immediately label a run `Cancelled` before the cancellation transition completes.

---

## 17. Job Run-Detail Page

Clicking a Job history row opens a full Job run-detail page in the main region.

### 17.1 Header

Show:

- Breadcrumbs.
- Job name.
- Human-readable run time.
- Status pill.
- Cancel button only when cancellable.
- Open Report button when report is available.
- Optional overflow menu.

Example:

```text
Solver GPU / Run 2026-08-15 10:24

Running                                             Cancel Run
```

### 17.2 Overview Fields

Show:

```text
Run ID
Started
Ended
Duration
Last successful query
Query health
Source
```

`Source` is `Started directly` or a link to the dispatching Bench run:

```text
Source    Nightly Benchmark · Run 2026-08-15 10:24 · call 4
```

Do not show an end time for an active run.

### 17.3 Parameters

Show the complete parameter string in a selectable, monospace block.

Do not truncate parameters on this page.

### 17.4 Status Section

For a normal running state:

```text
Running

The Job is currently being monitored.
Last successful query: 1 second ago.
```

For query failure:

```text
Status unavailable

Last known status: Running
Last successful query: 38 seconds ago.

The application could not retrieve the current status.

Retry Now
```

For execution failure:

```text
Failed

The Job reported a failed execution state.
```

These presentations must be visually distinct.

### 17.5 Report Section

Possible states:

```text
Report is not yet available.
Report is being generated.
Open Report
Report is missing.
Unable to read report: <message>
```

---

## 18. Bench Run-Detail Page

This page must use the full main-content width.

### 18.1 Header

Show:

- Breadcrumbs.
- Bench name.
- Run time.
- Aggregate status.
- Cancel Bench button when any child is still active.
- Open Bench Report button when available.

Do not show a current Job. Nothing is sequenced, so no call is "current".

### 18.2 Progress Summary

Show:

- Succeeded count.
- Running count.
- Failed count.
- Cancelled count.
- Total dispatched count.
- Progress bar over terminal children.

Example:

```text
3 succeeded · 2 running · 1 failed · 0 cancelled

[######################------------] 4 / 6 finished
```

There is no pending count after a successful start. Every call is dispatched
immediately, so a call is never waiting for its turn.

If a child has failed while others are still running, the header status stays
`Running` and the failure is visible in the counts. The aggregate does not become
`Failed` until every child is terminal (§2.3).

### 18.3 Dispatch Table

Use a full-width table listing every run the plan dispatched.

Columns:

```text
Call
Job
Parameters
Status
Started
Duration
Report
```

`Call` is the plan index. It is a stable label, not an execution order.

`Parameters` is mandatory in this table: a plan commonly dispatches the same Job
many times, and the parameter string is the only thing distinguishing those rows.

Example:

```text
1   Solver GPU      --mesh=64    Succeeded   10:24:32   00:01:12   Open
2   Solver GPU      --mesh=128   Succeeded   10:24:32   00:03:45   Open
3   Solver GPU      --mesh=256   Running     10:24:32   00:06:31   —
4   Solver GPU      --mesh=512   Running     10:24:32   00:06:31   —
5   Post Process    --all        Failed      10:24:32   00:00:07   Open
6   Generate Report --summary    Succeeded   10:24:32   00:00:44   Open
```

All start times are effectively identical, because all calls are dispatched
together. This is expected — do not treat staggered start times as a goal.

Sort by `Call` index by default. Sorting by status or duration is P1.

Clicking a row opens Bench Child-Run Detail.

Clicking a Report button opens that run's Report Viewer.

Running rows may be emphasized, but no row is "the active step".

### 18.4 Bench Parameters

Show the complete Bench input parameter string above the dispatch table, in a
monospace selectable block.

This is the string the user typed. Each dispatched run has its own derived
parameter string, shown per row in the table and in full on its detail page. Do
not conflate the two.

---

## 19. Bench Child-Run Detail Page

A run dispatched by a Bench gets a complete detail page, reached from the Bench
run's dispatch table.

This page and `JobRunDetail` render **the same run record** (§2.3.1). They must
present identical facts. The only differences are breadcrumbs, the Explorer
selection, and the link back to the Bench run.

The page must show:

- Breadcrumbs back to the Bench run.
- The Job's name, linking to that Job's own overview.
- Call index within the plan.
- Execution status.
- Start time.
- End time when applicable.
- Duration.
- The parameters the Bench derived for this call.
- Query health.
- Report state.
- Cancel action while the run is active.

Cancelling here cancels this one run. It does not cancel the Bench run and does
not touch sibling runs.

The sidebar must continue highlighting the parent Bench.

Example breadcrumb:

```text
Nightly Benchmark
/ Run 2026-08-15 10:24
/ Solver GPU --mesh=256
```

When a plan dispatches the same Job several times, the breadcrumb leaf must
disambiguate — by parameters, by call index, or both. `Solver GPU` alone is
ambiguous and unacceptable.

The Job named here **is** the Explorer's Solver GPU entry — that is the corrected
model. But arriving through the Bench must not move the Explorer selection to it.
Offer navigation to the Job explicitly instead: clicking the Job name opens that
Job's overview and, at that point, selects it in the Explorer.

---

## 20. Report Viewer

Reports come in two formats, and the application controls neither their content
nor their styling:

```text
Plain text   rendered in-app
HTML         rendered in-app, in a sandboxed frame
```

An experiment writes whatever report it writes. Two HTML reports from two
experiments may share no styling at all, and any in-app approximation of them
would misrepresent them — so coco does not approximate. It renders the file.

The renderer is a browser engine, which is what makes this possible; the egui
implementation had to hand an HTML report to the system browser instead, and
§5.1 named exactly this as the thing that would re-open the framework question.
It did.

**The frame is the boundary.** The body goes into an `<iframe>` by `srcdoc`,
with `sandbox="allow-scripts"` and nothing else. `allow-scripts` is granted so
that a charting report — the common case for a benchmark — works at all.
`allow-same-origin` is deliberately withheld: without it the frame is an opaque
origin, so the report cannot reach coco's storage, its DOM, or `window.coco`.
A report is a file some experiment's script wrote, and it is treated as
untrusted input, not as part of the application.

The report's text is not part of the world (§10.5). The viewer asks for it by
run, and the read happens then, so a file deleted or broken since the last tick
raises its error at the moment the user asks to see it.

The viewer opens in the full main-content area.

### 20.1 Header

Show:

- Breadcrumbs.
- Report title.
- Run ID or human-readable run time.
- Copy button.
- Wrap Lines toggle.
- Optional Open Externally button.

### 20.2 Search

Provide:

- Search input.
- Match count.
- Previous match.
- Next match.

P0 does not require advanced syntax or regex.

Search is case-insensitive by default.

Exact visual text highlighting is optional, but match counting must work.

### 20.3 Plain-Text Body

Requirements:

- Read-only.
- Selectable.
- Monospace.
- Vertically scrollable.
- Supports very long lines.
- Wrap toggle, off by default.
- Does not edit backend data.

With wrapping off, rows are uniform height, so only visible rows need laying
out. A report of several thousand lines must stay responsive (§35).

Do not display the report inside a small modal.

### 20.5 HTML Body

The page must:

- State plainly that the report is HTML and why it opens elsewhere.
- Offer `Open in Browser` as the primary action.
- Offer the source, so search and copy still work without leaving the app.

Do not attempt to render a subset of HTML in-app. A partial rendering of an
unknown stylesheet looks like a broken report, not a simplified one.

### 20.4 Copy

`Copy` copies the complete report text to the clipboard.

Show a small temporary confirmation such as:

```text
Report copied.
```

---

## 21. Global Active Runs Indicator

The active-run count appears in two places, and both update automatically:

- The activity bar's `Active Runs` badge (§8.2).
- The bottom status bar, worded `No active runs`, `1 active run`, or `N active runs` (§8.5).

A Bench run counts once, not once per dispatched child, so a fifty-call sweep reads as one thing the user started.

The list itself is the `Active Runs` sidebar view (§11.1), not a popup. It is persistent and non-modal, reached from the badge's own icon, and each row navigates to the run's detail page — where the run's duration, progress, and Cancel action already live.

```text
ACTIVE RUNS

Nightly Benchmark              Running
Solver GPU                     Running
```

---

## 22. Run-History Table Behavior

Job history, Bench history, and Bench dispatch tables share one table
treatment. The rules below are requirements on that treatment, not on any
particular layout primitive.

> **Known gap.** The current implementation renders these as a plain `<table>`
> under automatic layout, with no sticky header and no declared column widths.
> Durations are monospaced, so digits do not shift, but a duration crossing
> `9s` → `10s` still gains a character and can move the columns beside it, and
> a long history scrolls its header away. §22.1's "fixed header", "vertically
> scrolling body", "no horizontal layout jitter" and "stable status-column
> width" are therefore specified but not yet met.

### 22.1 General Rules

- Fixed header.
- Vertically scrolling body.
- Newest runs first.
- Consistent row height.
- Entire row is clickable.
- Hover state.
- Selected or focused state where applicable.
- No horizontal layout jitter when durations update.
- Stable status-column width.
- Stable Report-column width.

### 22.2 Suggested Column Behavior

Job history:

```text
Started: fixed or initial width
Parameters: remainder
Source: fixed
Status: fixed
Duration: fixed
Report: fixed
```

Bench history:

```text
Started: fixed or initial width
Parameters: remainder
Dispatched: fixed
Progress: fixed
Status: fixed
Duration: fixed
Report: fixed
```

Bench dispatch:

```text
Call: fixed
Job: fixed or initial width
Parameters: remainder
Status: fixed
Started: fixed
Duration: fixed
Report: fixed
```

### 22.3 Long Parameters

In tables:

- Truncate with ellipsis.
- Show full text on hover.
- Show complete text in details.

### 22.4 Filtering

Job and Bench overview pages support:

- Status filter.
- Parameter text search.

Filters affect All Runs only, not Active Runs.

### 22.5 Dataset Size

The demonstration library must support at least 500 history rows without making
the UI unusable.

A Bench plan must support at least 50 dispatched runs, since a parameter sweep is
the primary use case. The dispatch table must stay usable at that size.

A drive scenario (§28) may start a larger dataset to check this.

---

## 23. Status Presentation

Use both text and visual indicators.

Do not rely on color alone.

Recommended semantics:

```text
Starting      neutral/blue animated or pulsing indicator
Pending       muted
Running       blue
Succeeded     green
Failed        red
Cancelling    amber
Cancelled     gray
Unknown       amber/question indicator
```

Avoid emoji whose rendering varies across operating systems.

Prefer:

- Painter-drawn circles.
- Simple check or cross glyphs.
- Text labels.

Status colors must remain legible in both dark and light themes.

---

## 24. Visual Design

The visual style should be:

- Professional.
- Dense but readable.
- Desktop-oriented.
- Similar in information density to an IDE or developer tool.
- Minimal.
- Free of decorative gradients.
- Free of large marketing-style cards.
- Free of excessive rounded corners.
- Free of unnecessary animation.

### 24.1 Hierarchy

Use:

- Large page title.
- Small uppercase type label.
- Section headings.
- Subtle separators.
- Compact status pills.
- Monospace text for parameters, IDs, paths, and reports.

### 24.2 Spacing

Use an approximately 8-point spacing system.

Suggested values:

```text
Small gap: 4
Normal gap: 8
Section gap: 16
Large page gap: 24
Card padding: 10–12
```

### 24.3 Theme

Default to the operating-system theme.

Provide a three-way choice in the activity bar's gear menu (§8.2), under a `Color Theme` heading:

```text
System
Light
Dark
```

The choice persists across launches. No custom theme editor is required.

The palette and metrics follow Visual Studio Code's two built-in default themes — **Light Modern** and **Dark Modern**. Palette token names match VS Code's `workbench.colorCustomizations` keys, so any value can be checked against the upstream theme file.

Each status carries a separate light and dark value rather than one value reused across both themes (§23).

### 24.4 Path Display

Use:

```text
~/Experiments/solver-gpu
```

rather than platform-specific absolute mock paths.

Full path text must be selectable.

---

## 25. Keyboard and Focus Behavior

Required:

```text
Command/Control + Enter   Start from the Start page
Escape                    Close current modal
Command/Control + F       Focus report search when in report viewer
```

Optional:

```text
Alt + Left                Navigate to parent route
Command + [               Navigate to parent route on macOS
F5                        Manual refresh
```

Focus requirements:

- Opening the Start page focuses the parameter field.
- Opening report search focuses the search field only when explicitly invoked.
- Closing a modal returns focus to the action that opened it when practical.
- Keyboard focus must not remain trapped after a modal closes.

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
removeFolder(engine, entityId): RemoveFolderResult
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
folders stay the record (`design/CONVENTION.md`) without being on the read path.

Each refresh tick runs a reconcile pass that pulls hand-edited files back in by
mtime. A file edited by hand between two ticks while coco writes the same run is
a lost update, and that is accepted: coco is a single local instance and the
alternative is a locking protocol over a directory tree.

`store.json` persists only what is not in the folders — the registered folders,
each experiment's `last_args`, and the run-id counter.

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

## 28. Development Controls

There are no mock controls, because there is no mock: state advances because a
real script said so. What replaces them is a way to drive the real application.

`npm run drive scripts/scenarios/<name>.mjs` launches the **built** app under
Playwright over Electron's own binary and runs a scenario against it — the
"click it and look" path, not headless CI. A scenario is a module exporting
`run({ page, app, shot, log, waitText })`.

A drive run is fully isolated from the real one, and must stay that way:

```text
COCO_STORE_PATH      a scratch store    — the two cocos must not race the run-id counter
COCO_UI_STATE_PATH   a scratch layout   — a drive run must not move the user's window
COCO_SOCKET_PATH     a scratch socket   — must not take the socket a real coco answers on
```

The library is seeded as a private copy of `mock/`, never the user's own.

Scenarios cover: add-folder, remove-folder, cancel, cancel-bench, bench-child,
report, notice, menu, persistence, agent, agent-busy.

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

## 30. Run Independence

Runs are always independent. A Job may have any number of active runs, and every
run is fully isolated from every other.

There is no `allows_concurrent_runs` flag and no concurrency policy in this
phase. Do not add one.

Consequences:

- Start is never disabled because a run is already active.
- A Bench dispatching a Job never conflicts with, waits for, or is blocked by any
  other run of that Job.
- The same Job may simultaneously have a directly-started run and several runs
  dispatched by one or more Benches.
- Cancelling any run affects only that run.

When an active run already exists, the Start page may show an informational
notice. It must not block submission:

```text
2 runs of this Job are already active.
Starting will create another independent run.
```

The button may read `Start Another Run` in that case. This is wording only.

---

## 31. Error Handling

Errors must be shown near the relevant operation.

### Start Failure

- Stay on the Start page.
- Show inline error.
- Preserve parameter input.
- Allow retry.

### Cancel Failure

- Keep the user on the detail page.
- Restore the previous execution status.
- Show a visible error notification.

### Query Failure

- Do not mark execution Failed.
- Display Unknown/query unavailable.
- Show last known execution state.
- Show last successful query time.
- Provide Retry Now.

### Invalid Manifest

- Keep entity visible in the Explorer.
- Show specific validation reason.
- Disable Start.

### Missing Entity

If a route references a removed entity:

- Return to Empty Explorer or the first available entity.
- Do not panic.

### Missing Run

If a route references a missing run:

- Return to the owning entity overview.
- Show a temporary message.
- Do not panic.

### Report Read Error

Show:

```text
Unable to read report.

<error message>
```

Keep the user on the report or detail page.

---

## 32. Persistence

The window's own arrangement lives in `ui-state.json` in Electron's `userData`
directory, written by `src/main/uiState.ts`. It is a **second, smaller file**
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
│   │   ├── uiState.ts             #   ui-state.json (§32)
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
│           ├── theme.css          #   the design system (design/UI-SYSTEM.md)
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
design/           CONVENTION.md (the folder contract), UI-SYSTEM.md
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
  sidebarWidth: ...,                // arrangement, persisted (§32)
  reportWrap: ...,
  nowMs: Date.now()                 // the clock durations tick off
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
- A timer per run. One clock updates `nowMs`; durations are computed from it.
- Blocking the main process. It answers IPC, serves the agent socket, and runs
  the tick; a synchronous read of a large file there stalls all three.
- Re-bootstrapping to recover from a missed event. If events can be missed, the
  protocol is wrong (§26.3).

The world is re-sent as **entries**, never as a whole, after the first message.
This is the v1 protocol: entry-level over-push. It is sized for a local library
of tens of experiments, and the note on the v2 keyed protocol records what would
justify moving to it.

---

## 36. Accessibility and Usability

Required:

- Do not communicate status with color alone.
- Provide hover text for truncated values.
- Use reasonable contrast in both themes.
- Maintain visible keyboard focus.
- Use selectable text for IDs, paths, parameters, and reports.
- Use clear destructive wording for Cancel.
- Use `Remove from Explorer`, never `Delete Folder`.
- Do not silently discard parameter drafts.
- Do not hide query errors.

The application does not need full screen-reader certification, but controls
should carry meaningful accessible names, and a clickable row should be
reachable and activatable from the keyboard.

---

## 37. Testing

Tests run under vitest against **real temp folders and real executable
scripts** — never mocks of the filesystem or of a process. The shared fixtures
live in `mock/.fixtures/` (see its README); a suite copies one, points it at a
scratch store, and drives it.

The end-to-end scenarios are ports of the egui implementation's suite, so both
engines answer the same questions and a divergence shows up as a failing test
rather than as a surprise.

Current coverage: 190 cases across 16 files — `engine`, `manifest`, `template`,
`invoke`, `status`, `store`, `words`, `world`, `operations`, `serial`, `sync`,
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
npm run check      # svelte-check on the renderer, tsc --noEmit on main + preload
npm test           # vitest
npm run build      # the three bundles
```

Run these on both macOS and Linux where CI is available.

> **Known gap.** There is no linter and no formatter. The egui implementation
> gated on `cargo fmt --check` and `cargo clippy -D warnings`; nothing equivalent
> is configured here, so style and the class of bug clippy catches are unenforced.
> Adding ESLint and Prettier, and putting all three commands behind one gate, is
> outstanding work.

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

## 39. README Requirements

The README must contain:

### Overview

- What coco is: a workbench over experiment folders on the local machine.
- Job and Bench concepts, stating explicitly that a Bench fans out to existing
  Jobs and is not a pipeline.
- That the folder is the record — coco keeps no database (`design/CONVENTION.md`).
- Screens implemented.
- That `coco-egui/` is the superseded first implementation (§5.1).
- A note that the working name contains "Pipeline" for historical reasons only.

### Run Instructions

```bash
cd coco-electron
npm install
npm run dev
```

and, for a real application bundle:

```bash
npm run package        # electron-builder, unsigned
```

Document any required Linux distribution packages. Do not add external runtime
dependencies beyond Node and npm for development.

### Test Instructions

```bash
npm run check
npm test
npm run drive scripts/scenarios/cancel.mjs      # drive the built app (§28)
```

### Architecture

Briefly explain:

```text
renderer (Svelte)  — renders, asks; holds no domain
    ↕ window.coco  — the typed bridge, the page's whole vocabulary
main process       — operations → serialized turns → engine
    ↕ folders      — coco.toml, runs/*/run.json, report/
```

and that `src/main/engine/` imports nothing from Electron, which is what keeps
it testable and portable (§33).

---

## 40. Current State and Outstanding Work

The workbench is built. What follows is the standing list, not a build order.

**Working:** the engine port in full — manifests, templates, the job lifecycle,
the poll protocol, auto and manual reports with ERROR healing, cancel, bench
plan and fan-out, derived bench status, orphan detection, shutdown grace.
Memory as the truth with write-through and mtime reconcile (§26.1). Event-driven
sync (§26.3). Notices (§26.4). The agent socket and the MCP binary (§43). The
persisted arrangement (§32). Explorer, overview, start, run detail, bench run
detail, bench child detail, report viewer for both formats, add and remove
folder, cancel with confirmation. The application menu and an electron-builder
package.

**Outstanding:**

- No linter or formatter, and no single gate command (§37.4).
- Add Folder does not scan a directory for experiments (§11.5). One pick is one
  folder, so the bundled `mock/` library must be registered folder by folder,
  and the refusal-report modal is unbuilt.
- Run-history tables do not meet §22.1: no sticky header, no stable column
  widths.
- The agent interface has no cancel, no registration, and no event stream
  (§43.6).
- Linux has not been exercised: neither the build nor the rendering comparison
  §5.1 flags as the one measurement that could revise its own record.
- Packaging is unsigned; no notarization, no auto-update (§4.2).

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

## 43. Agent Interface

An agent asks coco to do things. It never runs an experiment's scripts itself,
and it never touches the store: coco is the one owner, and the owner is the
window (§9).

### 43.1 Availability

The interface exists only while coco is running. That is a decision, not a
limitation to be worked around. A run started through it belongs to the store
the user is looking at, and appears there exactly as a click's run does.

An agent therefore cannot act while coco is closed. What coco must do instead is
catch up on the way back up: a run in flight when the window closed is polled on
the first refresh, and if the cluster finished it, the stage that follows runs
(§10).

### 43.2 Transport

A Unix domain socket at a fixed path — `$HOME/.local/share/coco/coco.sock`,
overridable with `COCO_SOCKET_PATH` for development.

A socket rather than a TCP port: there is no port to discover, publish, or
collide over, nothing else on the machine reaches it by accident, and the
filesystem's own permissions decide who may. Socket paths are bounded well below
a filesystem's path limit, so a failure to bind is reported with the path in it.

The wire format is HTTP/1.1, so `curl --unix-socket` is the whole client
library. In the workbench the protocol is spoken by Node's own `http` server
bound to the socket path; the egui implementation used `tiny_http`. Either way
parsing, framing, and status lines are common code rather than coco's own. What
stays coco's is what no
library decides — who may bind the socket, when the file goes away, and where a
request's answer comes from. Request bodies are capped at 64 KiB; a larger
declared length is answered `413` before a byte of it is read.

Failing to bind is not fatal. Another coco already owns the socket, or the
directory is not writable; either way the workbench is still a workbench, and it
says so in the log. A socket file with nothing listening behind it is a crash's
leftover and is replaced. One with a live coco behind it is not: the second
window runs without an interface rather than stealing the first's.

### 43.3 Path through the application

Every request is handed to the engine's one owner — the worker thread that
also executes the commands from the screen. An agent's start takes the same
call a click takes — the same validation, the same origin stamping (§10.6),
the same screen update. There is no second way into the engine to keep in step
with the first.

Reads are answered from the snapshot the worker publishes after each pass, so
they never wait on one. Writes wait, because the engine has one owner and the
socket thread is not it. A wait that outlives its welcome is answered `503`
rather than left hanging.

### 43.4 Surface

```text
GET  /help                         what this is, and every route, from the tool itself
GET  /world                        the world, as §26.1's dump prints it
GET  /jobs                         every Job: name, folder, parameters, run tallies
GET  /benches                      every Bench, same shape
GET  /jobs/{name}                  one Job and its runs, with file locations
GET  /benches/{name}               one Bench, its runs, their calls and locations
POST /experiments/{name}/runs      {"parameters": {…}} → 201 {"run_id": "…"}
```

Experiments are addressed by name, which is unique across the Explorer
(convention §5): an agent should not have to know folder paths.

The interface describes itself: `/help` names every route, so an agent can
discover the surface from the surface. It lives beside the routes in the code,
where the description and the behaviour cannot drift apart unnoticed.

**Locations, not contents.** Every caller is on this machine (§43.2), so a
detail response points at files — the experiment folder, a run's directory and
`run.json`, the report file when one exists — rather than carrying their
bytes. An agent reads those paths directly; the socket stays a control channel
and never becomes a file server.

A refusal carries the workbench's own text, unchanged — an agent reading it sees
what a person would have been shown — under the status that says who can act:
`404` for something that is not there, `400` for a request that was refused,
`503` when coco did not answer. A name asked for as the wrong kind is pointed at
the right route rather than flatly refused.

### 43.5 The MCP binary

`coco-mcp-server` serves this same surface as MCP tools (`coco_help`,
`coco_list_jobs`, `coco_job`, `coco_start`, …) so an agent runtime speaks to
coco through its own tool protocol instead of raw HTTP. An agent's MCP client
launches the binary and speaks JSON-RPC over stdio; every tool call becomes
one request over the socket, and the socket's answers pass through verbatim.
It decides nothing — it is a translator, and the window must still be running
for it to answer. The MCP subset it needs (initialize, tools/list, tools/call,
one JSON message per line) is written out by hand rather than taken from an SDK.

The binary is Rust and lives in its own crate, `coco-mcp/` — `cargo build`
there, and nothing else is needed: its only dependency is `serde_json`, and it
imports nothing from either workbench.

That independence is the design, not an accident of packaging. It speaks the
socket protocol of §43.2 and nothing else, and both implementations serve that
protocol identically, so it never had to know which coco was listening — it
drives the Electron workbench **unchanged**, which is why it outlived the
implementation it was written in. Its tests answer the socket with a stub for
the same reason: the boundary this crate owns is whether a tool call becomes the
right request and whether the answer returns as tool content, and tying that
test to a live engine would tie the one artifact meant to outlive both to
whichever one is currently alive.

It remains the repository's only Rust that is still developed. Porting it to
Node would remove the last build dependency on a Rust toolchain; nothing
requires that.

### 43.6 What is not here

No approval step and no separate notification: a run records who asked (§10.6),
and that record is where the question is answered. No authentication: the socket
is reachable only by processes that can open the file, and coco runs on the
user's own workstation. No cancel, no registration, and no event stream yet —
each is one route, one request variant, and one worker arm away when a real
agent needs it.

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
- Records stay byte-compatible with `coco-egui/`.

**Checks**

- `npm run check` succeeds.
- `npm test` succeeds.
- `npm run build` succeeds.
- README instructions reproduce the build on macOS.

---

## 45. Working on coco

This document describes a workbench that exists. Read it as the standing
description of what coco is and why, not as a build order — §40 carries what is
outstanding.

Two things are worth knowing before changing anything.

**The folder is the record.** coco keeps no database. An experiment folder holds
its own manifest, its own runs, and its own reports (`design/CONVENTION.md`), and
both implementations write them identically. A change that makes a folder less
portable between them is a regression even when every test passes.

**The boundaries in §41 are the design.** The domain in the main process, the
renderer as a client, the backend as the only judge of change, one turn at a
time on the engine, the page's vocabulary fixed at the preload — each of these
was arrived at for a reason recorded somewhere in this document, and the
security argument in §5.1 rests on the last of them.

Where a detail is not specified, choose the simplest implementation that
preserves the product principles here, and record the decision — in the README
if a user would meet it, in this document if a future change would otherwise
re-argue it.
