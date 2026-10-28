# Bundled example experiments

These folders are real cocoa experiments in miniature: each one has a
`cocoa.toml` manifest and its own scripts, and the app runs them exactly like
any other folder — no cluster needed. Registering them lets you watch the
engine's true behaviour end to end: launches, polls, reports, cancellations,
UNREACHABLE recovery, and campaign fan-out.

## Using them

```bash
cd cocoa-electron && npm run dev
```

In the Explorer, click the **+** button and pick an experiment folder — one of
the directories listed below, the one holding the `cocoa.toml`. Repeat for each
one you want.

> One pick is one folder ([screens §11.5](../doc/spec/screens/11-explorer-sidebar.md)). Picking this
> `examples/` directory itself is refused — it has no manifest of its own.

The scripts simulate a scheduler with timers, so statuses advance on their own
while the app polls every few seconds.

## What each folder demonstrates

| Folder | Behaviour |
|---|---|
| `jobs/solver-gpu` | Healthy job. `PENDING` → `RUNNING` (15 s) → `COMPLETED` (30 s) → report. Its report has both formats, each for its own reading: a one-line verdict in `.txt`, shown on the run's page as it is, and the long read in `.html`, opened from there (convention §11). It attaches its status history as `history.csv`; its `visualize` opens the HTML report in the browser. Its check compares `deployed/solver.cfg` with `solver.cfg`: the first start deploys (`DEPLOYING`, 2 s), later ones launch at once, and editing `solver.cfg` makes the next start deploy again — or be refused with `CONFLICT` while one of its runs is still active. |
| `jobs/flaky-solver` | Same lifecycle, but between 5–10 s the poll reports `UNREACHABLE` (`squeue: connection timed out`), then recovers. Its report is HTML only, so the run's page shows just the button that opens it. |
| `jobs/failing-solver` | Launch with `mode=fail` and the poll reports `FAILED` at 8 s. The run stays `FAILED`, and its report — run with `COCOA_RUN_STATUS=FAILED` — says where it broke. Its report is plain text only, shown on the run's page. |
| `campaigns/nightly-benchmark` | Fans out to three instances (two `solver-gpu`, one `flaky-solver`) at once and produces a campaign report when all members succeed. |

The submitted ids look like `slurm-<run id>`; the mock poll reads each run's
record and derives its status from how long ago it started. Cancelling a run
moves it to `CANCELLING`, and the next poll confirms `CANCELLED`.

Everything the mock scripts write lives inside the folder's own `runs/` and
`report/` directories, exactly like a real experiment — and, for
`solver-gpu`'s deploy, its `deployed/` directory, the "intended place" a real
deploy would copy to on a cluster.
