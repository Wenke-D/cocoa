# 2. `cocoa.toml` — a job

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

## 2.1 The two parameter sets

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

## 2.2 A parameter's shape

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
