# 30. Run Independence

Runs are always independent. A Job may have any number of active runs, and every
run is fully isolated from every other.

There is no `allows_concurrent_runs` flag and no concurrency policy in this
phase. Do not add one.

Consequences:

- Start is never disabled because a run is already active.
- A Campaign dispatching a Job never conflicts with, waits for, or is blocked by any
  other run of that Job.
- The same Job may simultaneously have a directly-started run and several runs
  dispatched by one or more Campaigns.
- Cancelling any run affects only that run.

When an active run already exists, the Start page may show an informational
notice. It must not block submission:

```text
2 runs of this Job are already active.
Starting will create another independent run.
```

The button may read `Start Another Run` in that case. This is wording only.
