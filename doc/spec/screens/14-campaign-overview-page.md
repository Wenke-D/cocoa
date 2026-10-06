# 14. Campaign Overview Page

The Campaign overview follows the same hierarchy as the Job overview.

## 14.1 Header

As §13.1, with the campaign's own parameters — what its plan takes — under the
same `Parameters` heading, and the same `Actions` row below:

- Campaign display name.
- The manifest's `description`, when it gives one.
- Folder path.
- Manifest validity.
- The declared parameters, one row each: name, shape, description.

A Campaign has no static job list, so the header cannot state how many Jobs it will
dispatch. Show the size of the most recent run instead, and say so:

```text
Nightly Benchmark
Two solver instances and one flaky solver, nightly
~/Experiments/nightly-benchmark
Last run dispatched 6 runs

Parameters
Name      Values         Description
sweep     quick / full   How much of the suite to run

[▶] [⊟]
```

For a Campaign that has never run:

```text
Smoke Test
~/Experiments/smoke-test
Dispatched runs are determined at start

Parameters
Name      Values         Description
sweep     quick / full   How much of the suite to run

[▶] [⊟]
```

Never display a fixed job count as if it were a property of the Campaign.

## 14.2 Active Campaign Runs

Each card shows:

- Aggregate Campaign status.
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

## 14.3 Campaign All Runs Table

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

Clicking the row opens Campaign Run Detail.
