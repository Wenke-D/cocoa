# Bundled mock experiments

These folders are real coco experiments in miniature: each one has a
`coco.toml` manifest and its own scripts, and the app runs them exactly like
any other folder — no cluster needed. Registering them lets you watch the
engine's true behaviour end to end: launches, polls, reports, cancellations,
UNREACHABLE recovery, and bench fan-out.

## Using them

```bash
cd coco-electron && npm run dev
```

In the Explorer, click the **+** button and pick an experiment folder — one of
the directories listed below, the one holding the `coco.toml`. Repeat for each
one you want.

> One pick is one folder ([doc/screens.md](../doc/screens.md) §11.5). Picking this `mock/`
> directory itself is refused — it has no manifest of its own. `coco-egui/`
> scans a picked directory and registers everything beneath it in one go; that
> is the older behaviour, not the specified one.

The scripts simulate a scheduler with timers, so statuses advance on their own
while the app polls every few seconds.

## What each folder demonstrates

| Folder | Behaviour |
|---|---|
| `jobs/solver-gpu` | Healthy job. `PENDING` → `RUNNING` (15 s) → `COMPLETED` (30 s) → report. Also writes an HTML report. |
| `jobs/flaky-solver` | Same lifecycle, but between 5–10 s the poll reports `UNREACHABLE` (`squeue: connection timed out`), then recovers. |
| `jobs/failing-solver` | Launch with `mode=fail` and the poll reports `FAILED` at 8 s; the run then has no report. |
| `benches/nightly-benchmark` | Fans out to three instances (two `solver-gpu`, one `flaky-solver`) at once and produces a bench report when all members succeed. |

The submitted ids look like `slurm-<run id>`; the mock poll reads each run's
record and derives its status from how long ago it started. Cancelling a run
moves it to `CANCELLING`, and the next poll confirms `CANCELLED`.

Everything the mock scripts write lives inside the folder's own `runs/` and
`report/` directories, exactly like a real experiment.
