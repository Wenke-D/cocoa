# 26. The Engine Boundary

The engine is the whole domain: manifests, templates, the run lifecycle, the
poll protocol, reports, cancel, campaign fan-out. It lives in the **main process**
(`src/main/engine/`) and the renderer never contains a copy of any of it.

The renderer reads a snapshot and asks for operations by name. It must not
mutate domain state, and there must be no path by which it could.

```ts
// src/main/bridge/operations.ts — plain functions over the engine, so they can be
// exercised without an Electron app around them. The ipcMain handlers in
// index.ts are wiring: call one of these, publish, answer.
start(engine, name, parameters, trigger): StartResult
cancel(engine, target): CancelResult
addFolder(engine, picked): AddFolderResult
remove_folder(engine, entity_id): RemoveFolderResult
report(engine, target): ReportResult
rerun_report(engine, target): RerunReportResult
refresh(engine): RefreshReport
```

Every one of them **answers rather than throws**. A refusal is an outcome the
user reads — an invalid manifest, a campaign plan with a bad call, a report too
large to send — not a crash and not an exception the renderer has to catch.

`start` on a Campaign entity performs the whole fan-out: it produces the plan,
validates it against the Explorer, dispatches every call, and returns the Campaign
run id. Plan production lives behind this boundary — the UI never builds a plan.

Because a Campaign dispatch creates several Job runs at once, `start` must be
atomic from the UI's perspective: either the Campaign run and all its child runs
exist, or nothing was created.

`trigger` — `Human` or `Agent` — is the whole difference between a click and an
agent's call (§43): same lookup, same validation, same guarded engine, one
word on the record (§10.6).

## 26.1 Memory Is the Truth

The engine holds the domain in memory. Reads never touch disk. Writes go to
memory first and are then written through to the experiment folders, so the
folders stay the record ([convention §12](../convention/12-what-cocoa-writes.md)) without being on the read path.

cocoa's own files are cocoa's alone: run records are read once, when a folder
is first seen (startup, or its registration), and never re-scanned — an
outside edit shows up at the next open, not the next tick. Manifests stay the
user's authored files, so each refresh tick re-reads `cocoa.toml` and an edit
lands within 3 s.

`store.json` persists only what is not in the folders — the registered folders
and which side each is on, jobs or campaigns, and nothing else — not the runs,
which live in the folders, and not a run-id counter, which was retired in
favour of deriving an id from the experiment's own records (convention §5).

The kind is remembered so that a folder whose manifest breaks stays listed as
what it was, carrying the error; a manifest that changes kind moves the folder
across, and the store follows (convention §5). In memory that is two maps, of
`Job` and `Campaign`, each holding its manifest as last read and its runs — there
is no type over both.

## 26.2 Guarded Writes, No Queue

There is no queue on the engine. Synchronous work is atomic on the event loop
for free; the only interleaving points are the `await`s around scripts, and
every write that follows one guards itself against the world having moved:

- `poll_job` records each run's `history.length` before its script and drops
  an answer formed before any later change — the stale poll that used to
  write the pre-cancel status back over `CANCELLING` now lands on nothing.
  The next tick re-asks with fresh eyes.
- `cancel_run` re-checks cancellability after its script: a run that ended on
  its own meanwhile keeps its own ending.
- `start_job` reserves the run id and its record in the same synchronous
  stretch that picked the id, before the spawn's `await`, so two concurrent
  starts cannot share an id.
- Refreshes are single-flight (`refresh.ts`): the clock's tick is dropped
  while one runs, a person's waits and then answers — so poll, harvest and
  report never overlap themselves.

The price of no queue is this discipline: a new write placed after an `await`
must bring its own guard. The prize is that a cancel or a start runs the
moment it is asked, never behind a slow poll.

## 26.3 The Backend Judges Change

The renderer is told conclusions, never asked to work them out.

The main process keeps its own model of the world, rebuilds it each cycle, and
turns the difference into events (`diff_worlds` in `src/main/bridge/sync.ts`):

```text
cocoa:bootstrap   once, on load — the one full-state message
cocoa:events      batches thereafter:
                   entity   | job-run | campaign-run   upserted | removed
                   notice
                   refreshed                        (content-free heartbeat)
```

Rules that make this safe:

- **Upserts carry the whole entry.** Entry-level over-push, never field diffs.
- **A removal names the experiment as well as the run.** An upsert does not
  need to — the run carries its own `job_id` — but a removal has no run left to
  carry it, and a run id alone no longer identifies anything (§10).
- **One batch per logical operation**, so the renderer never sees a torn world.
  A start's events are sent *before* its answer resolves.
- **`last_successful_query` is excluded from entry identity.** It changes on
  every rebuild, so including it would mark every entry changed on every tick.
  When query health actually flips, other fields change with it.
- A fresh page owns nothing, which is why bootstrap is irreducible.
- The Events view (§11.1) is the renderer's alone: it holds every entry as
  it was, so when an upsert arrives it can say what moved, in a sentence
  (`journal.ts`). The backend sends nothing for it and keeps nothing; a fresh
  page starts with an empty journal.

## 26.4 Notices

A refresh that fails sends a `notice` event. The engine refreshes every three
seconds, so a cluster answering badly answers badly on every tick: the question
worth putting on screen is never "did this pass fail" but "is this a new
failure". `src/main/bridge/notices.ts` announces a failure once and then holds still
while it repeats.

A refresh the user asked for always answers, including `Refreshed.` when there
is nothing else to say. Errors stay until dismissed; anything else fades.
