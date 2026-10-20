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

`npm test` — vitest, 290 cases, a few seconds, no mocks of the filesystem or of
`child_process`: every scenario writes real folders and real executable
scripts into a temp directory and lets the engine spawn them.

The suites mirror `src/`: the tests of `src/main/engine/job/start.ts` are
`tests/main/engine/job/start.test.ts`, and a file with no tests has no suite.
Renderer suites live under `tests/renderer/` and are type-checked by the web
config, since the modules they reach live in a window.

| Directory                       | Covers                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/main/engine/`            | The engine end to end over the fixture folders: each job and campaign operation, the check, deploy and per-job gate (§7.5, §7.6), runs read once at first sight, registration, deletion (§12.1), launches in flight and the refresh tick. |
| `tests/main/bridge/`            | What the renderer can ask for (`operations.ts`), the refresh gate, the world diff (`sync.ts`) and which failures are worth a notice.                                                                                                        |
| `tests/main/agent/`             | The agent interface (§43), every route over a real Unix socket with a real HTTP client.                                                                                                                                                    |
| `tests/main/shell/`             | What a relaunch makes of the window state, and its round trip through disk.                                                                                                                                                                 |
| `tests/renderer/src/`           | The renderer's state, compiled as runes — applying events, recovering a lost address, notices, navigation, the modals, the history's prefill — and the journal's sentences, formatting, tones and the stored arrangement.                   |
| `tests/shared/`                 | A parameter's shape: what a value of each shape may be, and its wire form.                                                                                                                                                                  |
| `tests/example-library.test.ts` | The bundled `examples/` library end to end.                                                                                                                                                                                                  |

The renderer suites cover what the state *holds*, not what it *notifies*:
`$effect` does not schedule without a DOM, and `$derived` recomputes instead of
caching, so a lost reactive notification passes every assertion there. That
failure mode is caught where it shows, by the drive scenarios.

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

`tests/support/` holds the helpers, one file per kind: temp dirs, files,
fixtures (`job_folder`, `campaign_folder`, `plan_lines`), the engine
(`settle`), run paths, and the agent's socket harness. Two things they are
careful about, both of which bite otherwise: temp dirs are `realpath`-ed (on
macOS `/var` is a symlink and the engine keys state by the canonical path),
and `hand_edit` pushes the file's mtime forward so a simulated hand-edit is
distinguishable from the engine's own write in the same millisecond.