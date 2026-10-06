# 29. Required Demo Fixtures

Initial demo data should include at least:

## Jobs

Every Job referenced by any Campaign plan must exist here.

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

## Campaigns

```text
Nightly Benchmark
Parameter Sweep
Smoke Test
Broken Plan Campaign
```

## Nightly Benchmark Plan

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

## Parameter Sweep Plan

Dispatches the same Job repeatedly with different parameters. This is the case
the dispatch table must handle well:

```text
call 1  Solver GPU  --mesh=64
call 2  Solver GPU  --mesh=128
call 3  Solver GPU  --mesh=256
call 4  Solver GPU  --mesh=512
call 5  Solver GPU  --mesh=1024
```

## Broken Plan Campaign

Its plan references `Invalid Job Manifest`, so Start always fails validation and
dispatches nothing. This fixture exists to exercise §2.3.2 and §15.4.

## Historical States

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

## Reports

Provide, as plain text:

1. A short successful Job report.
2. A failed Job report.
3. A Campaign summary report.
4. A long report with at least several hundred lines.
5. A report containing very long unwrapped lines.
6. A report with repeated searchable terms.

And, as HTML, at least three reports with *deliberately unrelated* stylesheets —
the point of the fixtures is to demonstrate that report styling is outside this
application's control:

7. A dark report carrying an inline SVG chart.
8. A light, document-styled failure report.
9. A table-heavy Campaign summary.

Both formats must appear in the demo Explorer so the viewer's two paths are both
exercised without touching the developer controls.
