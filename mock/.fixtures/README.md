# Test fixtures

Two experiment folders that exist to be *driven*, not demonstrated: the
automated suites copy them into a temp directory and run the engine against
the copy. They are real folders with real executable scripts, so you can also
register a copy and watch coco work on it by hand.

The directory is hidden on purpose, and two things rely on it. `coco-egui/`'s
Add Folder scan skips names beginning with `.` (`experiment_folders` in
`coco-egui/src/adapter/engine.rs`), so picking `mock/` there registers exactly
the four demonstration experiments and none of these. And
`coco-electron/tests/mock-library.test.ts` walks the library the same way, so
the suite that exercises the *demonstration* folders does not pick up the
*fixture* folders.

| Folder | Manifest name | Driven by |
|---|---|---|
| `job/` | `fixture-job` | `poll-state` — one status word (plus an optional reason) that the poll reports for every submission; default `RUNNING`. `report-state` — `fail` makes the report script exit 1. |
| `bench/` | `fixture-bench` | `plan-lines` — one planned call per line, as the JSON object the plan contract expects. |

Neither state file is committed: a test writes the ones it needs after copying.

The manifest name is rewritten on copy (`fixture-job` → whatever the test
calls it), which is how one folder serves twenty-odd scenarios and how the
duplicate-name case gets two folders that claim the same name.

A test whose subject is a *broken* script — a launch that exits 1, a poll that
cannot reach the cluster — overwrites that one script in its copy. The failure
is what the test is about, so it belongs in the test, not in here.

Used by `coco-electron/tests/support.ts`. The egui suite still writes its own
copies inline (`coco-egui/tests/coco_engine.rs`); pointing it here too would
give both engines literally the same fixtures.
