# 18. Campaign Run-Detail Page

This page must use the full main-content width.

## 18.1 Header

The run head of §17.1, with `N / M finished` after the status chip.

Show:

- Breadcrumbs.
- Campaign name.
- Run time.
- Aggregate status.
- Cancel Campaign button when any child is still active.
- Open Campaign Report button when available.

Do not show a current Job. Nothing is sequenced, so no call is "current".

As built, the facts under the header carry the campaign's own Report row,
the one of §17.5, whose `Regenerate` is a split button: the campaign's report
alone, or every member's report first (§17.5, convention §8.3).

## 18.2 Progress Summary

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

As built, the bar sits over the dispatch table and has one segment per call,
in plan order, each in its call's status colour — so a fan-out half
finished, or one call failed among running ones, shows before a row is read.
A call not listed is grey. The counts are the header's `N / M finished` and
the table's chips.

There is no pending count after a successful start. Every call is dispatched
immediately, so a call is never waiting for its turn.

If a child has failed while others are still running, the header status stays
`Running` and the failure is visible in the counts. The aggregate does not become
`Failed` until every child is terminal (§2.3).

## 18.3 Dispatch Table

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

Clicking a row opens Campaign Child-Run Detail.

**Running a call again.** A row's context menu has the history's two actions
(§22.6), for a call that did not succeed — its run `Failed`, `Cancelled` or
`Error`, and finished. Each starts a new run of the call's job that takes the
call's place in this campaign run (convention §8.5):

- **Start over** starts it at once with exactly the call's values; the
  refusal of values the job no longer takes is a modal, as in the history.
  The page stays, and the row turns to the new run.
- **Refill** opens the job's Start page (§15) with the call's values filled
  in, as far as the job's parameters as they are now allow, and says that the
  run will replace this call.

On any other row both are disabled, and the menu's first line says why: the
call is still running, or it succeeded. A locked campaign report disables
them too, since the new run would have it regenerated. A call that has been
run again says so under its job's name — `attempt 2` — with the earlier run
ids in its tooltip; the row shows the current run.

Clicking a Report button opens that run's Report Viewer.

Running rows may be emphasized, but no row is "the active step".

## 18.4 Campaign Parameters

Show the complete Campaign input parameter string above the dispatch table, in a
monospace selectable block.

This is the string the user typed. Each dispatched run has its own derived
parameter string, shown per row in the table and in full on its detail page. Do
not conflate the two.
