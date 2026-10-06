# Product specification

What cocoa must let a user do, the model it does it over, the operations it
exposes, and what is in and out of scope. The plain-language introduction is
the [overview](../manual/overview.md); this is the part the rest of the
specification builds on.

Covered here: §1–§4.

The numbered sections below, and throughout these documents, are cited from the
source — a comment reading `(§2.3.1)` means the rule of that number. The
numbering is kept stable for that reason.

---

## 1. Mission

Everything above, as the list of things the application must let a user do —
the checklist the rest of this documentation elaborates.

A user must be able to:

1. Select a Job or Bench.
2. See its current runs and complete run history.
3. Open the Start page.
4. Enter a free-form parameter string.
5. Start a run.
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

cocoa must not duplicate run records to serve both views.

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
Check
Deploy
Start
Query
Cancel
```

Every Start is preceded by a **Check**: the job's own script says whether
what its runs use is in place. `CURRENT` starts at once; `STALE` runs the
job's **Deploy** first, the run reading `DEPLOYING` until it is done;
`CONFLICT` — a deploy now would race with work in progress — refuses the start
with the script's reason. One job is checked and deployed by one start at a
time, so deploys never overlap (convention §7.5, §7.6).

Starting a Job begins execution directly. A start means *launched*: the run
exists, visibly `STARTING`, from the moment its launch script is spawned. The
script's answer arrives in its own time and is collected by the refresh tick —
a submission id completes the record; a failure or timeout moves the run to
`ERROR` with the output attached. Only a script that cannot be spawned at all
refuses the start itself, because that is a folder problem the submitter can
act on now.

Closing cocoa waits for nothing. In practice a start is watched until it shows
running before anyone walks away, so a close with a launch still unanswered
is the rare worst case, not one worth a grace period — cocoa handles it by
being honest instead of by waiting. An answer that already arrived is still
collected on the way out; a script that has not answered is killed and its
run moved to `ERROR` at the close, recording that cocoa closed too soon and
the run can no longer be tracked (§10). Only a *crash* leaves a run
mid-launch with nothing recorded; the next refresh finds it and moves it to
`ERROR`, because the stdout that carried its submission id died with the
process that read it.

Starting a Bench returns a **plan** — a list of `(existing Job, parameters)` calls,
all dispatched at once. The Bench itself executes nothing; it fans out to Jobs.
Each dispatch is an ordinary Job Start.

Who triggers what:

- **Check** is automatic, before every Start; **Deploy** follows a `STALE`
  check. Neither is a user action of its own.
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
- Real manifests, templates, and process execution ([convention.md](convention.md)).
- The demonstration library in `examples/` registering and running unchanged.
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
- Auto-update.

### 4.3 Explicit Non-Goals

Do not implement any of the following:

- Filesystem watchers. The refresh tick is the only clock (§7.5).
- Remote execution arranged by cocoa itself. A manifest's own scripts may reach
  a cluster over SSH or Slurm; cocoa runs the script and knows nothing of what it
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
