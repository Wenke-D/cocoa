# coco  
## Interactive Rust/egui Prototype Specification

**Document status:** Implementation-ready prototype specification  
**Primary production platform:** Linux desktop  
**Mandatory prototype platforms:** macOS and Linux desktop  
**UI framework:** Rust, eframe, egui, egui_extras  
**Backend for this phase:** Deterministic MockBackend only  
**Crate name:** `coco`  
**Application title:** `coco`

> **Naming note.** The system is named **coco**. The earlier working title
> "Experiment Pipeline Manager" is retired: "Pipeline" was a misnomer under the
> Bench model in §2.2 — a Bench fans out, it does not sequence.

---

## 1. Mission

Build a fully interactive desktop UI prototype for managing local experiments.

The application manages two kinds of entities:

1. **Job**
2. **Bench**

Both entities will eventually exist as folders on the local computer. Each folder will contain a manifest that defines how the application starts, queries, and cancels a run.

The prototype must not implement the real manifest or process logic. It must reproduce the complete user experience using deterministic mock data and simulated state transitions.

The prototype must allow a user to:

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
12. Simulate successful, failed, cancelled, and unavailable-query states.

The result must be a real, runnable egui application rather than a static mockup.

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

The prototype must not duplicate run records to serve both views.

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
act on now. A run whose launch was still in flight when coco closed is found
on the next refresh and moved to `ERROR`: the stdout that carried its
submission id died with the process that read it.

Starting a Bench returns a **plan** — a list of `(existing Job, parameters)` calls,
all dispatched at once. The Bench itself executes nothing; it fans out to Jobs.
Each dispatch is an ordinary Job Start.

For this prototype:

- **Start** is triggered by the user.
- **Cancel** is triggered by the user after confirmation.
- **Query** is automatic and simulated by the MockBackend.
- Query must not be presented as a primary user action.
- A small manual Refresh action may be provided as a fallback.

Report retrieval is treated as read-only data access rather than an experiment operation.

---

## 4. Scope

### 4.1 P0 Requirements

The first implementation must include:

- Native macOS application.
- Native Linux application.
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
- Plain-text report viewer.
- Active Runs section.
- All Runs table.
- Bench dispatch table.
- Breadcrumb navigation.
- Mock data.
- Mock run-state progression.
- Mock query failure.
- Mock report generation.
- Active Runs sidebar view.
- Status filtering in run history.
- Window resizing.
- Keyboard interaction.
- Light and dark theme compatibility.
- Basic persistence of UI preferences.
- Unit tests for backend state transitions.
- README with macOS and Linux run instructions.

### 4.2 Optional P1 Features

The following may be added after all P0 requirements work:

- WASM build.
- Sortable table headers.
- Column-width persistence.
- Keyboard selection inside tables.
- Context menu for removing an item from the Explorer.
- Visual snapshot tests.
- macOS application bundle.
- Linux AppImage or package.

### 4.3 Explicit Non-Goals

Do not implement any of the following in this phase:

- Real manifest parsing.
- Real folder scanning.
- Real filesystem watchers.
- Real folder picker.
- Real process execution.
- Real shell commands.
- Real remote execution.
- SSH.
- Slurm.
- Real polling.
- Real cancellation signals.
- Process stdout or stderr capture.
- Authentication.
- User accounts.
- Network server.
- Database.
- React.
- Tauri.
- Electron.
- Flutter.
- Qt.
- A separate HTML/CSS prototype.
- DAG editing.
- Pipeline editing.
- Drag-and-drop pipeline construction.
- Production packaging.
- Code signing.
- macOS notarization.
- Auto-update.
- System tray integration.
- Notification-center integration.
- Plugin architecture.
- Full localization.

Do not allow these non-goals to delay the interactive prototype.

---

## 5. Technology Baseline

Use the following baseline:

```toml
[package]
name = "coco"
version = "0.1.0"
edition = "2024"
rust-version = "1.95"

[dependencies]
egui = "=0.36.1"
eframe = { version = "=0.36.1", features = ["persistence"] }
egui_extras = "=0.36.1"
serde = { version = "1", features = ["derive"] }
chrono = { version = "0.4", features = ["serde", "clock"] }
log = "0.4"

[target.'cfg(not(target_arch = "wasm32"))'.dependencies]
env_logger = "0.11"
```

The exact egui-family versions must be pinned. Commit `Cargo.lock`.

The `0.36.1` baseline follows the current egui release line; the official eframe template uses Rust edition 2024, Rust `1.95`, native execution, optional persistence, and a shared native/web application structure.

Additional dependencies may be added only when clearly justified.

Do not introduce an async runtime such as Tokio in the prototype. The MockBackend must be synchronous and deterministic.

Use eframe’s default native rendering configuration. Do not hardcode an OpenGL-only, Metal-only, or Linux-only renderer.

### 5.1 Why Not a Web View

Tauri, Electron, and an embedded WebView are non-goals (§4.3, §20). The question was re-opened once the workbench was built, and closed again on measurement rather than on preference. The record, so that it does not have to be re-argued:

**Not for appearance.** Rendered side by side at 1280×820 on a 2× display — same palette, same metrics, same Inter cuts — egui and a web view are indistinguishable. macOS has drawn text with grayscale antialiasing since Mojave, so the system text stack holds no advantage there. What the workbench was missing was type weight, not a renderer (§24.1). This was not measured on Linux at 1×, where hinted system rendering may still differ, and a Linux comparison is the one thing that could revise this point.

**Not for text handling.** Labels are already selectable, and the report viewer already searches, highlights matches, and copies (§20).

**The engine would not move.** `src/engine/` renders an experiment’s templates into an argv list and executes it (convention §6, §7). Behind a web view that step has to be reachable from page script, and the scope wide enough to allow it is the scope that turns any injection into arbitrary command execution. Keeping it in Rust leaves the page a vocabulary of declared experiments and declared parameters, which is worth more than the language the engine happens to be written in.

**What would re-open it.** Reports needing rich rendering in-app. An HTML report goes to the system browser today (§20), which is right while the report is something the user reads elsewhere. If coco becomes the place where results are read and compared, the report viewer turns into a primary surface, and a web view is what renders one. Even then, embedding a web view for that one surface is a smaller change than moving the workbench onto it.

---

## 6. Supported Platforms

### 6.1 Mandatory

The application must build and run using:

```bash
cargo run
cargo run --release
```

on:

- macOS on the developer’s native architecture.
- Linux on the developer’s native architecture.

The implementation must not contain architecture-specific code that prevents either Apple Silicon or Intel macOS builds.

### 6.2 macOS Requirements

On macOS:

- Use the normal operating-system window frame and title bar.
- Do not implement a custom frameless title bar.
- Respect Retina/HiDPI scaling.
- Use platform-aware command shortcuts.
- Display `⌘`-style behavior through egui’s platform command modifier.
- Do not assume `/home/...` paths.
- Mock paths should use `~/Experiments/...`.
- Do not depend on Bash-specific commands.
- Do not depend on Homebrew packages to run the prototype.
- The application must remain usable at 100%, 150%, and Retina scaling.

### 6.3 Linux Requirements

On Linux:

- The same source tree must compile without UI forks.
- Do not hardcode macOS-specific paths or keyboard labels.
- Support normal window resizing.
- Preserve the application’s main two-column structure at small sizes.
- Document any system build dependencies in the README.

### 6.4 Optional WASM Target

WASM support is optional.

The architecture should not intentionally prevent a future WASM build, but WASM compatibility must not delay macOS or Linux completion.

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

Use an explicit route enum.

A suitable starting model is:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    EmptyExplorer,

    EntityOverview {
        entity_id: EntityId,
    },

    /// The start form (§15). Only the identity: what the user has typed is a
    /// draft held outside the route.
    StartRun {
        entity_id: EntityId,
    },

    JobRunDetail {
        job_id: EntityId,
        run_id: RunId,
    },

    BenchRunDetail {
        bench_id: EntityId,
        run_id: RunId,
    },

    BenchChildRunDetail {
        bench_id: EntityId,
        bench_run_id: RunId,
        child_run_id: RunId,
    },

    ReportViewer {
        context: ReportContext,
        run_id: RunId,
    },
}
```

Use a separate overlay enum:

```rust
#[derive(Clone, Debug)]
pub enum Overlay {
    None,

    ConfirmCancel {
        target: CancelTarget,
    },

    /// What an Add Folder pick refused (§11.5).
    AddFolderReport {
        picked: String,
        outcome: AddedFolders,
    },

    Settings,
}
```

Do not encode modal state inside `Route`.

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

Use strongly typed IDs.

```rust
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RunId(pub String);
```

### 10.1 Entity Kind

```rust
pub enum EntityKind {
    Job,
    Bench,
}
```

### 10.2 Execution Status

```rust
pub enum RunStatus {
    Starting,
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelling,
    Cancelled,
}
```

`Unknown` should not permanently overwrite the last known execution status.

Instead, query availability must be tracked separately.

### 10.3 Query Health

```rust
pub enum QueryHealth {
    Healthy,
    Delayed,
    Unavailable {
        message: String,
    },
}
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

```rust
pub enum ManifestState {
    Valid,
    Invalid {
        message: String,
    },
    Missing,
}
```

An invalid or missing manifest disables Start.

### 10.5 Report State

```rust
pub enum ReportFormat {
    PlainText,
    Html,
}

pub enum ReportState {
    Unavailable,
    Generating,
    Available {
        format: ReportFormat,
        text: Arc<str>,
    },
    Missing,
    ReadError {
        message: String,
    },
}
```

Format decides presentation, never availability. See §20.

Report state is independent from execution state.

A failed run may have a report.

A succeeded run may temporarily have no report.

### 10.6 Run Origin

Every Job run records how it was started, and every Bench run records who asked.

```rust
pub enum RunOrigin {
    Human,
    Agent,

    Bench {
        name: String,
        bench_id: Option<EntityId>,
        bench_run_id: RunId,
        call: usize,
    },
}

/// A Bench is never dispatched by another Bench (§2.2), so it gets a type that
/// cannot say otherwise.
pub enum Trigger {
    Human,
    Agent,
}
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

```rust
pub struct BenchPlan {
    pub steps: Vec<BenchPlanStep>,
}

pub struct BenchPlanStep {
    pub index: usize,
    pub job_id: EntityId,
    pub parameters: String,
    pub run_id: RunId,
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
3. Call the MockBackend Start operation.
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
HTML         opened in the system browser
```

An experiment writes whatever report it writes. Two HTML reports from two
experiments may share no styling at all, so any in-app approximation would
misrepresent them. The browser is the only thing that renders them faithfully.

Embedding a browser engine is out of the question — Tauri, Electron, and WebView
are non-goals (§4.3). The report is written to the operating system's temporary
directory and opened as a `file://` URL through the framework's own URL handler.
No shell command is run from the UI (§41).

This is the sole filesystem write in the prototype. No manifest is read and no
experiment folder is touched.

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

Use `egui_extras::TableBuilder` for Job history, Bench history, and Bench dispatch tables.

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

The mock fixtures must support at least 500 history rows without making the UI unusable.

A Bench plan must support at least 50 dispatched runs, since a parameter sweep is
the primary use case. The dispatch table must stay usable at that size.

A prototype developer control may generate a larger dataset.

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

## 26. Mock Backend

Implement a deterministic `MockBackend`.

The UI must interact with the backend through an interface rather than directly mutating fixture vectors.

A suitable interface is:

```rust
pub trait ExperimentBackend {
    fn snapshot(&self) -> BackendSnapshot;

    fn start(
        &mut self,
        entity_id: &EntityId,
        parameters: String,
    ) -> Result<RunId, BackendError>;

    fn cancel(
        &mut self,
        target: CancelTarget,
    ) -> Result<(), BackendError>;

    fn refresh(&mut self) -> Result<(), BackendError>;

    fn report(
        &self,
        run_id: &RunId,
    ) -> Result<Option<String>, BackendError>;

    fn tick(&mut self, now: chrono::DateTime<chrono::Local>);
}
```

Exact signatures may change, but the architectural boundary is mandatory.

`start` on a Bench entity performs the whole fan-out: it produces the plan,
validates it against the Explorer, dispatches every call, and returns the Bench
`RunId`. Plan production lives behind this boundary — the UI never builds a plan.

Because a Bench dispatch creates several Job runs at once, `start` must be atomic
from the UI's perspective: either the Bench run and all its child runs exist, or
nothing was created.

### 26.1 Snapshot Rule

The UI reads an immutable snapshot.

The UI must not mutate:

- Run status.
- Report text.
- Bench progress.
- Query health.

All domain changes pass through backend commands.

### 26.2 Immediate-Mode Command Handling

To avoid borrow conflicts during an egui frame:

1. Render from a snapshot.
2. Collect UI intentions as commands.
3. Execute commands after the relevant UI block has finished.
4. Update route or overlay state.
5. Request repaint when necessary.

A suitable command enum is:

```rust
pub enum AppCommand {
    SelectEntity(EntityId),
    OpenRun(RunId),
    OpenReport(RunId),
    OpenStartModal(EntityId),
    StartRun {
        entity_id: EntityId,
        parameters: String,
    },
    RequestCancel(CancelTarget),
    ConfirmCancel(CancelTarget),
    Refresh,
    AdvanceMockState,
    FailMockRun(RunId),
    ToggleMockQueryFailure(RunId),
    GenerateMockReport(RunId),
}
```

---

## 27. Mock State Progression

### 27.1 Job Start

Starting a Job creates a new run:

```text
Starting
→ Running
→ Succeeded
```

The prototype must also allow:

```text
Running
→ Failed
```

and:

```text
Running
→ Cancelling
→ Cancelled
```

### 27.2 Bench Start

Starting a Bench creates a Bench run plus one Job run per plan call, all at once.

Initial state:

```text
Bench: Starting

Call 1: Starting
Call 2: Starting
Call 3: Starting
...
```

Every call starts together. No call is ever `Pending`.

Progression: each child advances independently on its own mock schedule. The
mock must give children differing durations so the UI is exercised with children
finishing out of order.

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
a failed child must not stop its siblings.

### 27.3 Automatic and Manual Progression

Provide both:

1. Automatic progression mode.
2. Prototype-only manual controls.

Automatic mode may progress a run every few seconds.

Manual controls make testing deterministic.

### 27.4 Repaint Scheduling

While an active run exists:

- Schedule periodic repaint.
- Do not use a busy loop.
- Do not repaint continuously at maximum frame rate without reason.

When no animation, modal, or active run exists, allow normal idle behavior.

---

## 28. Prototype Developer Controls

Include a collapsible section or development menu visible only in the prototype.

Suggested label:

```text
Mock Controls
```

Actions:

```text
Advance selected run
Complete selected run
Fail selected run
Toggle query unavailable
Generate report
Remove report
Create 500 history rows
Reset demo data
Toggle automatic progression
Complete all children of selected Bench run
Fail one child of selected Bench run
Dispatch a 50-call sweep
```

These controls must not be visually confused with production actions.

They may appear:

- In a collapsible bottom section.
- In a top-bar developer menu.
- Behind a `Prototype` menu.

Do not put them inside normal run-history rows.

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

Use eframe persistence for limited UI preferences.

Persist:

- Theme selection.
- Sidebar width.
- Last selected entity ID.
- Last non-report route when valid.
- Status filter.

Do not persist:

- Anything about runs. The experiment folders hold their own records, and the
  engine's store holds the run counter and the values each experiment last used
  (convention §5) — the UI keeps no copy of either.
- Temporary modals.
- Temporary error banners.
- Parameter drafts. A modal is a temporary action; a draft survives a failed
  submission (§31) and nothing longer.

If persisted state is invalid after fixtures change, fall back safely.

---

## 33. Project Structure

Use a modular structure similar to:

```text
src/
├── main.rs
├── lib.rs
├── app.rs
│
├── model/
│   ├── mod.rs
│   ├── entity.rs
│   ├── run.rs
│   ├── status.rs
│   └── report.rs
│
├── backend/
│   ├── mod.rs
│   ├── traits.rs
│   ├── snapshot.rs
│   └── mock.rs
│
├── navigation/
│   ├── mod.rs
│   ├── route.rs
│   └── overlay.rs
│
├── fixtures/
│   ├── mod.rs
│   └── demo.rs
│
├── ui/
│   ├── mod.rs
│   ├── shell.rs
│   ├── top_bar.rs
│   ├── sidebar.rs
│   ├── status_bar.rs
│   │
│   ├── pages/
│   │   ├── mod.rs
│   │   ├── empty_explorer.rs
│   │   ├── job_overview.rs
│   │   ├── bench_overview.rs
│   │   ├── job_run_detail.rs
│   │   ├── bench_run_detail.rs
│   │   ├── child_run_detail.rs
│   │   └── report_viewer.rs
│   │
│   ├── overlays/
│   │   ├── mod.rs
│   │   ├── cancel_modal.rs
│   │   ├── add_demo_folder.rs
│   │   └── settings.rs
│   │
│   └── widgets/
│       ├── mod.rs
│       ├── breadcrumbs.rs
│       ├── status_badge.rs
│       ├── active_run_card.rs
│       ├── run_history_table.rs
│       ├── dispatch_table.rs
│       ├── parameter_block.rs
│       └── empty_state.rs
│
└── tests/
    └── state_transitions.rs
```

Exact module boundaries may be adjusted, but do not place the entire prototype in one file.

---

## 34. Application State

A suitable high-level model is:

```rust
pub struct ExperimentApp {
    backend: Box<dyn ExperimentBackend>,
    ui: UiState,
}

pub struct UiState {
    route: Route,
    overlay: Overlay,

    sidebar_search: String,
    run_search: String,
    status_filter: StatusFilter,

    sidebar_width: f32,
    theme: ThemePreference,

    report_search: String,
    report_wrap_lines: bool,

    transient_message: Option<TransientMessage>,
}
```

The application state and backend state must remain conceptually separate.

Do not let route changes modify execution state.

Do not let backend refreshes unexpectedly reset route state.

---

## 35. Performance Requirements

The prototype must remain responsive with:

- 500 historical runs.
- A Bench run that dispatched 50 concurrent child runs.
- Many simultaneously active runs across several Jobs.
- A report containing thousands of lines.
- A continuously updating duration field.

Avoid:

- Cloning complete long reports every frame.
- Rebuilding fixtures every frame.
- Sorting large history vectors every frame without caching.
- Continuous maximum-rate repaint.
- Blocking sleeps in the UI thread.
- Excessive allocation in status rendering.

Use shared ownership such as `Arc<str>` for large immutable report text when useful.

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

The application does not need full screen-reader certification in the prototype, but widgets should have meaningful labels.

---

## 37. Testing

### 37.1 Unit Tests

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

### 37.3 Build Checks

The repository should pass:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo build
cargo build --release
```

Run these checks on both macOS and Linux where CI is available.

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

- What the prototype demonstrates.
- Job and Bench concepts, stating explicitly that a Bench fans out to existing
  Jobs and is not a pipeline.
- MockBackend limitation.
- Screens implemented.
- A note that the working name contains "Pipeline" for historical reasons only.

### macOS Run Instructions

```bash
rustup toolchain install 1.95
rustup override set 1.95
cargo run
```

Also include:

```bash
cargo run --release
```

Mention that Xcode Command Line Tools may be required for native Rust linking, but do not add external runtime dependencies.

### Linux Run Instructions

Include:

```bash
rustup toolchain install 1.95
rustup override set 1.95
cargo run
```

Document any required distribution packages based on the selected eframe backend.

### Test Instructions

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

### Prototype Controls

Document all Mock Controls and state transitions.

### Architecture

Briefly explain:

```text
UI
→ ExperimentBackend trait
→ MockBackend
```

Explain that a future ManifestBackend can replace MockBackend.

---

## 40. Implementation Order

Implement in this order.

### Phase 1: Project Skeleton

- Initialize eframe application.
- Pin dependencies.
- Configure native window.
- Verify macOS build.
- Verify Linux build where available.
- Add app shell.
- Add placeholder sidebar and central region.

### Phase 2: Domain and MockBackend

- Add IDs.
- Add entity types.
- Add run types.
- Add status and report types.
- Add deterministic fixtures.
- Add state transitions.
- Add unit tests.

### Phase 3: Navigation

- Implement Route.
- Implement Overlay.
- Implement sidebar selection.
- Implement breadcrumbs.
- Implement safe missing-route recovery.

### Phase 4: Overview Pages

- Job overview.
- Bench overview.
- Active-run cards.
- All Runs tables.
- Search and status filter.

### Phase 5: Modals

- Start page.
- Parameter handling.
- Cancel confirmation.
- Add Demo Folder.
- Inline operation errors.

### Phase 6: Detail Pages

- Job Run Detail.
- Bench Run Detail.
- Bench child-run detail.
- Dispatch table.
- Dual-route access to the same run record.

### Phase 7: Report Viewer

- Full-width report page.
- Search.
- Match count.
- Wrap toggle.
- Copy.

### Phase 8: Mock Controls

- Manual progression.
- Failure simulation.
- Query failure.
- Report generation.
- Large history generation.
- Reset.

### Phase 9: Polish

- Theme support.
- Keyboard shortcuts.
- Persistence.
- Resizing.
- Status consistency.
- Empty states.
- Error states.
- Performance checks.

### Phase 10: Verification

- Format.
- Clippy.
- Tests.
- macOS run.
- Linux build.
- Manual acceptance scenarios.
- README completion.

---

## 41. Agent Constraints

The coding agent must follow these constraints:

1. Build a real interactive egui application.
2. Do not replace egui with another framework.
3. Do not create a separate web frontend.
4. Do not implement production backend behavior.
5. Do not read or execute real manifests.
6. Do not start real processes.
7. Do not run shell commands from the UI.
8. Do not add Tokio unless a later specification explicitly requires it.
9. Do not use unsafe Rust.
10. Do not put the whole project in one source file.
11. Do not create a permanent right-side inspector.
12. Do not put the parameter field permanently on overview pages.
13. Do not display full run details only in a sidebar.
14. Do not conflate query failure with experiment failure.
15. Do not model a Bench as owning, defining, or sequencing Jobs.
16. Do not duplicate a run record to serve both the Job and Bench views.
17. Do not reintroduce a concurrency policy or block Start on active runs.
18. Do not make the Query operation a prominent manual action.
19. Do not remove active runs from the UI when navigating elsewhere.
20. Do not silently discard user-entered parameters after a failed Start.
21. Do not allow egui dependency versions to float during implementation.
22. Do not upgrade dependencies without explicitly documenting the reason.
23. Complete and compile each implementation phase before proceeding.

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
library. The protocol itself is spoken by `tiny_http`, a small synchronous
server crate with no async runtime behind it (§5): parsing, framing, and status
lines are common code rather than coco's own. What stays coco's is what no
library decides — who may bind the socket, when the file goes away, and where a
request's answer comes from. Request bodies are capped at 64 KiB; a larger
declared length is answered `413` before a byte of it is read.

Failing to bind is not fatal. Another coco already owns the socket, or the
directory is not writable; either way the workbench is still a workbench, and it
says so in the log. A socket file with nothing listening behind it is a crash's
leftover and is replaced. One with a live coco behind it is not: the second
window runs without an interface rather than stealing the first's.

### 43.3 Path through the application

Every request is handed to the frame loop and executed where the commands from
the screen are executed. An agent's start takes the same call a click takes —
the same validation, the same origin stamping (§10.6), the same screen update.
There is no second way into the engine to keep in step with the first.

Reads are answered from the snapshot the frame loop publishes after each frame,
so they never wait on one. Writes wait, because the engine has one owner and the
socket thread is not it. A wait that outlives its welcome is answered `503`
rather than left hanging.

### 43.4 Surface

```text
GET  /world                        the world, as §26.1's dump prints it
POST /experiments/{name}/runs      {"parameters": {…}} → 201 {"run_id": "…"}
```

Experiments are addressed by name, which is unique across the Explorer
(convention §5): an agent should not have to know folder paths.

A refusal carries the workbench's own text, unchanged — an agent reading it sees
what a person would have been shown — under the status that says who can act:
`404` for something that is not there, `400` for a request that was refused,
`503` when coco did not answer.

### 43.5 What is not here

No approval step and no separate notification: a run records who asked (§10.6),
and that record is where the question is answered. No authentication: the socket
is reachable only by processes that can open the file, and coco runs on the
user's own workstation.

---

## 42. Deliverables

The final prototype delivery must include:

1. Complete Rust source code.
2. `Cargo.toml`.
3. Committed `Cargo.lock`.
4. `rust-toolchain.toml`.
5. Demo fixtures.
6. Unit tests.
7. README.
8. macOS run verification.
9. Linux build verification or documented limitation.
10. Screenshots of:
    - Job overview, including a Bench-sourced history row.
    - Start page.
    - Job run detail.
    - Bench run detail with the dispatch table.
    - A parameter-sweep Bench run.
    - Child-run detail.
    - Report viewer.
    - Query-unavailable state.
11. No known panic in the listed acceptance scenarios.
12. No permanent right-side detail panel.
13. No real backend side effects.

---

## 43. Definition of Done

The prototype is complete when all of the following are true:

- It launches as a native macOS desktop application.
- It builds as a native Linux desktop application.
- The Explorer contains mock Jobs and Benches.
- Selecting an entity shows its status and history.
- Start opens a modal rather than an inline permanent form.
- Starting creates a simulated run.
- A new run immediately opens in full-page detail.
- Active status updates are visible.
- Cancel uses a confirmation modal.
- Query failure is visually distinct from execution failure.
- Clicking any history row opens a full run-detail page.
- Bench runs display a full-width dispatch table of every run they started.
- A Bench dispatches all of its calls at once, with no ordering or dependency.
- A run dispatched by a Bench appears in the referenced Job's own history, stored
  once and reachable from both contexts.
- Clicking a Bench child run opens a full detail page.
- Reports open in the full main-content area.
- Reports can be searched, wrapped, selected, and copied.
- The sidebar remains the only persistent navigation panel.
- The application remains usable at 900 × 600.
- The application remains responsive with 500 run-history rows.
- `cargo fmt --check` succeeds.
- `cargo clippy --all-targets --all-features -- -D warnings` succeeds.
- `cargo test` succeeds.
- `cargo build --release` succeeds.
- README instructions reproduce the build on macOS.
- The code contains a clear boundary for replacing MockBackend with a future ManifestBackend.

---

## 44. Final Instruction to the Coding Agent

Implement this specification as an interactive UI prototype.

Begin by creating the compiling native eframe application and domain model. Then implement the MockBackend and screens incrementally.

Prioritize:

```text
Correct navigation
Clear status presentation
Run-history usability
Bench dispatch-table readability
Modal start workflow
Full-page details
Full-page report viewing
macOS native operation
Linux compatibility
```

Do not spend time on real experiment execution, manifest parsing, production packaging, or unrelated architecture.

When a minor detail is not specified, choose the simplest implementation that preserves the product principles in this document and document the decision in the README.