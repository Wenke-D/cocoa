# Test fixtures

Two experiment folders that exist to be _driven_, not demonstrated: the
automated suites copy them into a temp directory and run the engine against the
copy. They are real folders with real executable scripts, so you can also
register a copy and watch cocoa work on it by hand.

They live here, beside the suites, rather than in the demonstration library at
`examples/`. That library is a thing to be _shown_ — a user picks one of its
folders in Add Folder and watches a run go by. These two are apparatus.

## `job/` — manifest name `fixture-job`

Driven by two state files, neither of them committed; a test writes the ones it
needs after copying.

- `poll-state` — one status word, plus an optional reason, that the poll reports
  for every submission. Default `RUNNING`.
- `report-state` — `fail` makes the report script exit 1.

## `bench/` — manifest name `fixture-bench`

Driven by `plan-lines`: one planned call per line, as the JSON object the plan
contract expects.

## How one folder serves many tests

The manifest name is rewritten on copy (`fixture-job` → whatever the test calls
it), which is how one folder serves twenty-odd scenarios and how the
duplicate-name case gets two folders that claim the same name.

A test whose subject is a _broken_ script — a launch that exits 1, a poll that
cannot reach the cluster — overwrites that one script in its copy. The failure
is what the test is about, so it belongs in the test, not in here.

Used by `tests/support.ts`.
