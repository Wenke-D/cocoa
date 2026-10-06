# 18. Campaign Run-Detail Page

This page must use the full main-content width.

## 18.1 Header

Show:

- Breadcrumbs.
- Campaign name.
- Run time.
- Aggregate status.
- Cancel Campaign button when any child is still active.
- Open Campaign Report button when available.

Do not show a current Job. Nothing is sequenced, so no call is "current".

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

Clicking a Report button opens that run's Report Viewer.

Running rows may be emphasized, but no row is "the active step".

## 18.4 Campaign Parameters

Show the complete Campaign input parameter string above the dispatch table, in a
monospace selectable block.

This is the string the user typed. Each dispatched run has its own derived
parameter string, shown per row in the table and in full on its detail page. Do
not conflate the two.
