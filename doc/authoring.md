# Writing a job or a bench

This is the guide for authoring an experiment folder — everything needed to
build one that coco can register, start, watch and report, with nothing else
required reading. The normative contract, with every edge case and the
reasoning behind it, is [convention.md](convention.md); section references
below (§) point into it. Where this guide and that document disagree, that
document wins.

coco manages two kinds of experiment:

- A **job** is an independently launchable experiment. One start = one run =
  one submission to whatever runs it (a cluster, a queue, a local process).
- A **bench** is a fan-out launcher: its plan turns the bench's parameters
  into instances of jobs *already registered in coco*. A bench never defines,
  contains, or owns jobs.

An experiment is a folder. coco is pointed at the folder, reads `coco.toml`,
and from then on invokes the scripts the manifest declares. It stores its own
records inside the folder — copy the folder and the history comes along.

## 1. The folder

```
<entity folder>/
  coco.toml              # the manifest: the interface to coco
  job.sbatch.tmpl        # jobs: the template (the middle name is yours)
  launch.sh  poll.py  report.py  cancel.sh
  runs/                  # maintained by coco: this folder's history
    <run_id>/
      run.json           # record: arguments, submission id, status history
      job.sbatch         # the rendered template (jobs)
      members.json       # the fan-out (benches)
  report/                # report output, at the folder root
    <run_id>.txt         # required
    <run_id>.html        # optional
```

coco creates and maintains only `runs/` and `report/` (§12); it never edits a
script, a template, or a report. Registration is by path, and editing
`coco.toml` takes effect without re-registering — the manifest is re-read on
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
template    = "job.sbatch.tmpl"     # rendered by coco before launch

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
```

All four scripts are **required**. A run whose status can never update is a
dead end in a monitoring tool, and a run that cannot be stopped is worse — a
folder that truly has nothing to cancel still declares a `cancel` script,
even one that only exits 0.

A manifest either loads or it does not (§4). A broken one leaves the folder
visible in coco, carrying the error, until it is fixed in place.

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
- `run_id` is not available, nor any other coco-supplied value. A run has no
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
beginning with `COCO_RETURN: ` are the answer; everything else is free
logging (§6).

**`launch`** — `./launch.sh --script runs/41/job.sbatch --run 41 --gpu 1`.
Submits however it likes and prints the identifier coco will track:

```
COCO_RETURN: 5001
```

One token, no whitespace; the last such line wins. The submission id is
opaque to coco and is handed back to `poll`, `report` and `cancel` for the
rest of the run's life. Exit 0 without a return line is a failed launch:
nothing is recorded (§7.1).

**`poll`** — `./poll.py --submission 5001`, called per active run on a
timer. Prints one line:

```
COCO_RETURN: RUNNING
COCO_RETURN: FAILED node fell over
COCO_RETURN: UNREACHABLE squeue timed out
```

The words coco accepts: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`,
`CANCELLED`, and `UNREACHABLE` (§9). `COMPLETED` means the work finished and
the report has not been taken yet — coco then runs `report` by itself.
`FAILED` and `UNREACHABLE` may carry a reason after the word. `UNREACHABLE`
is for "I cannot see the cluster right now": coco keeps polling, shows the
last known status, and the next good answer replaces it (§10).

**`report`** — `./report.py --run 41 --submission 5001`. Writes
`report/41.txt` (required; `report/41.html` optional beside it) and prints
nothing to coco. A report script that exits 0 without producing the file is
a failure.

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

A bench has no template, no launch, no poll, no cancel of its own: it
launches through its member jobs, its status is derived from theirs, and it
is cancelled by cancelling them (§3, §9.1).

**`plan`** — `./plan.sh --mesh fine`. Prints one JSON object per instance to
launch:

```
COCO_RETURN: {"job": "solver-gpu", "params": {"size": "256", "gpu": "0", "backends": ["cuda"]}}
COCO_RETURN: {"job": "solver-gpu", "params": {"size": "512", "gpu": "1", "backends": ["cuda", "hip"]}}
```

`job` names a registered job; `params` supplies exactly that job's
parameters — render and launch together, no extras, none missing, each value
of its declared shape (string, or array of strings for a list). Every
instance is validated before anything is submitted, and every fault is named
at once (§8.1). A plan that produces no instances fails the start. `plan`
takes no run id, which is what lets it double as the dry run coco shows
before dispatching.

**`report`** — `./report.py --run 7 --members runs/7/members.json`. The
members file lists every dispatched run — its job, arguments, submission id,
and where that job's report landed — so the bench's report can aggregate
them. Output rules are the job report's: `report/7.txt` required.

## 7. What to count on, and what not to

- Values arrive exactly as given — separate argv elements, no shell, no
  expansion, no re-quoting.
- Records in `runs/` are readable JSON and safe to read from scripts; they
  are written atomically. Never write them.
- Timeouts (defaults): launch, poll, cancel 60 s; plan 120 s; report 600 s.
- A run coco deletes takes `runs/<id>/` and `report/<id>.*` with it — for a
  bench run, its dispatched runs too (§12.1); run ids otherwise never repeat.
- Nothing else in the folder is coco's business: keep source, data and
  scratch wherever suits the scripts.
