# Writing a job or a bench

This is the guide for authoring an experiment folder — everything needed to
build one that cocoa can register, start, watch and report, with nothing else
required reading. The normative contract, with every edge case and the
reasoning behind it, is [convention.md](convention.md); section references
below (§) point into it. Where this guide and that document disagree, that
document wins.

cocoa manages two kinds of experiment:

- A **job** is an independently launchable experiment. One start = one run =
  one submission to whatever runs it (a cluster, a queue, a local process).
- A **bench** is a fan-out launcher: its plan turns the bench's parameters
  into instances of jobs *already registered in cocoa*. A bench never defines,
  contains, or owns jobs.

An experiment is a folder. cocoa is pointed at the folder, reads `cocoa.toml`,
and from then on invokes the scripts the manifest declares. It stores its own
records inside the folder — copy the folder and the history comes along.

## 1. The folder

```
<entity folder>/
  cocoa.toml              # the manifest: the interface to cocoa
  job.sbatch.tmpl        # jobs: the template (the middle name is yours)
  check.sh  deploy.sh  launch.sh  poll.py  report.py  cancel.sh
  runs/                  # maintained by cocoa: this folder's history
    <run_id>/
      run.json           # record: arguments, submission id, status history
      job.sbatch         # the rendered template (jobs)
      members.json       # the fan-out (benches)
  report/                # report output, at the folder root
    <run_id>.txt         # required
    <run_id>.html        # optional
```

cocoa creates and maintains only `runs/` and `report/` (§12); it never edits a
script, a template, or a report. Registration is by path, and editing
`cocoa.toml` takes effect without re-registering — the manifest is re-read on
every listing.

**Scripts must be runnable without guessing.** Either the file is executable
and carries a shebang (`command = "./poll.py"`), or the manifest names the
interpreter (`command = "python3 poll.py"`). There is no
extension-to-executor table and no shell: `command` is split into an argv
list lexically, nothing expands.

## 2. A job's manifest

```toml
kind        = "job"
name        = "solver-gpu"          # platform-wide unique
description = "GPU solver sweep"    # optional, shown on the overview page

[render]
template    = "job.sbatch.tmpl"     # rendered by cocoa before launch

[[render.params]]
name        = "size"
type        = "string"
description = "Nodes to request"

[launch]
command     = "./launch.sh"

[[launch.params]]
name        = "gpu"
type        = "enum"
values      = ["0", "1"]
description = "Which GPU to pin to"

[poll]
command     = "./poll.py"

[report]
command     = "./report.py"

[cancel]
command     = "./cancel.sh"

[check]
command     = "./check.sh"

[deploy]
command     = "./deploy.sh"
```

All six scripts are **required**. A run whose status can never update is a
dead end in a monitoring tool, and a run that cannot be stopped is worse — a
folder that truly has nothing to cancel still declares a `cancel` script,
even one that only exits 0. Likewise a folder with nothing to deploy declares
a `check` that always answers `CURRENT` and a `deploy` that exits 0.

A manifest either loads or it does not (§4). A broken one leaves the folder
visible in cocoa, carrying the error, until it is fixed in place.

## 3. Parameters

Parameters come in two sets with one meaning each: `[render].params` are
substituted into the template (they shape the artifact), `[launch].params`
are passed to the launch script (they shape the submission). A name may not
appear in both. Every declared parameter must be given a value at every
start — there are no defaults, no optional parameters, and no memory of what
was typed last time (§2.1).

Each parameter declares a **shape** (§2.2):

```toml
[[launch.params]]
name        = "backends"            # required; unique within the folder
type        = "enum"                # required: "string" or "enum"
values      = ["cuda", "hip"]       # enum only, and required there
list        = true                  # optional: the value is one or more
description = "Backends to build, one build each"   # required
```

| `type`   | `list`  | A value is…                                  |
|----------|---------|----------------------------------------------|
| `string` | —       | one non-blank string                         |
| `enum`   | —       | one of `values`, exactly (case matters)      |
| `string` | `true`  | one or more non-blank strings, none repeated |
| `enum`   | `true`  | one or more of `values`, none repeated       |

There is no boolean type: a yes/no parameter is an enum of two values —
`["true", "false"]`, or whatever words fit — and its value is the word. A
list is never empty; a parameter that may legitimately be absent declares an
enum with a value that says so. `description` is required: the start form
shows it under the field.

**How values reach a script**: always as `--name value` pairs, never
positionally, never bare. A list repeats the pair — `--tags a --tags b` — so
an argv loop that reads pairs never slips. In JSON (records, plan instances,
agent requests) a value is a string or an array of strings; booleans,
numbers and nulls are refused, never coerced.

## 4. The template

`[render].template` is a single self-contained [nunjucks](https://mozilla.github.io/nunjucks/)
file, rendered into `runs/<run_id>/` with the render params before launch:

```
#SBATCH --nodes={{ size }}
{% for b in backends %}--{{ b }} {% endfor %}
{% if profile == "true" %}--profile{% endif %}
```

Rules that are checked when the manifest loads (§6.1):

- The template's variables and `[render].params` must match **exactly** —
  an undefined variable is an error, and a declared param the template never
  uses is equally an error.
- `{% include %}`, `{% extends %}` and `{% import %}` are rejected; loops,
  conditionals, filters and `{% set %}` are fine.
- `run_id` is not available, nor any other cocoa-supplied value. A run has no
  need to name itself: launch returns the submission id, and that is the
  identity from then on.

A list value is an array in the template; a yes/no enum's value is a
**string**, and a non-empty string is always truthy — so branch on the word,
`{% if profile == "true" %}`, never the bare name.

## 5. The job scripts

Every script runs with **cwd = the folder**, gets only what this contract
names, has stdout/stderr captured, and can be killed from the UI. Exit 0
means the script did its job; non-zero (or a timeout) is a script failure,
reported with the captured output — it never marks a run finished. Lines
beginning with `COCOA_RETURN: ` are the answer; everything else is free
logging (§6).

**`check`** — `./check.sh`, no arguments, before **every** start (§7.5). Is
what the runs use — the executable, its configuration, any auxiliary material
— in place where they expect it? One line:

```
COCOA_RETURN: CURRENT
COCOA_RETURN: STALE solver.cfg changed since the last deploy
COCOA_RETURN: CONFLICT solver binary is in use by run 38
```

`CURRENT` launches at once. `STALE` means it must be put in place and nothing
running is harmed by that — say, a new config file: cocoa runs `deploy`, then
launches. `CONFLICT` means it must be put in place but doing it now would race
with work in progress — say, replacing a binary that a running run is
executing: the start is refused with the reason, and nothing is recorded.
Which change is which is your script's call; read `runs/*/run.json` to see
what is still active. A check that fails, prints no line, or a word other than
these three refuses the start too.

cocoa checks one job for one start at a time, so a second start waits for the
first one's deploy and then checks again — two deploys never overlap. A bench
checks each job it calls once, before dispatching anything, and any refusal
refuses the whole bench.

**`deploy`** — `./deploy.sh`, no arguments, when the check said `STALE`
(§7.6). Builds and copies whatever the check found stale to where the runs
expect it, and exits 0 when it is done; it prints nothing to cocoa. The run
shows `DEPLOYING` meanwhile, and launches once the deploy exits 0. A deploy
that fails moves every run waiting on it to `ERROR` with its output — none of
them was submitted.

**`launch`** — `./launch.sh --script runs/41/job.sbatch --run 41 --gpu 1`.
Submits however it likes and prints the identifier cocoa will track:

```
COCOA_RETURN: 5001
```

One token, no whitespace; the last such line wins. The submission id is
opaque to cocoa and is handed back to `poll`, `report` and `cancel` for the
rest of the run's life. Exit 0 without a return line is a failed launch:
nothing is recorded (§7.1).

**`poll`** — `./poll.py --submission 5001`, called per active run on a
timer. Prints one line:

```
COCOA_RETURN: RUNNING
COCOA_RETURN: FAILED node fell over
COCOA_RETURN: UNREACHABLE squeue timed out
```

The words cocoa accepts: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`,
`CANCELLED`, and `UNREACHABLE` (§9). `COMPLETED` means the work finished and
the report has not been taken yet — cocoa then runs `report` by itself. So
does `FAILED`; only `CANCELLED` ends a run without one.
`FAILED` and `UNREACHABLE` may carry a reason after the word. `UNREACHABLE`
is for "I cannot see the cluster right now": cocoa keeps polling, shows the
last known status, and the next good answer replaces it (§10).

**`report`** — `./report.py --run 41 --submission 5001`. Writes
`report/41.txt` (required; `report/41.html` optional beside it) and prints
nothing to cocoa. A report script that exits 0 without producing the file is
a failure.

It runs when the poll says `COMPLETED` **and** when it says `FAILED`, with the
same arguments; `COCOA_RUN_STATUS` in its environment says which (§7.3).
A failed run is where a report earns its keep — which stage broke, the
residuals, the tail of the solver log — so write for it:

```python
if os.environ.get("COCOA_RUN_STATUS") == "FAILED":
    ...  # say where it broke
```

A script that ignores the variable still works; it just reports a failed run
as it would a finished one. Whatever the report does, a `FAILED` run stays
`FAILED`: a report that fails there is recorded beside the run and shown as
the report's error, never as cocoa's `ERROR` (§7.3.1). Re-running the report
by hand — `Re-run report` on the run's page, or the agent socket — runs the
script again and overwrites it, for a failed run as for a completed one: the
way to regenerate old reports after changing the script (§7.3.2).

**`cancel`** — `./cancel.sh --submission 5001`. Tells the scheduler to stop
the run; the next poll reports what actually happened. Cancel requests the
stop, poll confirms it.

## 6. A bench's manifest and scripts

```toml
kind        = "bench"
name        = "nightly-benchmark"
description = "Mesh sweep across the GPU solver"

[plan]
command     = "./plan.sh"

[[plan.params]]
name        = "mesh"
type        = "enum"
values      = ["coarse", "fine"]
description = "Which mesh family to sweep"

[report]
command     = "./report.py"
```

A bench has no template, no launch, no poll, no cancel, no check and no
deploy of its own: it launches through its member jobs — each checked, and
deployed if stale, as at a job's own start — its status is derived from
theirs, and it is cancelled by cancelling them (§3, §7.5, §9.1).

**`plan`** — `./plan.sh --mesh fine`. Prints one JSON object per instance to
launch:

```
COCOA_RETURN: {"job": "solver-gpu", "params": {"size": "256", "gpu": "0", "backends": ["cuda"]}}
COCOA_RETURN: {"job": "solver-gpu", "params": {"size": "512", "gpu": "1", "backends": ["cuda", "hip"]}}
```

`job` names a registered job; `params` supplies exactly that job's
parameters — render and launch together, no extras, none missing, each value
of its declared shape (string, or array of strings for a list). Every
instance is validated before anything is submitted, and every fault is named
at once (§8.1). A plan that produces no instances fails the start. `plan`
takes no run id, which is what lets it double as the dry run cocoa shows
before dispatching.

**`report`** — `./report.py --run 7 --members runs/7/members.json`. The
members file lists every dispatched run — its job, arguments, submission id,
and where that job's report landed — so the bench's report can aggregate
them. Output rules are the job report's: `report/7.txt` required.

## 7. What to count on, and what not to

- Values arrive exactly as given — separate argv elements, no shell, no
  expansion, no re-quoting.
- Scripts inherit the environment cocoa was started with. cocoa adds one
  variable, `COCOA_RUN_STATUS` (`COMPLETED` or `FAILED`), and only for a
  job's `report` (§6).
- Records in `runs/` are readable JSON and safe to read from scripts; they
  are written atomically. Never write them.
- Timeouts (defaults): check, launch, poll, cancel 60 s; plan 120 s; deploy,
  report 600 s.
- A run cocoa deletes takes `runs/<id>/` and `report/<id>.*` with it — for a
  bench run, its dispatched runs too (§12.1); run ids otherwise never repeat.
- Nothing else in the folder is cocoa's business: keep source, data and
  scratch wherever suits the scripts.
