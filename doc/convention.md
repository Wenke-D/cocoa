# The cocoa convention

The contract between cocoa and an experiment folder.

cocoa does not run experiments. It renders templates, invokes the folder's own
scripts, and maintains that folder's records. Everything cocoa knows about what
an experiment is doing on a cluster, a script told it.

Three rules hold everywhere:

1. **Scripts are invoked as argv, never through a shell.** Values the user
   typed are argv elements, never text spliced into a command line.
2. **No defaults, and no prefill.** Every declared parameter must be supplied
   at start, by hand, every time. cocoa remembers nothing about what you typed
   last time — a value on screen is one a person put there.
3. **cocoa never invents a cluster state.** `PENDING`, `RUNNING`, `COMPLETED`,
   `FAILED`, `CANCELLED` and `UNREACHABLE` come from the poll script and from
   nowhere else. The states cocoa sets itself describe cocoa's *own* pending
   operations, never the experiment's (§9).

---

## 1. Folder layout

An experiment folder is a directory containing a manifest, the scripts and
template it declares, and — once cocoa has been used on it — its own records.

```
<entity folder>/
  cocoa.toml              # the manifest: the interface to cocoa
  job.sbatch.tmpl        # the template; the middle name is yours to choose
  check.sh  deploy.sh  launch.sh  poll.py  report.py  cancel.sh
  runs/                  # maintained by cocoa: this folder's history
    <run_id>/
      run.json           # record: args, submission id, status history
      job.sbatch         # the rendered template (jobs)
      members.json       # the fan-out (benches)
  report/                # report output, at the folder root
    <run_id>.txt         # required
    <run_id>.html        # optional
```

A folder carries its full history and results with it: copy the folder and the
runs come along. cocoa touches nothing else inside it (§12).

Registration is by path. A folder does not need to be registered for its
records to make sense — `runs/` is readable on its own.

**cocoa does not guess an interpreter.** Either a script is executable and
carries a shebang (`./poll.py`), or the manifest names the interpreter itself
(`command = "python3 poll.py"`). There is no extension-to-executor table, and
no shell is involved in either case.

---

## 2. `cocoa.toml` — a job

A **job** is an independently launchable experiment. One start = one run = one
submission.

```toml
kind        = "job"
name        = "solver-gpu"          # platform-wide unique
description = "GPU solver sweep"    # optional

[render]
template    = "job.sbatch.tmpl"     # rendered by cocoa, see §6

[[render.params]]                   # ALL required; must match the template exactly
name        = "size"
type        = "string"
description = "Nodes to request"

[[render.params]]
name        = "backend"
type        = "enum"
values      = ["cuda", "hip"]
description = "Which backend the solver is built against"

[launch]
command     = "./launch.sh"         # gets --script and --run

[[launch.params]]                   # ALL required; passed as --mesh v --gpu v
name        = "mesh"
type        = "string"
description = "Mesh resolution, cells per side"

[[launch.params]]
name        = "profile"
type        = "enum"
values      = ["true", "false"]
description = "Run under nsys"

[poll]
command     = "./poll.py"           # gets --submission

[report]
command     = "./report.py"         # gets --run and --submission

[cancel]
command     = "./cancel.sh"         # gets --submission

[check]
command     = "./check.sh"          # gets nothing; asked before every start

[deploy]
command     = "./deploy.sh"         # gets nothing; run when check says STALE
```

All six scripts are **required**. A run whose status can never update is a
dead end in a monitoring tool, and a run that cannot be stopped is worse. A
start that cannot ask whether what it runs is in place may launch against a
half-copied executable, which is worse than either (§7.5).

*Consequence worth stating plainly: a folder with no way to cancel its work
cannot be registered at all. Such a folder needs a `cancel` script even if all
it does is exit 0 — and a folder with nothing to deploy needs a `check` that
always answers `CURRENT` and a `deploy` that exits 0.*

Either `params` list may be empty (`params = []`).

`command` values are split with shell-style word rules, so a prefix with
arguments is fine (`command = "python3 tools/report.py --strict"`). The split
is **lexical only** — no shell runs, nothing expands, and the result is an argv
list.

### 2.1 The two parameter sets

`[render].params` and `[launch].params` are independent and both required:

- **render params** are substituted into the template. They shape the artifact.
- **launch params** are passed to the launch script as `--name value`. They
  shape the submission.

**A name may not appear in both lists.** A manifest that declares one in both
fails to load, so that every field in the start form has exactly one meaning.

The start form shows both sets together as one list of fields, in declaration
order; the record stores them as two maps (§7.1).

**Every declared param must be given a value at start.** A value that is empty
or only whitespace is not a value: cocoa refuses the start, whether it came from
the start form or from a bench plan dispatching a member.

### 2.2 A parameter's shape

Each `[[…params]]` entry declares one parameter:

```toml
[[launch.params]]
name        = "backends"            # required; unique within the job
type        = "enum"                # required: "string" or "enum"
values      = ["cuda", "hip"]       # enum only, and required there
list        = true                  # optional; string and enum only
description = "Backends to build, one build each"   # required
```

To cocoa a value is a string with a **shape**, and the shape is what it can
check and what the form can ask for. There are four:

| `type`   | `list`  | A value is…                                  |
|----------|---------|----------------------------------------------|
| `string` | —       | one non-blank string                         |
| `enum`   | —       | one of `values`, exactly (case matters)      |
| `string` | `true`  | one or more non-blank strings, none repeated |
| `enum`   | `true`  | one or more of `values`, none repeated       |

A list is never empty: "no value" is not a value, for a list as for a string.
A parameter that may legitimately be absent declares an enum with a value that
says so.

There is no boolean type. A yes/no parameter is an enum of two values —
`["true", "false"]`, or whatever words fit — and its value is the word, a
string like any other. One consequence is worth stating: in a template such a
value is a **string**, and a non-empty string is always truthy, so a branch
tests the word — `{% if profile == "true" %}` — never the bare name.

`description` is required. The form shows it under the field, and a field
without one can only be guessed at — which is the thing the form exists to
prevent.

Where a value goes, its shape goes with it. In JSON — the record (§7.1), a
plan's instances (§8.1), an agent's request — a `string` or `enum` value is a
JSON string and a `list` a JSON array of strings; nothing else is a value, and
nothing is coerced: a JSON boolean is refused, and `"a,b"` is not a list. On a
script's command line every value is `--name value` pairs (§6). In a template
a list is an array (§6.1).

A manifest written for the form before 2026-08-23 — `params = ["mesh", "gpu"]`,
names alone — does not load; the error says what replaced it.

## 3. `cocoa.toml` — a bench

A **bench** is a fan-out launcher. Its plan turns the bench's parameters into
instances of jobs **already registered in cocoa**. A bench never defines,
contains, or owns jobs.

```toml
kind        = "bench"
name        = "nightly-benchmark"
description = "Mesh sweep across the GPU solver"

[plan]
command     = "./plan.sh"           # gets the bench's params

[[plan.params]]                     # ALL required at start; shaped as §2.2
name        = "mesh"
type        = "enum"
values      = ["coarse", "fine"]
description = "Which mesh family to sweep"

[report]
command     = "./report.py"         # gets --run and --members
```

A bench has no template, no launch, no poll and no cancel of its own:

- it **launches** through its member jobs' own `launch`;
- its **status** is derived from its members, never polled (§9.1);
- it is **cancelled** by cancelling its still-active members, each through that
  member job's own `cancel`.

## 4. Manifest validation

A manifest either loads or it does not. A folder whose manifest is broken stays
registered and is **shown with its error** — never hidden, never silently
dropped. Until it loads, cocoa knows its path, the side it registered on (§5)
and the error: not its name, not its parameters.

Rejected at load time:

- `kind` missing or other than `job` / `bench`;
- `name` missing, not a string, or empty;
- unknown keys for the declared kind, at the top level, in a declared table, or
  on a parameter;
- a `params` entry without a non-empty `name`, a `type` of `string` or
  `enum`, or a non-blank `description` (§2.2); an enum without `values`, or
  with an empty list, an empty value or a repeated one; `values` on anything
  but an enum; `list` that is not a boolean; a `params` that is the old list
  of bare names;
- a name declared twice in one list, or in both `[render].params` and
  `[launch].params` (§2.1);
- a missing required table or `command`;
- a `command` string that does not word-split (unclosed quote, bad escape);
- a `[render].template` that is not a file in the folder;
- a template whose variables do not exactly match `[render].params` (§6.1);
- a template that pulls in another file with `{% include %}`, `{% extends %}`
  or `{% import %}` (§6.1).

Manifests are re-read on every listing: the store holds the folder path and
its kind, never a parsed copy. Editing `cocoa.toml` therefore takes effect without
re-registering, and fixing a broken manifest heals the entity in place, history
intact. Listing happens on the refresh tick, not on every frame.

---

## 5. The private store

The one thing that is cocoa's own state, and that no folder can say about
itself, is which folders are registered, and as what. That is all the store
holds:

```json
{
  "jobs": ["/abs/path/to/solver-gpu"],
  "benches": ["/abs/path/to/nightly"]
}
```

- **jobs**, **benches** — registered folder paths, on the side their manifest
  declared when they were registered. Adding a folder is registration, and it
  persists across sessions. Registering a path that is already in the store is
  a no-op. A folder whose manifest breaks later stays on its side, carrying the
  error (§4); one whose manifest now declares the other kind moves across at
  the next tick, and the store follows — the manifest decides, the store only
  remembers.

It lives in Electron's per-app, per-user data directory, beside `ui-state.json`
— on macOS `~/Library/Application Support/cocoa/store.json`, on Linux
`~/.config/cocoa/store.json`. `COCOA_STORE_PATH` overrides it, which is how a
drive run keeps its hands off the real one.

> It used to live at `~/.local/share/cocoa/store.json`, the same path hardcoded
> in both implementations so that a folder registered in one appeared in the
> other. That was the point while there were two. The workbench carries the
> file over once, by copy, and never looks at it again.

**Two fields have been retired**, and what replaced them is worth knowing:

- **`next_run_id`** was a monotonic counter making run ids platform-unique. It
  is gone, and so is platform-uniqueness: a run id is now allocated as one past
  the highest that *experiment* already has, read from its own records (§7).
  Two experiments both have a run `0`.

  The counter was a second opinion about what a folder contained, and the two
  could disagree — a folder carried over from another machine arrived with runs
  a fresh counter knew nothing about, and the next start overwrote one of them.
  Records cannot disagree with records. It also needs no crash handling: the
  run directory *is* the allocation, so a crash before it exists allocated
  nothing and a crash after it exists is skipped by the next maximum.

  A run id therefore no longer identifies a run on its own. Every address for
  one names its experiment too — a route, a cancel, a report, an agent path —
  which they all did already.

- **`last_args`** recorded the values each experiment was last started with, for
  an explicit *Fill from last run* action on the Start page. Both the field and
  the action are gone. §2's rule is unchanged and now unqualified: every
  declared parameter is supplied by hand, every time.

Names are platform-wide unique: registering a folder whose manifest name
collides with an already-registered one is refused. A currently-broken manifest
cannot collide, since it has no name.

This file stays plain JSON — it holds two short lists and being readable and
hand-editable is worth more than structure. If the global views (all active
runs, cross-entity history) ever make scanning every folder's `runs/` too slow,
the answer is a **rebuildable cache** that can be deleted at any time without
loss, never a second source of truth.

---

## 6. Invocation rules

Every script cocoa invokes:

- runs with **cwd = the entity folder**, so relative paths in the manifest and
  inside the script resolve against it;
- receives arguments as `--name value` pairs only, never positionally — a
  list is the pair repeated, `--tags a --tags b`, one per item. A script
  parses every parameter the same way, and a loop that reads pairs never
  slips;
- receives user-supplied values as **separate argv elements**;
- receives **only** the arguments this document specifies plus the declared
  params — cocoa never passes anything ad-hoc. Wanting to pass something else
  means editing the manifest first;
- inherits cocoa's own environment, unchanged but for the variables this
  document names — today one, `COCOA_RUN_STATUS`, given to a job's `report`
  (§7.3). It travels in the environment rather than as an argument so that a
  script written before it existed, which parses every argument it is given,
  needs no change;
- has stdout and stderr captured, and can be killed from the UI while running.

**`--run` is passed only where it is needed**: to `launch` (so a script can tag
its submission) and to both `report` scripts (the report filename is the run
id). `poll` is job-scoped rather than run-scoped — it speaks for many runs at
once — and `cancel` and `plan` need no run id. `check` and `deploy` get no
arguments at all: they speak for the job, not for any run (§7.5).

**Exit codes.** `0` means the script did its job. Non-zero is a failure of the
*script*, reported to the user as an operation error with the captured output
attached. A non-zero exit never marks a run as finished.

A script that times out is the same failure: whatever the script was supposed
to accomplish did not happen, and the operation reports the error with the
captured output attached.

**Control lines.** cocoa reads every stdout line beginning with `COCOA_RETURN: `
and ignores all other output, so scripts may log freely. How many such lines
are expected depends on the script:

| Script | `COCOA_RETURN:` lines | Payload |
|---|---|---|
| `check` | exactly one | `CURRENT`, `STALE [reason]`, or `CONFLICT [reason]` |
| `deploy` | none | — |
| `launch` | exactly one (last wins) | the submission id |
| `poll` | exactly one | `<STATUS> [reason]`, or `UNREACHABLE <reason>` |
| `plan` | one or more | one JSON instance object |
| `report` | none | — |
| `cancel` | none | — |

**Timeouts** (defaults, tunable later): check, launch, poll and cancel 60 s;
plan 120 s; deploy and report 600 s.

### 6.1 Template rendering

Before launching, cocoa renders `[render].template` with the render params. The
result is written into `runs/<run_id>/`, named after the template with a
trailing `.tmpl` removed (`job.sbatch.tmpl` → `job.sbatch`, `job.kkk.tmpl` →
`job.kkk`).

The template's variables and `[render].params` must match **exactly**. An
undefined variable is an error, not an empty string; a declared param the
template never uses is equally an error. Both directions are checked when the
manifest loads, so a mismatch is visible before anyone tries to start anything.

**`run_id` is not available in a template**, and neither is any other
cocoa-supplied value: a template sees exactly its declared params, and nothing
else. Referencing `run_id` is an undeclared variable like any other and fails
the manifest.

A run has no need to name itself. `launch` returns a submission id (§7.1), and
that is the identifier the scheduler and cocoa both use for the run from then
on — so the template, which is rendered before any submission exists, never has
to carry an identity.

```
#SBATCH --nodes={{ size }}
./solver --backend {{ backend }}
```

**A template is a single self-contained file.** `{% include %}`,
`{% extends %}` and `{% import %}` are rejected. They would pull in variables
from outside the file, which the exact-match check cannot see through — the
guarantee above would quietly stop being true. Loops, conditionals, filters and
`{% set %}` are all fine: they introduce nothing from outside.

Two other consequences of checking statically, both intentional:

- **Control flow is not considered.** A variable used only inside a branch that
  never executes still counts as used. The manifest describes the template's
  interface, not one render path.
- **The check is repeated at render time.** An undefined variable aborts the
  launch before anything is submitted, so even a template edited between one
  refresh and the next can never produce a half-rendered submission.

---

## 7. Job scripts

### 7.1 `launch`

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

### 7.2 `poll`

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

### 7.3 `report`

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

#### 7.3.1 A failed run's report

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

#### 7.3.2 Re-running a report by hand

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

### 7.4 `cancel`

```
./cancel.sh --submission 5001
```

Cancels one submission. Returning 0 does **not** make the run cancelled — it
moves the run to `CANCELLING`, and only a later poll reporting `CANCELLED`
settles it. A non-zero exit or timeout is a cancel failure: the run keeps its
current status, nothing moves, and the captured output is shown as an operation
error.

### 7.5 `check`

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

### 7.6 `deploy`

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

---

## 8. Bench scripts

### 8.1 `plan`

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

### 8.2 Fan-out and the bench record

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

### 8.3 `report`

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

---

## 9. Status

cocoa keeps its own closed vocabulary. Scripts speak it; cocoa does not learn new
state names at runtime.

| Status | Set by | Terminal | Meaning |
|---|---|---|---|
| `DEPLOYING` | cocoa | no | Record written, the job's deploy in flight, not launched yet (§7.6) |
| `STARTING` | cocoa | no | Record written, launch invoked, nothing polled yet |
| `PENDING` | poll | no | Accepted by the scheduler, not yet running |
| `RUNNING` | poll | no | Executing |
| `COMPLETED` | poll | no | Work finished successfully; report not run yet |
| `ANALYZING` | cocoa | no | The report script is in flight |
| `SUCCEEDED` | cocoa | **yes** | Finished and reported |
| `FAILED` | poll | **yes** | The work finished unsuccessfully; its report runs beside it (§7.3.1) |
| `CANCELLING` | cocoa | no | Cancel invoked, not yet confirmed by a poll |
| `CANCELLED` | poll | **yes** | Confirmed cancelled |
| `UNREACHABLE` | poll / cocoa | no | cocoa cannot currently see this run (§10) |
| `ERROR` | cocoa | **yes**\* | Something cocoa did not expect; the reason is shown |

The healthy path is:

```
STARTING → PENDING → RUNNING → COMPLETED → ANALYZING → SUCCEEDED
```

preceded by `DEPLOYING` when the start's check said `STALE` (§7.5).

`FAILED` and `CANCELLED` end a run immediately: they skip `ANALYZING`. A
`CANCELLED` run has no report. A `FAILED` run gets one, run beside its status
rather than on it: the report has its own state in the record, and the run
stays `FAILED` whatever the script does (§7.3.1). `ERROR` never has a report,
whatever it came from (§11).

\* The one healable exception: a run left at `ERROR` by a failed report script
returns to the healthy path once the script is fixed — a successful manual
report re-run moves it to `SUCCEEDED` (§7.3, §11).

**Who owns what.** The cluster's words — `PENDING`, `RUNNING`, `COMPLETED`,
`FAILED`, `CANCELLED`, `UNREACHABLE` — come from poll. cocoa sets `DEPLOYING`,
`STARTING`, `ANALYZING`, `SUCCEEDED`, `CANCELLING` and `ERROR`, each describing an
operation cocoa itself has in flight or a conclusion only cocoa can draw.

cocoa stops polling a run that reaches a terminal status, and a later poll line
for it is ignored. `UNREACHABLE` is deliberately **not** terminal: polling
continues, and the next good poll replaces it with the real status.

A run's full status history is kept in its record with a timestamp per change,
so the last known status stays visible even while the current one is
`UNREACHABLE`. Duration runs from the record's start to the first terminal
change.

Every timestamp a record carries — `started_at`, each status change, the
bench's `report.at` — is RFC 3339 with the writer's UTC offset,
`2026-08-23T13:02:40.123+02:00`: a moment, never a wall-clock reading that
only means something in the room it was taken in. A reader converts to its
own local zone for display; the folder may be read from another one.

### 9.1 Bench status is derived, never stored

A bench run's status is computed from its members every time it is read. It is
not a field in the record and not cached in the UI. In order:

1. Any member unresolvable → `ERROR` (§9.2).
2. Any member `CANCELLING` → `CANCELLING`.
3. Any member non-terminal → `RUNNING`, or `STARTING` while every member is
   `STARTING` or `DEPLOYING`.
4. All members terminal → the bench settles. Recorded `launch_failures`
   (§8.2), or any member that ended `ERROR`, make the bench `ERROR`; otherwise
   any member that ended `FAILED` makes it `FAILED`; otherwise any member that
   ended `CANCELLED` makes it `CANCELLED`. No bench report runs in any of these
   cases (§8.3).
5. All members succeeded and nothing failed to launch → the bench's own report
   decides: in flight → `ANALYZING`, on disk → `SUCCEEDED`, script failed →
   `ERROR`.

A failing member never aborts its siblings — instances are independent — so the
bench stays active until every member is terminal.

Note the order: a recorded launch failure decides the bench's *final* outcome,
but it does not cut the run short. A bench that dispatched ten of twelve
instances still reads `RUNNING` while those ten work, and only settles at
`ERROR` once they are all terminal. Steps 2 and 3 come first for exactly that
reason.

### 9.2 Members that cannot be resolved

A bench run's members are ordinary job runs living in their own jobs' folders,
referenced by `{run_id, job name}`. If that job is unregistered later, or its
record is gone, the member cannot be resolved.

The bench run then reads `ERROR`, and **names the members it cannot find** —
their job names are in the record, so cocoa always knows which ones are missing.
Re-registering the job heals every one of its member rows and the bench returns
to its real status.

---

## 10. When cocoa cannot see a run

Execution failure and query failure are different facts. A run cocoa cannot
currently see is not a run that failed, and `UNREACHABLE` exists so that the
difference survives: it sits on the same status axis, but it is **not terminal**
and it does not end anything.

A poll that cannot reach its scheduler says so and exits **0** — it did its
job; the scheduler is the problem:

```
COCOA_RETURN: UNREACHABLE squeue: connection timed out
```

cocoa moves that run to `UNREACHABLE`, showing the reason and the last known
status beside it (`UNREACHABLE — last known RUNNING`). Polling continues, and
the next successful poll overwrites it. Nothing needs recovering by hand. (A
scheduler that is down for one run is usually down for all of them — each
run's own poll call reports it for itself.)

A poll that **exits non-zero** is broken code rather than an unreachable
scheduler, but the effect on cocoa is the same — it cannot see the run — so it
is treated the same way: that run goes `UNREACHABLE` with
`poll script failed: <captured output>` as the reason, and the failure is also
raised as a loud operation error so the script gets fixed. Fixing it heals
everything on the next tick.

---

## 11. Reports

On the healthy path, report progress is part of the status axis, not a second
one: `COMPLETED` → `ANALYZING` → `SUCCEEDED` *is* the report lifecycle, and a
report script that fails leaves the run at `ERROR` with its output attached.
That `ERROR` is the one healable case: fixing the script and re-running report
by hand moves the run to `SUCCEEDED` — the cluster had already said
`COMPLETED`, and `SUCCEEDED` is cocoa's word for finished *and* reported
(§7.3).

The one report off that axis is a `FAILED` run's. Its status is already
terminal and is the cluster's to set, so its report keeps its own state —
owed, landed, failed — in the record's `report` field (§7.3.1).

It follows that:

- a succeeded run always has `report/<run_id>.txt`;
- a `FAILED` run has one once its report has landed — not while it is owed,
  not when its script failed, and not if it was `FAILED` before 2026-10-06
  until someone reports it by hand;
- a `CANCELLED` or `ERROR` run has no report;
- `report/<run_id>.html` is optional and may accompany the text one.

The UI offers one open action per format that exists — the HTML one appears
only when that file is there. Plain text renders in the app; HTML is handed to
the system browser, the only thing that renders it faithfully.

---

## 12. What cocoa writes

To be exhaustive, inside a registered folder cocoa creates and maintains only:

- `runs/<run_id>/run.json` — the record;
- `runs/<run_id>/<rendered template>` — jobs, at launch;
- `runs/<run_id>/members.json` — benches, before a bench report;
- `report/` — the directory, created before a report script runs. Its
  **contents** are the script's.

Records are written atomically: temp file, then rename.

A launch that fails leaves its rendered artifact in place and writes no record
(§7.1) — the file is there for inspection, and the run id it was rendered under
is never reused (§5).

A malformed `run.json` fails **that run only**, which is shown as a broken row
carrying its error. It does not blank the folder's history — one corrupt file
must not hide hundreds of good runs.

cocoa never edits a script, a template, or a report.

### 12.1 Deleting a run

Deletion is the one operation that removes what cocoa wrote, and it is exact:
`runs/<run_id>/` goes whole — record, rendered artifact, `members.json` —
and so do `report/<run_id>.txt` and `report/<run_id>.html`. The folder's
other runs stay.

A fan-out is deleted whole, from the bench's side. A run a bench dispatched
cannot be deleted through its job — the refusal points at the bench run —
and deleting the bench run removes every member run it dispatched, each
from its own job's folder, along with the bench's own files. A member that
cannot be resolved (§9.2) has nothing left to delete and does not block the
rest. Deletion therefore never leaves half a fan-out behind: no bench
pointing at members that are gone, no member naming a bench that is.

Only a finished run can be deleted. An active run is refused — cancel is how
work stops — and so is `UNREACHABLE`: a run cocoa cannot see may still be
running, and deleting its record would be the one way to never find out. A
`FAILED` run whose report is still owed is refused until it lands (§7.3.1). A
bench run must be settled **and** every resolvable member finished, owed
reports included: a bench settles when one member fails (§9.1) while another
may still be running, and a running record is never deleted.

Because a run id is derived from the folder's own runs (§5), deleting the
newest run hands its id, and every id above what remains, back to the next
start. That is the deliberate consequence of having no counter beside the
disk; deleting from the middle frees nothing.
