# Bundled example experiments

These folders are real cocoa experiments in miniature: each one has a
`cocoa.toml` manifest and its own scripts, and the app runs them exactly like
any other folder — no cluster needed. Registering them lets you watch the
engine's true behaviour end to end: launches, polls, reports, cancellations,
UNREACHABLE recovery, and bench fan-out.

## Using them

```bash
cd cocoa-electron && npm run dev
```

In the Explorer, click the **+** button and pick an experiment folder — one of
the directories listed below, the one holding the `cocoa.toml`. Repeat for each
one you want.

> One pick is one folder ([doc/screens.md](../doc/screens.md) §11.5). Picking this
> `examples/` directory itself is refused — it has no manifest of its own.

The scripts simulate a scheduler with timers, so statuses advance on their own
while the app polls every few seconds.

## What each folder demonstrates

| Folder | Behaviour |
|---|---|
| `jobs/solver-gpu` | Healthy job. `PENDING` → `RUNNING` (15 s) → `COMPLETED` (30 s) → report. Also writes an HTML report. Its check compares `deployed/solver.cfg` with `solver.cfg`: the first start deploys (`DEPLOYING`, 2 s), later ones launch at once, and editing `solver.cfg` makes the next start deploy again — or be refused with `CONFLICT` while one of its runs is still active. |
| `jobs/flaky-solver` | Same lifecycle, but between 5–10 s the poll reports `UNREACHABLE` (`squeue: connection timed out`), then recovers. |
| `jobs/failing-solver` | Launch with `mode=fail` and the poll reports `FAILED` at 8 s. The run stays `FAILED`, and its report — run with `COCOA_RUN_STATUS=FAILED` — says where it broke. |
| `benches/nightly-benchmark` | Fans out to three instances (two `solver-gpu`, one `flaky-solver`) at once and produces a bench report when all members succeed. |

The submitted ids look like `slurm-<run id>`; the mock poll reads each run's
record and derives its status from how long ago it started. Cancelling a run
moves it to `CANCELLING`, and the next poll confirms `CANCELLED`.

Everything the mock scripts write lives inside the folder's own `runs/` and
`report/` directories, exactly like a real experiment — and, for
`solver-gpu`'s deploy, its `deployed/` directory, the "intended place" a real
deploy would copy to on a cluster.
