# 7. Job scripts

## 7.1 `launch`

```
./launch.sh --script runs/41/job.sbatch --run 41 --mesh 256 --profile false
```

Receives the entity-relative path of the rendered artifact, the run id, and the
launch params as pairs (§6). It submits however it likes — ssh, sbatch, a local process — and
must print the identifier cocoa will track it by:

```
COCOA_RETURN: 5001
```

The **last** `COCOA_RETURN` line wins, so a script may retry and log freely
before it. A launch that exits 0 without one is an error: it is reported, and
**nothing is recorded** — cocoa will not track a run it cannot identify.

The payload must be a single token — a return line with whitespace is the same
error as a missing one. On any launch failure (non-zero exit, timeout, or a
missing or invalid return line), the start fails: no run record is written, the
run id is consumed and never reused (§5), and the rendered artifact stays in
`runs/<run_id>/` for inspection.

The submission id is opaque to cocoa: any non-empty token without whitespace.
cocoa stores it in the record and hands it back to `poll`, `report` and `cancel`
for the rest of the run's life.

The record written at this point holds both parameter sets separately:

```json
{
  "run_id": 41,
  "submission_id": "5001",
  "render": { "size": "256", "backend": "cuda" },
  "launch": { "mesh": "256", "profile": "false" },
  "status": "STARTING",
  "history": [ { "status": "STARTING", "at": "2026-08-17T12:40:11+02:00" } ]
}
```

The values keep their shapes (§2.2): a list is a JSON array. What the record
holds is what a Start over sends again.

## 7.2 `poll`

```
./poll.py --submission 5001
```

Called once per active run with that run's submission id — the same shape
`cancel` gets — and answers for that one run, no id prefix needed:

```
COCOA_RETURN: FAILED slurm reported TIMEOUT after 4h
```

Everything after the status is a free-text reason, kept and displayed as-is.

The answer is exactly one line, always — a run that is simply still running
is still an answer (`RUNNING`), and a poll with nothing to print is broken
code, treated as §10 treats a non-zero exit. One call per run rather than one
aggregated call, so a script stays a line of `squeue -j $sub` rather than a
loop with parsing, and one run's slow or broken poll never speaks for
another's.

Poll is where a scheduler's vocabulary gets translated: slurm's `COMPLETING`
is reported as `RUNNING`, `TIMEOUT` and `NODE_FAIL` as `FAILED`. That mapping
belongs to the script, which knows its scheduler. cocoa maintains no table of
foreign state names.

Note that poll reports `COMPLETED`, not `SUCCEEDED`: it speaks only for the
cluster, and `SUCCEEDED` is cocoa's word for "finished and reported" (§9).

If the first token after `COCOA_RETURN: ` is the keyword `UNREACHABLE` rather
than a status word, cocoa cannot currently see this run — see §10.

## 7.3 `report`

```
./report.py --run 41 --submission 5001
```

Must produce `report/<run_id>.txt`, and may additionally produce
`report/<run_id>.html`. cocoa creates the `report/` directory beforehand; its
contents are entirely the script's business.

cocoa runs `report` automatically when a run reaches `COMPLETED`, holding the
run at `ANALYZING` until it finishes (§9), and when it reaches `FAILED`, beside
a status it never changes (§7.3.1). When the script exits 0, cocoa verifies
that `report/<run_id>.txt` exists; a missing file is treated as a report
failure.

The arguments are the same either way. The cluster's outcome is in the
environment instead (§6): `COCOA_RUN_STATUS=COMPLETED` or
`COCOA_RUN_STATUS=FAILED`, so one script can serve both and one written before
the variable existed keeps working.

Re-running report by hand is available for any run whose cluster outcome was
`COMPLETED` — including one left at `ERROR` by a failed report — or `FAILED`,
and overwrites the output. A successful re-run moves a `COMPLETED` run to
`SUCCEEDED` (§11); a `FAILED` run stays `FAILED` (§7.3.1). How a re-run is
asked for and lands is §7.3.2.

### 7.3.1 A failed run's report

A failed run is the one most in need of a report: the script is where a person
finds out which stage broke and why. So `FAILED` gets one too — but beside the
status, never on it. `FAILED` is the cluster's verdict, and nothing the report
script does can change it: a report that lands does not make the run
`SUCCEEDED`, and one that fails does not make it `ERROR`.

The report's state therefore lives in the record, in the bench report's shape
(§8.2):

```json
{ "status": "FAILED", "reason": "slurm reported NODE_FAIL",
  "report": { "attempted": true, "at": "2026-10-06T14:02:40.123+02:00" } }
```

- **Owed.** The poll answer that moves a run to `FAILED` writes
  `"report": { "attempted": false }` in the same write; so does a re-run by
  hand (§7.3.2). That is the whole of
  "in flight": the run reads `FAILED` at once, its clock stops there (§9), and
  it never passes through `ANALYZING`. cocoa runs `report` on the same tick.
  An owed report survives a close and is taken on the next session's first
  tick, as an `ANALYZING` run's is.
- **Landed.** `attempted: true` and `at`, with `report/<run_id>.txt` on disk.
- **Failed.** `attempted: true`, `at`, and `error` with the script's captured
  output — a non-zero exit, a timeout, or no `report/<run_id>.txt`. The
  failure is raised as an operation error as well, like any report's. It is
  not retried: re-running by hand is the remedy (§7.3.2), and a re-run
  records its own outcome here, success or failure, and moves no status.

Polling stops at `FAILED` as at any terminal status. A run recorded `FAILED`
without a `report` field predates this rule; it owes nothing, is never
reported on its own, and can be reported by hand.

A run is not deleted while its report is owed (§12.1): the script would write
`report/<run_id>.*` after the record had gone, for the next run that takes the
id to find.

`CANCELLED` still has no report: the run stopped because someone asked, not
because it broke. And a bench is unchanged: its member's own report runs, but
a bench with a `FAILED` member still settles `FAILED` with no bench report
(§8.3, §9.1).

### 7.3.2 Re-running a report by hand

A person (the run page's `Re-run report`) or an agent
(`POST /experiments/{name}/runs/{run_id}/report`) can ask for a job run's
report again — after rewriting the script, say, to regenerate every report it
ever wrote. Asking runs nothing. It marks the report **due**, exactly as the
automatic path marks it: a `COMPLETED`-path run moves to `ANALYZING`, a
`FAILED` run's report becomes owed (§7.3.1). The refresh tick then runs it
like any due report — asked for at once rather than at the next tick — so
there is one way a report runs and one way its outcome lands:

- a `COMPLETED`-path run ends `SUCCEEDED` when the report lands, and `ERROR`
  with the script's output when it does not — the healable `ERROR` of §11,
  whatever the run was before. A run that had succeeded keeps its end time:
  the first terminal change dates it (§9), and a re-run's are later ones;
- a `FAILED` run stays `FAILED`, its report state recording the outcome.

The answer to the asking is therefore "due", not "done": the run reads its
report as in flight until the outcome lands, and a failure is raised as an
operation error then, as an automatic report's is.

Refused, with the reason: a run whose cluster outcome was neither
`COMPLETED` nor `FAILED` (still running, `CANCELLED`, an `ERROR` that never
completed); a run whose report is already due or running — two scripts never
write one run's report at once; and a folder whose manifest does not load.

Who asked is not recorded. The record has one `origin`, for who started the
run (§8.2 for a bench's), and a status change carries only its status and
moment; a re-run's `ANALYZING` is in the history like any other, and its
asker is not a fact any reader of the record has needed.

A bench's own report is not re-run by hand. It dates the bench's end (§8.2),
which a re-run would move; its members' reports can each be re-run, under
their own jobs.

## 7.4 `cancel`

```
./cancel.sh --submission 5001
```

Cancels one submission. Returning 0 does **not** make the run cancelled — it
moves the run to `CANCELLING`, and only a later poll reporting `CANCELLED`
settles it. A non-zero exit or timeout is a cancel failure: the run keeps its
current status, nothing moves, and the captured output is shown as an operation
error.

## 7.5 `check`

```
./check.sh
```

Asked before **every** start, with no arguments: is what this job runs — its
executable, its configuration, whatever else its runs expect to find — in
place, and may it be put there now? It answers exactly one line:

```
COCOA_RETURN: CURRENT
COCOA_RETURN: STALE solver.cfg changed since the last deploy
COCOA_RETURN: CONFLICT solver binary is in use by run 38
```

| Word | Means | cocoa |
|---|---|---|
| `CURRENT` | everything is in place | launches at once (§7.1) |
| `STALE` | something must be put in place, and nothing running is harmed by that | runs `deploy` (§7.6), then launches |
| `CONFLICT` | something must be put in place, but doing it now would race with work in progress | refuses the start |

Everything after the word is a free-text reason, kept and shown as-is. The
judgement is the script's alone: cocoa does not know what a deploy touches or
what a running run reads — whether a new config file is harmless while runs
are going and a new binary is not is exactly the kind of thing only the folder
knows. A check may read `runs/` to see what is active (§12); its records are
safe to read.

A `CONFLICT` refuses the start as a bad value would: nothing is recorded, no
run id is taken, and the reason is what the person or agent who asked is
shown. Start again once what it names is over. So does a check that cannot
say — a non-zero exit, a timeout, no line, more than one, or a word other than
these three — with the captured output: whatever it would have said, cocoa
will not guess it.

The check runs **after** the start's values are validated and its template
rendered, so a start refused for a typing mistake never runs it, and **before**
anything is written.

**One start at a time.** A job is checked and deployed by one start at a time:
a second start of the same job, made while the first is checking or
deploying, waits for it and then checks afresh — so it sees what the first
deployed, and two deploys never write over each other. The wait lasts until
the first start's runs are launched.

A bench start checks each job its plan calls **once**, before dispatching
anything (§8.2). Validation is all-or-nothing, as for the plan itself: a
`CONFLICT` or a broken check on any job refuses the whole start, naming every
job at fault, and nothing is dispatched. A stale job is deployed once, and all
the bench's members of that job wait on that one deploy.

A run records what its check said:

```json
{ "run_id": 42, "status": "STARTING",
  "deploy": { "check": "STALE", "reason": "solver.cfg changed",
              "at": "2026-10-06T15:02:40.123+02:00" } }
```

`check` is `CURRENT` or `STALE` — a `CONFLICT` leaves no run to record it on —
`reason` is what the script said beside the word, and `at` and `error` belong
to the deploy (§7.6). A run recorded before this rule has no `deploy` field.

## 7.6 `deploy`

```
./deploy.sh
```

Puts in place what `check` found stale — builds the executable, copies it and
its auxiliary material where the job's runs expect it, on whatever machine
they run. No arguments; exit 0 means it is done. It prints nothing to cocoa.

A deploy is spawned rather than waited for, as a launch is (§7.1): every run
whose start asked for it is recorded at once as `DEPLOYING`, and the refresh
tick collects the script's outcome:

- **exit 0** — each run waiting on it moves to `STARTING`, its `deploy.at`
  set, and its `launch` is spawned exactly as at a start (§7.1). A deploy is
  not followed by a second check: exit 0 is the script saying it is done.
- **non-zero exit or timeout** — each run waiting on it moves to `ERROR`, with
  the captured output in its `error` and its `deploy.error`. None of them was
  ever submitted. The failure is raised as an operation error as well; nothing
  retries it, and the next start checks afresh.

A `DEPLOYING` run has no submission, so there is nothing to poll and nothing
to cancel yet: a cancel is refused until it has launched, and a bench cancel
names such members as not cancelled rather than passing over them. It cannot be
deleted while it is waiting (§12.1).

A close while a deploy is running kills it, and every run waiting on it is
moved to `ERROR` at the close — it was never launched, and nothing will launch
it. A *crash* leaves runs at `DEPLOYING` with nothing to finish them; the next
session's first tick moves them to `ERROR`, as it does a launch left
unanswered (§10). What a killed deploy had already put in place is the
folder's: the next check says whether it is current.
