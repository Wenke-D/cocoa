# 37. Testing

Tests run under vitest against **real temp folders and real executable
scripts** — never mocks of the filesystem or of a process. The shared fixtures
live in `cocoa-electron/tests/fixtures/` (see its README); a suite copies one,
points it at a scratch store, and drives it.

The end-to-end scenarios began as ports of the first implementation's suite;
the questions outlived it.

Current coverage: 195 cases across 18 files — `engine`, `manifest`, `template`,
`invoke`, `status`, `store`, `words`, `world`, `operations`, `races`, `sync`,
`notices`, `uiState`, `agent`, `state.svelte`, `example-library`.

## 37.1 Engine Tests

At minimum, test:

1. Starting a Job creates a `Starting` run.
2. Advancing a Job moves it from `Starting` to `Running`.
3. Cancelling a Job moves it through `Cancelling` to `Cancelled`.
4. Starting a Campaign dispatches one run per plan call, all active at once.
5. Every run a Campaign dispatches also appears in the referenced Job's own history,
   stored exactly once, with `RunOrigin::CampaignStep`.
6. A plan may reference the same Job several times; each call gets its own run
   and its own parameters.
7. A failed child does not stop its siblings; the Campaign stays `Running` until
   every child is terminal, then becomes `Failed`.
8. A Campaign whose plan references an invalid or missing Job fails to start and
   dispatches nothing.
9. Cancelling a Campaign cancels exactly its still-active children, leaves finished
   children intact, and leaves unrelated runs of the same Jobs untouched.
10. Cancelling one child run does not cancel the Campaign run or its siblings.
11. Query failure does not overwrite the last known execution status.
12. Report generation changes report state to Available.
13. Starting a Job while runs are active always succeeds and creates an
    independent run.
14. A Job run that fails is reported and stays `Failed`; a report script that
    fails on it records the report's error and leaves it `Failed`, never
    `Error` (convention §7.3.1).

## 37.2 Route Tests

Test:

- Selecting an entity opens its overview.
- Opening a Job run produces the correct route.
- Opening a Campaign child run preserves Campaign context and Explorer selection.
- Opening the same run from the Job's history yields `JobRunDetail` and selects
  the Job instead — same run record, different context.
- Opening and closing a report returns to the correct parent.
- Missing entity and missing run routes recover without panic.

## 37.3 Sync and Protocol Tests

Test:

- A rebuild with no change produces only the `refreshed` heartbeat.
- A `last_successful_query` stamp moving on its own produces no upsert.
- One logical operation produces one batch.
- A removed entity produces a `removed` event, and its runs go with it.
- A restored `ui-state.json` that is stale, malformed, or hand-edited comes back
  sanitized rather than rejected (§32).

## 37.4 Build Checks

The repository should pass:

```bash
npm run gate       # format:check → lint → check → test, cheapest failure first
npm run build      # the three bundles
```

or each on its own:

```bash
npm run format:check   # prettier
npm run lint           # eslint, with type-aware rules
npm run check          # svelte-check on the renderer, tsc --noEmit on main + preload
npm test               # vitest
```

Run these on both macOS and Linux where CI is available.

Three ESLint rules are on for a reason rather than by default:

- `no-floating-promises`, because an unawaited engine call runs unobserved and
  its failure vanishes (§26.2), and `no-misused-promises` with it.
- `curly: all`, so a body always gets braces and Prettier then always puts it
  on its own line. `if (x) return` reads as one thought and hides that it is
  two — the condition, and what happens — and a body on its own line is also
  what leaves room to add to it without restructuring first.

One is off for a reason: `require-await`, because here `async` is usually the
*contract* — an IPC handler answers a promise, a `Turn` takes one — and a body
that does not await yet is not a defect.

---

## 37.5 What the suites actually cover

`npm test` — vitest, 287 cases, a few seconds, no mocks of the filesystem or of
`child_process`: every scenario writes real folders and real executable
scripts into a temp directory and lets the engine spawn them.

| File                                                                                                                                        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/engine.test.ts`                                                                                                                      | All 20 end-to-end scenarios of `coco-egui/tests/coco_engine.rs`, plus registration idempotence + unregister and the records-read-once rule the Rust engine has no equivalent of: a corrupt `run.json` fails only its own run at the next open, and an outside edit is ignored until then. A manifest broken at the next open leaves its folder on the side it registered on; one that changes kind moves it across. Deletion (§12.1): a finished run's files go and its neighbours' stay, an active or UNREACHABLE run is refused, a dispatched member is refused toward its campaign, a settled campaign run takes its members with it, and the ids above what remains are handed back.                                                                                                                                                                                                     |
| `tests/deploy.test.ts`                                                                                                                      | A start's check and deploy (convention §7.5, §7.6): `CURRENT` launches at once, `STALE` holds the run `DEPLOYING` until the deploy lands and then launches it, `CONFLICT` and a check that cannot say refuse with nothing recorded, and a failed deploy moves its runs to `ERROR`. The per-job gate: a second start waits for the first one's deploy and checks afresh. A campaign checks each job once, deploys a stale one once for all its members, and is refused whole when any check refuses. A deploy left running by a crash or a close ends its runs at `ERROR`.                                                                                                                                                                                                                                                                                                                 |
| `tests/example-library.test.ts`                                                                                                             | The bundled `examples/` library end to end — port of `coco-egui/tests/coco_mock_library.rs`, but over a **copy** in a temp dir, so a test run leaves no `runs/`/`report/` in the repo.                                                                                                                                                                                                                                                                                                            |
| `tests/world.test.ts`                                                                                                                       | `buildWorld`: entity shape, run shape, report state, UNREACHABLE display (last known status + unavailable query health), campaign plan steps, campaign-origin members, history ordering.                                                                                                                                                                                                                                                                                                            |
| `tests/agent.test.ts`                                                                                                                       | The agent interface (§43): every route as a function of a world and a start, then the same routes over a **real unix socket** with a real HTTP client — a start crossing the wire, an oversize body refused, a socket a live cocoa is answering on left alone, a stale one replaced, the file removed on stop, and every reply framed with a `Content-Length` (see below).                                                                                                                     |
| `tests/uiState.test.ts`                                                                                                                     | What a relaunch restores: `sanitize` (a report never comes back, a Start page becomes its experiment, widths clamped, unknown routes dropped, a window position taken only as a pair) and the file round trip, including one that does not parse.                                                                                                                                                                                                                                             |
| `tests/notices.test.ts`                                                                                                                     | `refreshSummary` (one error in full, the rest as a count) and the `NoticeGate`: a repeating failure announced once, a changed one announced again, a clean pass re-arming it, and a manual refresh that always answers and counts as said.                                                                                                                                                                                                                                                    |
| `tests/refresh.test.ts`                                                                                                                     | The refresh gate over a hand-resolved engine: the clock's tick dropped while a pass is under way and taken once idle; a person's refresh queued behind the pass, never alongside it, keeping the clock out while it waits; a second person's refresh ignored while one is queued or running.                                                                                                                                                                                                    |
| `tests/sync.test.ts`                                                                                                                        | `diffWorlds`: silence when nothing moved, the `last_successful_query` exclusion, upserts/removals for all three entry kinds, one batch for a member and its campaign.                                                                                                                                                                                                                                                                                                                            |
| `tests/operations.test.ts`                                                                                                                  | What the renderer can ask for (`src/main/bridge/operations.ts`): start by name with the manifest's parameter split, cancel a run, cancel a campaign, delete a finished run (and be refused an active one), read a report (including the plain-text-wins rule the world builder also follows, an unregistered folder, and a run id that is not one), add a folder (including that a folder of experiments is _not_ searched), remove one (and that the disk is untouched) — each answered, never thrown.                                                       |
| `tests/races.test.ts`                                                                                                                       | The engine's write guards under real interleaving: a cancel during an in-flight poll survives it (below), and two concurrent starts get distinct run ids.                                                                                                                                                                                                                                                                                                                                     |
| `tests/state.svelte.test.ts`                                                                                                                | The renderer's state, compiled as runes: event application, the run index, every `recover()` rule, the notice (an error waits to be dismissed, anything else fades, an older timer never clears a newer message), and the two-addresses rules for a dispatched run (§19) — the campaign stays selected, the fallbacks step back through the campaign run, and a report reads from the job's folder. It covers what the state _holds_, not what it _notifies_ — see the note at the top of the file.; the journal (newest last, a hundred at most), the last change, the activity bar's view gesture, and an entry taking the page to its run.; the history's row menu — a run started again, its refusal in a modal, and a prefill with what could not be filled said. |
| `tests/journal.test.ts`                                                                                                                     | `sentences_of`: the line an event earns, judged against the entry as it was — a run that started and by whom, a status that moved (with the reason for an error), a report that landed, a run lost and found, a folder that came or went, a manifest that broke or healed, a failure the user was told about — and silence for a field moving on its own.                                                                                                   |
| `tests/format.test.ts`                                                                                                                      | `format_duration`: a clock while the run is live, a length with its empty leading units dropped once it has ended, and never backwards; `format_relative`: the largest unit that fits, from seconds to years, singular at one.                                                                                                                                                                                                                                                                                                                                                   |
| `tests/params.test.ts`                                                                                                                      | A parameter's shape (`src/shared/params.ts`): what a value of each of the five shapes may be and the message when it is not, the wire form — pairs always, a flag as the word, a list repeated — and the engine's check of a whole set, which names every fault at once.                                                                                                                                                                                          |
| `tests/manifest.test.ts` `tests/template.test.ts` `tests/words.test.ts` `tests/status.test.ts` `tests/store.test.ts` `tests/invoke.test.ts` | Ports of the corresponding Rust inline `#[cfg(test)]` modules, plus a few cases for the async spawn/harvest seam this port introduces.                                                                                                                                                                                                                                                                                                                                                        |

The fixture experiment folders are **real folders in the repository**:
`tests/fixtures/job` and `tests/fixtures/campaign` (see their README). Tests copy
one per scenario and rename it in the copy, so one folder serves twenty-odd
cases. The `job` fixture answers from a `poll-state`/`report-state` file and
the `campaign` fixture plans from a `plan-lines` file, so most tests change
behaviour by writing data, not by rewriting a script; a test whose _subject_
is a broken script still overwrites that one script in its copy. They sit
beside the suites rather than in `examples/`, which is a library to be shown,
not apparatus: `tests/example-library.test.ts` walks `examples/` expecting the
four demonstration experiments.

`tests/support.ts` holds the helpers (`jobFolder`, `campaignFolder`, `planLines`,
`settle`, `handEdit`). Two things it is careful about, both of which bite
otherwise: temp dirs are `realpath`-ed (on macOS `/var` is a symlink and the
engine keys state by the canonical path), and `handEdit` pushes the file's
mtime forward so a simulated hand-edit is distinguishable from the engine's
own write in the same millisecond.
