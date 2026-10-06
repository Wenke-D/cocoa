# 2. Product Model

## 2.1 Job

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

## 2.2 Bench

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

## 2.3 Bench Execution Rules

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

## 2.3.1 Run Identity

A run dispatched by a Bench **is a real run of the referenced Job**. It is the
same run record, stored once, reachable from two places:

```text
Job overview → ALL RUNS table          → JobRunDetail
Bench run detail → dispatched runs     → BenchChildJobDetail
```

Both routes display the same underlying run. They differ only in breadcrumbs
and in which Explorer row stays highlighted. See §19.

cocoa must not duplicate run records to serve both views.

## 2.3.2 Start Preconditions

Before a Bench run begins, validate the returned plan:

- Every referenced `EntityId` must exist in the Explorer and must be a Job.
- Every referenced Job's manifest must be `Valid`.

If validation fails, the Bench does not start and no run is dispatched. Report
the failure inline on the Start page, naming every offending call and Job. See
§15.4 and §31.

Validation is all-or-nothing. Never dispatch a partial plan.

## 2.3.3 Failure and Cancellation

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
