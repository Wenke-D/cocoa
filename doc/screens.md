# Screens

What each surface of the workbench shows and how it behaves. This is the
longest document here and the most specific: it is where a question like
"what does the Start page do when the manifest is broken" is answered.

Sections are numbered as they always were (§7–§36), because the code cites
them by number — a comment saying `(§15.4)` in `StartRun.svelte` means the
Submission rules below.

Covered here: §7–§25 (the shell and every page), §30 (run independence),
§31 (error handling), §36 (accessibility).

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
│ Ev │   Nightly Bench 1 │                                                │
│    │ v JOBS            │  Entity overview, run detail, dispatch, or     │
│    │   Solver GPU      │  report                                        │
│    │   Post Process    │                                                │
│ Mg │                   │                                                │
├────┴───────────────────┴────────────────────────────────────────────────┤
│ 2 active runs   last change 22:35:13   (refresh)                        │
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
3. `Events` view icon.
4. `Manage` gear, pinned to the foot of the strip.

Behavior:

- Clicking an item that is not currently open selects that sidebar view and opens the sidebar.
- Clicking the item that is already open collapses the sidebar.
- The open item sits on the same accent wash as the Explorer's selected row, and hover is the rows' hover wash (§11.4): one way of saying "the one that is open", whether it is a view or a folder. Not VS Code's edge rule — that would be a second idiom for the same thing.
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

A section heading is bold, uppercase and flush left, on the same left edge as the view's title row above it, with its rows indented under it — and that is all that marks it — no ground of its own, as VS Code draws them. The only row in the Explorer with a ground is the selected one (§11.4); a heading on a grey band beside a selection on a grey wash said the same thing twice, and the reader had to work out which was which.

The two sections are panes, `BENCHES` above `JOBS`, each scrolling on its own, with a horizontal divider between them that drags; where it sits persists with the sidebar's width. The divider is a visible line — the lower pane's top edge — so a reader knows there is one, and it takes the accent colour under the pointer, which is how it says it drags.

The `Active Runs` view contains a title row with no actions, followed by its rows (§11.1).

The `Events` view contains a title row with no actions, followed by the last hundred things that happened, newest first (§11.1).

Which view is open, and whether the sidebar is, persist with its width.

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
- The time of the last change: the moment of the newest Events entry, as a clock time — `last change 22:35:13` — never a count that ticks, and never the refresh tick, which says nothing at three seconds. It opens the Events view.
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
  | { kind: 'job_run'; job_id: string }
  | { kind: 'bench_run'; bench_id: string }
  | { kind: 'bench_child'; bench_id: string; bench_run_id: string }

export type Route =
  | { page: 'empty' }
  | { page: 'entity'; entity_id: string }
  /** The start form (§15). Only the identity: what the user has typed is a
   *  draft held outside the route. */
  | { page: 'start'; entity_id: string }
  | { page: 'job_run'; job_id: string; run_id: string }
  | { page: 'bench_run'; bench_id: string; run_id: string }
  /** A run dispatched by a bench, seen in the bench's context (§19). */
  | { page: 'bench_child'; bench_id: string; bench_run_id: string; run_id: string }
  | { page: 'report'; context: ReportContext; run_id: string }
```

Overlays are separate state, held by the renderer and never persisted:

```ts
// src/renderer/src/state.svelte.ts — `null` is "no overlay"; every overlay
// carries its own error and busy flag, because a modal that has asked for an
// operation has to show the refusal in place rather than dismiss into a toast.
export type Overlay = { error: string | null; busy: boolean } & (
  | { kind: 'confirmCancel'; target: CancelTarget }
  | { kind: 'confirmRemove'; entity_id: string }
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
`job_id`, `run_id`, `bench_run_id` are never spelled `id` where the kind is
ambiguous.

**A run id is unique within its experiment and nowhere wider.** It is allocated
as one past the highest that experiment already has (convention §5), so two
experiments both have a run `0`. The pair is the address; neither half means
anything alone, which is why every route, cancel target, report target and
agent path names the experiment as well — and why the world holds runs nested
by experiment rather than in one flat map:

```ts
export type RunsByEntity<T> = Record<string, Record<string, T>>

job_runs: RunsByEntity<JobRun>      // world.job_runs[job_id][run_id]
bench_runs: RunsByEntity<BenchRun>
```

The one link that cannot be spelled as a pair is a dispatched run seen from its
bench: the bench run knows the child's id but not whose job it is. Its **plan**
answers that — `plan.steps[].job_id` — and is the authoritative link between
the two (§2.3.1).

```ts
export type EntityKind = 'Job' | 'Bench'
```

The unions below are serialized the way serde writes an externally-tagged enum —
a unit variant is a bare string, a struct variant is `{ Variant: { ...fields } }`.
This is not a TypeScript idiom; it is deliberate. It is the wire format the
records on disk and the agent socket already use ([convention.md](convention.md)), so a
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

The sidebar hosts three views, selected from the activity bar (§8.2).

**Explorer.** The Benches and Jobs the user has added, grouped by kind (§11.2). This is the only persistent navigation surface. It carries no filter field: the Explorer is a short, fully visible list of folders the user added themselves. The run-history filters of §22.4 and the report search of §20.2 are unaffected.

**Active Runs.** Everything started and not yet finished. Top-level runs only: a Bench run appears once, never once per dispatched child, matching the count of §21. The members a Bench run still has running are listed beneath it, indented, as what it is made of — not counted, and leading to the child seen through its bench (§19). Rows show the entity name and the run's status badge, and navigate to that run's detail page, where Cancel lives. When nothing is running, show a subtle `Nothing is running.` note rather than an error.

**Events.** What happened, newest first: a run that started and by whom, a status that moved, a report that landed, a run coco lost sight of or found again, a folder that was added or removed, a manifest that broke or healed, and any failure the status bar reported. Each entry is the moment, the experiment, the run, and what happened — the last coloured by what it means: green for a report landing, a success or a run found again; red for a failure; amber for a run coco cannot see; blue for news; grey for the rest. Entries are kept apart by a rule. The backend only says what changed, as it always has (§26.3); the renderer, which holds the entry as it was, says what moved — the backend knows nothing of this view. The last hundred are kept, in the page's memory only: a reload or a relaunch starts empty. An entry about something still listed navigates to it. When nothing has happened, show a subtle `Nothing has happened yet.` note.

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

The selected row must have a clear background highlight: a light wash of the
theme's accent blue, not a grey — grey is the hover's colour, and a selection
that is the hover with a little more weight is not clear.

It must remain selected when viewing:

- A run.
- A run dispatched by that Bench.
- A report.

### 11.5 Add Folder

`Add Folder` is a secondary action. It is reached from the `+` icon button in the Explorer view's title row (§8.3), and from the Empty Explorer page's button (§12).

Clicking it opens the operating system's own folder picker. Nothing stands between the click and the picker, and a path is never typed by hand. Cancelling the picker does nothing at all.

**One pick is one folder.** The chosen directory registers if it carries a `coco.toml` of its own, and is refused if it does not. coco does not search inside it for experiments.

This is a decision, not a shortfall. A scan has to guess how deep to look and what to skip, and it answers a pick with a list the user did not choose — several folders registered at once, some refused, each for its own reason, none of it visible until afterwards. Picking the folder you mean is one more click and no guessing. `coco-egui/` searched three levels down and needed a modal to report what it had done; that modal is what the rule below replaces.

A folder registers only if its manifest is usable at the moment it is picked. An unusable one is refused with the reason — a missing table, a name already taken, a folder that cannot be read.

A manifest that breaks *afterwards* is the opposite case: the entity stays in the Explorer, and its page shows the validation message with Start disabled (§13.1). It is an entity the user knows and has run, and dropping it out of the list would hide both the entity and the mistake. The rule is that the Explorer never gains a row that has never worked, and never loses one that used to.

A folder already in the Explorer is a no-op, never a duplicate.

Registering must immediately update the Explorer and select the folder that was added, so the user lands on the result of their action rather than wherever they were.

One pick has one outcome, so it needs one sentence, not a modal:

```text
Folder added.                                 registered
That folder is already in the Explorer.       a no-op, and says so
coco.toml: missing required table `[launch]`  refused, with the reason
```

A refusal is an error notice and stays until dismissed (§8.5); the other two fade. The reason is the engine's own sentence, unchanged — the user picked this folder, so the answer is about this folder.

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

Top to bottom — what it is called, what it is for, where it is:

- Job display name.
- The manifest's `description`, when it gives one.
- Folder path.
- Manifest validity.

Then, under a `Parameters` heading, what it takes: a table with one row per
declared parameter, in declaration order, and three named columns — `Name`,
`Values`, `Description` (convention §2.2). The heading row is what says which
column is the description; without it the last column is just the longest
text. `Values` is phrased from the filling-in side, not the type system's: `a
string`, an enum's values with a slash between them (`ok / fail`) — and a
list wears brackets, `[strings]`, `[cuda, hip]`. The separator carries the
meaning: a slash to pick one of, commas inside brackets to take several of.
`No parameters.`
when it declares none. A parameter is read here before it is filled in on the
Start page, so this is where the description is shown in full, not on hover.

Below that, at the left, the `Start Job` primary button; the history follows
it. There is no `JOB` type label: the button says it, and so does the Explorer
section the row came from — a third statement next to the name was the one
too many.

Example:

```text
Solver GPU
Mesh sweep across the GPU solver
~/Experiments/solver-gpu

Parameters
Name      Values          Description
mesh      a string        Mesh resolution, cells per side
gpu       0 / 1           Which GPU to pin to
profile   true / false    Run under nsys

[Start Job]

History
```

When the manifest is invalid:

- Show the validation message; the parameter list is not shown, since coco
  does not know them (convention §4).
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

As §13.1, with the bench's own parameters — what its plan takes — under the
same `Parameters` heading, and the `Start Bench` button below:

- Bench display name.
- The manifest's `description`, when it gives one.
- Folder path.
- Manifest validity.
- The declared parameters, one row each: name, shape, description.

A Bench has no static job list, so the header cannot state how many Jobs it will
dispatch. Show the size of the most recent run instead, and say so:

```text
Nightly Benchmark
Two solver instances and one flaky solver, nightly
~/Experiments/nightly-benchmark
Last run dispatched 6 runs

Parameters
Name      Values         Description
sweep     quick / full   How much of the suite to run

[Start Bench]
```

For a Bench that has never run:

```text
Smoke Test
~/Experiments/smoke-test
Dispatched runs are determined at start

Parameters
Name      Values         Description
sweep     quick / full   How much of the suite to run

[Start Bench]
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
  declared parameter, in declaration order, each under its name, what may be
  put there (the `Values` wording of §13.1), and its description (convention
  §2.2).
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

  nodes  a string
  Nodes to request
  [ required                                               ]

  gpu  0 / 1
  Which GPU to pin to
  [ Choose…                                              v ]

  profile  true / false
  Run under the profiler
  [ Choose…                                              v ]

  backends  [cuda, hip]
  Backends to try, in order
  [ ] cuda   [ ] hip

Cancel                                            Start Job
```

Every field opens empty and stays that way until a person touches it (§15.3).
Start stays disabled until each one has a value.

The field is the shape (convention §2.2):

| Shape            | Field                                                              |
|------------------|--------------------------------------------------------------------|
| `string`         | a text field                                                       |
| `enum`           | a choice, opening on `Choose…` with nothing picked                 |
| `string` list    | a text box, one value per line; blank lines are not values         |
| `enum` list      | one checkbox per value, none ticked to begin with                  |

A yes/no parameter is an enum of two values (convention §2.2) and gets the
enum's choice like any other — never a lone checkbox for the whole value: a
checkbox that is not ticked says `false` whether or not anyone looked at it,
and §15.3 needs "not considered" to be visible. The ticks of an enum *list*
are different: none ticked is an empty list, which is no value, and Start
stays disabled for it.

What the user has typed is a draft held outside the route: a route is a place,
and a half-filled form is not one. Leaving the page discards the draft, and so
does a start that succeeds — coming back to Start opens the empty form §15.3
asks for. A restored route on relaunch lands on the experiment's overview
instead of a form whose values are gone.

### 15.2 Parameter Semantics

A parameter value is a string with a declared shape (convention §2.2): one
string, one of a set, or one or more of either. The form checks nothing
beyond the shape, and the engine checks the same thing again on every way in.

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

### 15.3 No Prefill by Default

The page opens with every field empty. It does not prefill from the last run,
from the manifest, or from anything else on its own — every declared parameter
is supplied by hand, deliberately, each time (convention §2).

A prefilled field is indistinguishable from one the user filled, and a start is
a job on a cluster. Restarting *last night's* sweep because the form remembered
it is a mistake this application must not be able to make for you.

The one way in with values is the history's row menu (§22.6): *Start with
these parameters…* opens this page with one particular run's values filled in.
That is an explicit act on a run the user is looking at, never a memory of
what was typed last, and the page says what it filled — and what it could not.

> There used to be a **Fill from last run** action here, and a `last_args` map
> in the store behind it: an explicit button, never a default, that filled the
> fields and stopped there. Both are gone as of 2026-08-20. It was the one
> thing coco remembered about what a person had typed. The row menu is what
> replaced it: the values come from a run's record, not from a memory of the
> form.

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

### 17.3 Arguments

Show the run's complete arguments in a selectable, monospace block, in the
wire form the scripts were given (convention §6), names sorted: `--gpu 0
--profile false --tags a --tags b`. What is read is what ran.

The word is deliberate. A *parameter* is what an experiment declares — a name,
a type, a description (§13.1) — and an *argument* is the value one run was
given for it. The overview lists parameters; a run, and every row of a
history, shows arguments.

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
treatment, defined once (`table.runs` in `theme.css`) rather than per page.

**Widths are declared, never measured.** The layout is fixed, and each column's
width is set by a `<col>`. Under automatic layout a column is sized from its
content, so a status going from `RUNNING` to `CANCELLING` widens its own cell
and shoves its neighbours sideways — on a three-second tick, in a table
somebody is reading. Declared widths mean the only thing that changes is the
text inside a cell.

**Slack goes to the last column.** A window is usually wider than the table
needs. Whichever column is left without a width absorbs the difference, so it
must be the rightmost one: give it to a column in the middle and every row
opens a gap through it. The empty space belongs at the table's edge.

**Anything can overflow, so everything truncates.** A fixed column cannot grow.
Content longer than its width ends in an ellipsis and carries the full value as
hover text (§22.3, §36).

### 22.1 General Rules

- Fixed header.
- Vertically scrolling body.
- Newest runs first.
- Consistent row height.
- Entire row is clickable.
- Hover state.
- Selected or focused state where applicable.
- No horizontal layout jitter when durations or relative times update.
- Stable status-dot and Run column widths.
- Stable Report-column width.

### 22.2 Suggested Column Behavior

Each column is sized for the widest value it can actually hold — a dot, a
run id, a duration, `59 minutes ago`, `CANCELLING` with its dot — except one,
which is left unsized and takes what is left. Arguments is the one column
whose content has no bound — a sweep is what varies them — so in every table
it is the one worth the leftover width.

Job history:

```text
            22    the status dot (§23), under no heading
Run         54    a run id, flush right, so the digits line up, with room after it
Arguments    —    remainder; the run's arguments, as given, on code's ground
Duration   100    `HH:MM:SS` while it runs, `1h 12m 33s` once it ended
Started    116    `2 days ago`; the locale date and time on hover
By          80    `you`, `agent`, or a bench name and call number, truncated
```

Bench history:

```text
            22
Run         54
Arguments    —    remainder
Duration   100
Started    116
By          80
```

A bench history has no Calls column: how many members a run dispatched is
the plan's business, on the run's own page (§18), and it was the one count
in a row of facts.

Bench dispatch:

```text
#          54    the call index, flush right, with room after it
Job       180    an experiment name
Status    116
Arguments   —    remainder
```

In a history the arguments come second, right after the id: they are what
tells one run of an experiment from the next, and the history is read to
find a run. The dispatch table keeps them last — its rows are told apart by
the call index and the job, and the arguments are what a sweep varied.

A duration is a clock while the run is live — `HH:MM:SS`, ticking — and a
length once it has ended: `1h 12m 33s`, `2m 0s`, `5s`, the empty leading
units dropped. A finished run's duration is a fact, and `00:00:00` reads as
a clock still to start. The same helper serves the detail pages, so they
agree with the table.

A start is said relative to now — `just now`, `38 seconds ago`, `2 days
ago`, `3 months ago` — in the largest unit that fits, whole; the locale date
and time is the cell's hover text, and the run's page prints it. A history is
read for how long ago, and a timestamp makes the reader subtract.

Arguments are the string as given — `--gpu 0 --mesh 1024` (§17.3) — on
inline code's ground, as the run's page shows them: a chip that ends where
the text does, and truncates inside itself. The heading over it is set in
by the chip's padding, so it sits over the text rather than the ground.

### 22.3 Long Arguments

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

### 22.6 Row Menu

Every row of a job or bench history has a context menu with two actions, both
about that run's parameters:

- **Start over** starts a new run at once, with exactly the values this run
  had. The backend validates them against the manifest as it is now; if they
  no longer match — a parameter added, removed or renamed — nothing starts,
  and the refusal is shown in a modal with one `OK`, because it has to be
  read. On success the new run appears in the table and the transient message
  names it; the page does not move.
- **Refill…** opens the Start page (§15) with this run's values filled in, as
  far as the manifest now allows: a parameter it no longer declares is
  dropped, one it newly declares is left empty, one whose value no longer
  fits its shape — an enum value since removed, one string where a list now
  is — is left empty too, and the message says which. The user still presses
  Start — which is what the ellipsis says: this one opens something, the
  other acts.

## 23. Status Presentation

Use both text and visual indicators.

Do not rely on color alone.

The one place the word is not printed is a history table (§22), where the
status is its dot alone, leading the row in a narrow column of its own with
no heading, the run id beside it. Read down that column, the five colours
are the five outcomes a history is scanned for, and the word is the dot's
hover text and its accessible label. What the dot does not tell apart — `Failed` from
`Error`, both red; `Queued`, `Running` and `Cancelling`, all pulsing blue —
the detail page does, one click away, as does the Active Runs view for
anything live.

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
