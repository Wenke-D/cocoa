# 13. Job Overview Page

The Job overview is the default page after selecting a Job.

## 13.1 Header

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

Below that, under an `Actions` heading, every action on the experiment
itself, as one row of icon buttons at the left, each with its tooltip: Start
(the play icon, primary), then `Remove from Explorer` (§36; a folder-minus,
secondary) — the same removal the Explorer's row menu offers, one modal
behind both. Remove stays available when the manifest is invalid; Start does
not, and its tooltip then carries the reason. The history follows. There is
no `JOB` type label: the Explorer section the row came from says it, as does
the Start tooltip — a statement next to the name was one too many.

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

Actions
[▶] [⊟]

History
```

When the manifest is invalid:

- Show the validation message; the parameter list is not shown, since cocoa
  does not know them (convention §4).
- Disable Start.
- Explain why Start is disabled.

## 13.2 Active Runs Section

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

## 13.3 All Runs Section

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
