# 6. Invocation rules

Every script cocoa invokes:

- runs with **cwd = the entity folder**, so relative paths in the manifest and
  inside the script resolve against it;
- receives arguments as `--name value` pairs only, never positionally — a
  list is the pair repeated, `--tags a --tags b`, one per item. A script
  parses every parameter the same way, and a loop that reads pairs never
  slips;
- receives user-supplied values as **separate argv elements**;
- receives **only** the arguments this convention specifies plus the declared
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

## 6.1 Template rendering

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
