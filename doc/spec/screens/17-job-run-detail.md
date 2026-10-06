# 17. Job Run-Detail Page

Clicking a Job history row opens a full Job run-detail page in the main region.

## 17.1 Header

Show:

- Breadcrumbs.
- Job name.
- Human-readable run time.
- Status pill.
- Cancel button only when cancellable.
- An Open button per report file when a report is available (§17.5).
- Optional overflow menu.

Example:

```text
Solver GPU / Run 2026-08-15 10:24

Running                                             Cancel Run
```

## 17.2 Overview Fields

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

`Source` is `Started directly` or a link to the dispatching Campaign run:

```text
Source    Nightly Benchmark · Run 2026-08-15 10:24 · call 4
```

Do not show an end time for an active run.

## 17.3 Arguments

Show the run's complete arguments in a selectable, monospace block, in the
wire form the scripts were given (convention §6), names sorted: `--gpu 0
--profile false --tags a --tags b`. What is read is what ran.

The word is deliberate. A *parameter* is what an experiment declares — a name,
a type, a description (§13.1) — and an *argument* is the value one run was
given for it. The overview lists parameters; a run, and every row of a
history, shows arguments.

Do not truncate parameters on this page.

## 17.4 Status Section

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

## 17.5 Report Section

Possible states:

```text
Report is not yet available.
Report is being generated.
[👁 View report]
[👁 Text]  [👁 HTML]
Report is missing.
Unable to read report: <message>
Report script failed: <output>
```

A report that exists is shown as buttons alone, each opening the Report
Viewer on one file; no sentence says a report is available, since the
buttons do. One file is one action, `View report`: someone who wants to read
the report does not care which format it is, so the format is only the
tooltip. Two files (`report/<run>.txt` and `report/<run>.html`) are a choice,
and only then is the format the point: `Text` and `HTML`, plain text first,
each with the view icon. The same row appears on a Campaign run's page (§18).

The row's last action is `Re-run report`, a secondary button with a
counter-clockwise arrow, on every job run whose `report_rerunnable` is true —
`Succeeded`, `Failed`, an `Error` its report left, a `Completed` one not yet
taken — and absent otherwise, including while the report is `Generating`.
It asks nothing first: a re-run only replaces a file the script will write
again. Pressed, it is busy (`Re-running…`) until the engine answers, which is
at once; by then the report is due, and the row reads `Report is being
generated.` until the outcome lands (convention §7.3.2). A refusal is a
notice in the error voice; so is a report that then fails, as on the
automatic path. A campaign run's own Report row has no re-run.

A `Failed` run's report is shown exactly as a succeeded run's: the same
buttons, the same viewer. When its script failed, the row says
`Report script failed:` and the captured output, in the error colour, in
place of the state — or under the buttons, if the script wrote a file before
it failed. The status pill stays `Failed` throughout (§10.2).
