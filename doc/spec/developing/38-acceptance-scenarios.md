# 38. Manual Acceptance Scenarios

## Scenario A: Job Start

1. Launch the app on macOS.
2. Select `Solver GPU`.
3. Confirm the overview shows active runs and history.
4. Click `Start Job`.
5. Enter parameters.
6. Submit with Command + Enter.
7. Confirm the modal closes.
8. Confirm a new run-detail page opens.
9. Confirm the initial state is Starting.
10. Advance the mock state.
11. Confirm the state becomes Running.
12. Complete the run.
13. Confirm the report becomes available.
14. Open the report.
15. Search and copy report text.

## Scenario B: Job Cancellation

1. Start a Job.
2. Advance it to Running.
3. Click Cancel Run.
4. Confirm the cancellation modal appears.
5. Confirm cancellation.
6. Verify the status becomes Cancelling.
7. Advance the mock state.
8. Verify the status becomes Cancelled.

## Scenario C: Query Failure

1. Open a running Job.
2. Trigger Query Unavailable.
3. Confirm the UI shows Unknown/status unavailable.
4. Confirm the last known status remains visible.
5. Confirm the run is not displayed as Failed.
6. Restore query health.
7. Confirm normal status returns.

## Scenario D: Bench Fan-Out

1. Select `Nightly Benchmark`.
2. Start the Bench.
3. Confirm navigation to Bench Run Detail.
4. Confirm all 6 calls are listed and all are active at once.
5. Confirm no call is shown as Pending.
6. Advance the mock state and confirm children finish out of order.
7. Click a completed child run.
8. Confirm a full child-run detail page opens.
9. Confirm the sidebar still highlights the Bench.
10. Return through breadcrumbs.
11. Open the referenced Job from the child-run page.
12. Confirm the same run appears in that Job's ALL RUNS table with the Bench as
    its Source.
13. Open it from there and confirm the Explorer selection moves to the Job.
14. Open a child report.

## Scenario E: Bench Partial Failure

1. Start a Bench.
2. Fail exactly one child run.
3. Confirm that child is Failed.
4. Confirm every sibling keeps running.
5. Confirm the Bench is still Running, with the failure visible in the counts.
6. Complete the remaining children.
7. Confirm the Bench becomes Failed only after the last child is terminal.
8. Confirm any generated failure report can be opened.

## Scenario H: Parameter Sweep

1. Select `Parameter Sweep`.
2. Start it.
3. Confirm 5 rows referencing the same Job, distinguished by parameters.
4. Confirm each row opens a distinct run.
5. Confirm the breadcrumb leaf disambiguates the calls.
6. Open `Solver GPU` and confirm all 5 runs appear in its history.

## Scenario I: Invalid Plan

1. Select `Broken Plan Bench`.
2. Start it.
3. Confirm Start fails with an inline error naming the offending call and Job.
4. Confirm the modal stays open and preserves the typed parameters.
5. Confirm no Bench run and no Job run were created anywhere in the Explorer.

## Scenario F: Add Folder

1. Reset to an empty Explorer.
2. Click Add Folder and confirm the operating system's folder picker opens.
3. Cancel it, and confirm the Explorer is unchanged.
4. Click Add Folder again and pick the bundled `examples/` directory.
5. Confirm its three Jobs appear in the Jobs group and its Bench in the Benches group.
6. Confirm the status bar reports how many folders were added.
7. Pick the same directory again, and confirm nothing is duplicated and the status bar says they are already in the Explorer.
8. Pick a directory with no manifest anywhere below it.
9. Confirm it appears with an error, and that Start is disabled for it.

## Scenario G: Window Resizing

Test at:

```text
900 × 600
1200 × 800
1600 × 1000
```

Confirm:

- Sidebar remains usable.
- Main content does not become a third-column layout.
- Tables remain readable, including the dispatch table with 50 rows.
- Report viewer scrolls correctly.
- Modals remain centered and reachable.
- No controls are permanently clipped.
