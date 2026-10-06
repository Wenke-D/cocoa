# cocoa

A desktop workbench for experiments that live on your own machine.

An experiment, to cocoa, is a **folder**: a `cocoa.toml` manifest and the scripts
it names. Experiments come in two kinds — **jobs**, launched one run at a time,
and **benches**, whose plan fans out over jobs — and *experiment* is the word
for either, here and everywhere cocoa speaks. The manifest says how to launch a run, how to ask whether it is still
going, how to produce a report, and how to cancel it. cocoa runs those scripts.
It does not know what a cluster is, whether you use Slurm, or how you reach it —
your `launch.sh` knows, and cocoa knows only what your script printed.

That is the whole trick. cocoa is not a scheduler, a job queue, or a client for
anything. It is a window onto folders you already have, doing the part that is
tedious to do by hand: remembering what you ran, polling it, collecting the
report, and telling you which of your runs are still alive.

![The workbench](images/workbench-light.png)

## The folder is the record

cocoa keeps no database. A run is written into the experiment's own folder, as
`runs/<id>/run.json`, and its report lands in `report/`. The convention is
written down in [convention.md](convention.md) and both implementations follow
it byte for byte.

This has consequences worth stating plainly, because they are most of the reason
the design is what it is:

- **Your records outlive cocoa.** Delete the app and the runs are still there,
  in a documented JSON format, next to the experiment that produced them.
- **They are ordinary files.** `grep` them, commit them, rsync them, read them
  from a notebook. Nothing is locked inside an application.
- **The folder is portable.** Move it to another machine, register it there, and
  its history comes with it.
- **You can edit them by hand**, and cocoa will notice within a tick.

What cocoa holds in memory is a working copy, rebuilt from those folders and
written back through to them. Nothing important lives only in the app.

## Two kinds of experiment

**A Job** is one runnable experiment. Start it, and it runs. Start it four more
times with different parameters and you have five independent runs — cocoa never
blocks a start because something else is running.

**A Bench** is a fan-out. It does not contain Jobs and it is not a pipeline.
When you start one, its plan script returns a list of calls to Jobs *that
already exist in your Explorer*, each with its own parameters, and cocoa
dispatches all of them at once. There is no ordering and no dependency between
them. The same Job may appear a dozen times with a dozen parameter sets — a
sweep is what a Bench is for.

A run dispatched by a Bench is a **real run of that Job**, stored once and
reachable from both places: from the Bench's dispatch table, and from the Job's
own history. Same record, different context; the breadcrumbs and the highlighted
Explorer row tell you which way you came.

## What using it looks like

1. **Add a folder.** The `+` in the Explorer opens your operating system's own
   folder picker. One pick is one experiment.
2. **Start a run.** The Start page shows the parameters this experiment's
   manifest declares, empty. A start means *launched*: the run appears the
   moment its script is spawned, before the cluster has said anything.
3. **Watch it.** cocoa polls every three seconds. Statuses move on their own; so
   does the duration.
4. **Read the report.** When the run finishes, cocoa runs the report script and
   shows the result in the window — plain text or HTML, searchable, with a wrap
   toggle and a copy button.
5. **Cancel, if you need to.** Behind a confirmation, and for a Bench, only the
   runs that Bench dispatched.

## Two things told apart

Most of the care in cocoa goes into distinctions that are easy to collapse and
expensive to get wrong:

**"Your experiment failed" is not "I could not reach the cluster."** A poll that
times out does not overwrite what the run was last known to be doing. The run
still says `Running`, with the last successful query time beside it and the
reason the query failed. A failure of cocoa's own — a script that will not run, a
launch whose output never arrived — is a third thing again, `ERROR`, never
dressed up as your experiment's verdict.

**A run's report is not its status.** A run can finish and have no report yet;
a failed run can have a very informative one — failure is when you need it
most, so cocoa runs the report script for a failed run too. The report is
where you find out what happened, so it has its own states. cocoa waits to call
a run `Succeeded` until it has one, and a failed run stays `Failed` whatever
its report does: the cluster's verdict is not the report's to change.

## Driven by an agent, too

cocoa answers on a Unix socket while its window is open, and an agent can list
experiments, read runs, and start them through it — the same operations a click
uses, on the same engine, landing on the same screen. Every run records who
asked: **you**, an **agent**, or the **bench** that dispatched it. See
[agent.md](agent.md).

## What it is not

- Not a scheduler. Your scripts talk to whatever runs your work.
- Not a pipeline or DAG tool. A Bench fans out; it does not sequence.
- Not a server, and not multi-user. It is one window on one workstation.
- Not a place your data lives. It is a view of folders that were already yours.

## Where to read next

| | |
|---|---|
| [screens.md](screens.md) | What every page shows and how it behaves |
| [architecture.md](architecture.md) | How it is built, and which boundaries are load-bearing |
| [convention.md](convention.md) | The folder contract: manifests, records, the poll protocol |
| [agent.md](agent.md) | The agent interface |
| [ui-system.md](ui-system.md) | The design system |
| [developing.md](developing.md) | Running it, testing it, and what is still outstanding |

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
