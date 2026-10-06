# What testing and driving found

## Three the tests found

- **`invoke.ts` could hang forever.** The invocation was answered on Node's
  `close`, which waits for the stdio pipes rather than the process. A killed
  `#!/bin/sh` script whose own child outlives it — or any launch script that
  backgrounds something — keeps that pipe open, so a timed-out script never
  returned and the refresh tick would never run again. Now it answers on
  `exit` plus a 100 ms drain window, and `close` short-circuits it when it
  comes. Reproduced 2 runs in 3 before the fix.
- **`template.ts` accepted `{{ loop.index }}` outside a loop.** `loop` had
  been put in the builtins list; it is not a global, it is bound by the `for`
  body (which the walker already does). The list is now nunjucks' actual
  globals — `range`, `cycler`, `joiner` — so a template that would fail at
  render is refused at analysis, which is the whole point of analysis.
- **`template.ts` counted `is`-test names as variables.** `{{ size is
defined }}` demanded a param called `defined`. The walker now handles `Is`
  nodes: the left side is data, the test name is language, and the test's
  arguments are data again.

One further tightening, not a bug: `buildWorld` now indexes runs oldest-first,
so two runs that tie on `started_at` (possible at the port's millisecond
precision, unlike chrono's nanoseconds) stay in run-id order.

## What driving the app found (two more)

Neither of these could have been found by a green test suite; both came from
`npm run drive` on the built app.

- **A cancel could be silently undone by a poll already in flight.** The
  refresh tick's `poll` script takes tens of milliseconds (the mock's is
  `python3`). A cancel asked meanwhile finished first and set `CANCELLING`;
  the poll's answer — formed before the cancellation existed — then landed on
  top, and the run read `RUNNING` again with the user's cancel visibly
  undone. The Rust engine cannot hit this because it owns its state on one
  thread (§43.3); the `refreshing` flag here only stopped two _refreshes_
  overlapping. First fixed by a serializing queue; now by the write guards of
  §26.2 — `poll_job` versions each run by its history length and drops a
  stale answer. `tests/races.test.ts` reproduces the stomp and holds the fix.
- **A `$state` proxy cannot cross IPC.** `window.cocoa.cancel(overlay.target)`
  passed a Svelte proxy to `ipcRenderer.invoke`, structured clone refused it,
  and the rejected promise left the modal on "Cancelling…" for ever with no
  error anywhere. Now `$state.snapshot` (the pattern `StartRun.svelte`
  already used) plus a `try`/`catch`, because nothing may wedge a modal.

One behaviour worth knowing rather than fixing: a run in `STARTING` whose
launch script has not been harvested yet has no submission id, so cancelling
it is refused with _"run 0 is still launching; there is no submission to
cancel yet"_ until the next tick (≤3 s). The button is offered because the
world carries no submission id — exactly as in the Rust UI, whose snapshot
does not carry one either. The refusal is shown in the modal, which stays
open.

## What driving the app found, part two

- **An entity's first run never lit its Explorer dot.** The renderer created
  the run index with `index[id] ?? (index[id] = [])`, which hands back the
  raw array the assignment evaluated to rather than the `$state` proxy that
  now stands in its place; every later `splice` wrote through the back of the
  store and notified nobody. The data was right the whole time, which is
  exactly why it survived: value assertions cannot see it. Read the list back
  after creating it.
- **`recover()` was closing overlays out from under their own operations.**
  The rule "an overlay about something the world no longer contains closes"
  is right for an accident and wrong for a removal the user just asked for:
  the entity disappears, the overlay is closed, and the answer — including
  the confirmation — is thrown away. An overlay with `busy` set is now left
  alone; it answers for itself.
- **A removal used to explain itself as an accident.** Removing an experiment
  while its page was open let `recover()` speak first, so the user's own
  action was announced as "that run is no longer listed". `confirmRemove`
  now leaves the page before asking, and puts the route back if the removal
  is refused.
- **The driver could not end.** On macOS closing the last window does not
  quit the app (the platform convention, which `index.ts` followed at the
  time), so Playwright's `app.close()` waited for an exit that never came — a
  run took over ten minutes and had to be killed. It now asks nicely, waits
  three seconds, and insists. (Cocoa has since dropped that convention — the
  last window's close quits the app on every platform — but the driver keeps
  its insistence.)

## What driving the app found, part three

- **The agent socket was answering in chunks.** Node uses
  `Transfer-Encoding: chunked` when no `Content-Length` is set, and the bundled
  `cocoa-mcp-server` reads a reply as "everything after the blank line" — the
  minimal HTTP a client on a private socket is entitled to. Its `cocoa_start`
  came back as `e\r\n{"run_id":"1"}\r\n0\r\n\r\n`: the run id was in there,
  which is exactly why a `contains` assertion would have passed. Fixed by
  framing every reply with a `Content-Length`; the test now parses the body
  rather than searching it.
- **The sidebar drag stopped halfway.** The handle relied on pointer capture,
  and the handle moves _with_ the sidebar it is resizing — so the moment the
  width lagged the pointer or capture was dropped, the pointer was over the
  page instead and the drag ended at whatever width the last event it saw
  happened to name. It now listens on the window for the duration of the drag.
  Two drives in a row disagreed about the final width, which is what gave it
  away.
- **The arrangement lagged the window by two debounces.** The renderer
  coalesces a drag's hundred widths, and the main process was coalescing the
  result again. The renderer's message is already final, so it is written
  straight through; only the window's own resize/move stream is debounced.
- **A startup failure had nobody to tell.** The agent interface binds while
  the page is still loading, and a `notice` is not part of the bootstrap — so
  a refused socket was announced to a window that could not yet hear it, and
  the message vanished. Notices raised before the first bootstrap were then
  held and delivered just after it. (That machinery is gone again: a refused
  socket now crashes the app — no agent interface, no cocoa — so there is no
  startup notice left to hold, and `agent-busy.mjs` went with it.)
- **A window nobody moves has no geometry to remember.** Geometry was read on
  `resize`/`move` only, so it was never recorded for exactly the people who
  leave the window where it opens. Every write reads it now, whatever prompted
  the write.

## Known inconsistency, inherited from the first implementation

A dispatched run's page shows `Call 1` and `Started by nightly-benchmark ·
call 2` for the same run. They come from two places: `plan.steps[].index` is
the plan's 0-based position, and the run record's `origin.call` is stamped
`index + 1` by the engine (`campaign.ts`). The first implementation displayed both
the same way, so this was faithful rather than newly wrong — but a reader
seeing both at once has no way to know that. Fixing it means picking one
convention for display.
