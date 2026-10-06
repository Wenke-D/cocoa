# 8. Bench scripts

## 8.1 `plan`

```
./plan.sh --mesh fine
```

Receives the bench's declared params as `--name value` pairs (§6), and prints
one JSON object per instance to launch:

```
COCOA_RETURN: {"job": "solver-gpu", "params": {"size": "256", "backend": "cuda", "mesh": "256", "profile": "false"}}
COCOA_RETURN: {"job": "solver-gpu", "params": {"size": "512", "backend": "cuda", "mesh": "512", "profile": "true"}}
```

`job` must name a **registered job** — not a bench, not an unregistered folder.
`params` must supply exactly that job's parameters, render and launch sets
together: no extras, none missing, each value of its declared shape (§2.2) —
a JSON string, or a JSON array of strings for a list. cocoa rejects numbers,
booleans, nulls, nested objects and any value of the wrong shape rather than
coercing it.

Every instance is validated **before anything is submitted**, and every instance
is validated — checking stops at no first failure. A plan naming an unregistered
job, or supplying the wrong parameter set, fails the whole start with nothing
dispatched, and the failure names every call at fault. A plan is generated, so
its mistakes come in batches; reporting them one start at a time would make the
author rediscover the same mistake once per call. A referenced job whose manifest is not valid at start
(§4) fails the start the same way, naming the job. A plan producing no
instances, or exiting non-zero or timing out, is equally a start failure: no
run id is allocated and nothing is dispatched.

`plan` takes no `--run`, which is what lets it double as the dry run: starting a
bench runs `plan` first and shows the resulting instance list for confirmation,
with no run id allocated and nothing submitted until the user agrees.

## 8.2 Fan-out and the bench record

Once the user confirms the planned instances, cocoa checks every job the plan
calls (§7.5), allocates the bench's run id and dispatches every instance
through **its own job's `launch`**, each in that job's folder — after that
job's deploy, for a job whose check said `STALE`. A bench has no launch, check
or deploy script of its own.

Every member is an ordinary job run: it gets its own run id, its own
`runs/<run_id>/` record in its job's folder, and it appears in that job's
history like any other run. It is never hidden there for having come from a
bench. A member's record carries two extra fields naming where it came from:

```json
{ "run_id": 42, "bench": 41, "bench_name": "nightly-benchmark", ... }
```

Both are absent from a directly started run.

The bench's own record lists what it planned and what it got:

```json
{
  "run_id": 41,
  "bench": "nightly-benchmark",
  "started_at": "2026-08-17T12:40:11+02:00",
  "params": { "mesh": "256", "gpu": "0" },
  "planned": 12,
  "members": [
    { "run_id": 42, "job": "solver-gpu" },
    { "run_id": 43, "job": "solver-gpu" }
  ],
  "launch_failures": [
    { "job": "solver-cpu",
      "params": { "mesh": "1024", "gpu": "0" },
      "error": "launch exited 1: ssh: connect to host cluster: timed out" }
  ],
  "report": { "attempted": true, "at": "2026-08-17T13:02:40+02:00" }
}
```

`report` appears once the bench's own report has been attempted (§8.3):
`attempted`, the moment `at`, and `error` when the script failed. `at` is the
bench's end, for a person reading its history — a bench that succeeded ended
when its report landed, not when its last member did. A bench that settles
without a report (§9.1, step 4) ended with its last member.

Note what is **not** in it: a status. A bench's status is derived on every read
(§9.1) and is never stored.

`planned` is what the plan produced; `members` is what actually launched. The
difference is in `launch_failures`, which is how a bench records that it could
not dispatch part of its own fan-out.

**A failed dispatch does not abort the rest.** Instances are independent, so
cocoa attempts every one, records each failure, and the bench ends at `ERROR`
because it never became what the plan asked for. The members that did launch
keep running and can be cancelled normally.

*(Decision: the alternative is to stop at the first failed dispatch. Continuing
is consistent with §9.1's rule that a failing member never aborts its siblings,
and it avoids leaving a fan-out half-attempted for an unclear reason. Worth
your confirmation, since it is the one rule here I chose rather than took from
your notes.)*

## 8.3 `report`

```
./report.py --run 41 --members runs/41/members.json
```

The bench's own report over its members' results. Because members live in
*other* folders, cocoa writes `members.json` first, so the script never goes
looking:

```json
{
  "run_id": 41,
  "bench": "nightly-benchmark",
  "params": { "mesh": "256", "gpu": "0" },
  "members": [
    { "run_id": 42, "job": "solver-gpu",
      "params": { "mesh": "256", "gpu": "0" },
      "submission_id": "5001",
      "report": "/abs/path/to/solver-gpu/report/42.txt" }
  ]
}
```

Member `report` paths are **absolute**, since they point into the member jobs'
folders, and are **never null** — see the condition below. Output goes to
`report/<run_id>.txt` plus an optional `.html`, as for a job.

**A bench reports only when every member succeeded.** If any member ends
`FAILED`, `CANCELLED` or `ERROR`, the bench terminates at that outcome and no
bench report is produced — not automatically and not by hand. Every member in
`members.json` is therefore a succeeded run with a report on disk, which is why
the field is never null. (A `FAILED` member has a report of its own, §7.3.1;
it is that job's, and does not make one for the bench.)

*(Consequence: there is no aggregate report over a partially failed sweep. If
that is ever wanted, this is the rule to revisit.)*
