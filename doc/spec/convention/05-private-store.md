# 5. The private store

The one thing that is cocoa's own state, and that no folder can say about
itself, is which folders are registered, and as what. That is all the store
holds:

```json
{
  "jobs": ["/abs/path/to/solver-gpu"],
  "campaigns": ["/abs/path/to/nightly"]
}
```

- **jobs**, **campaigns** — registered folder paths, on the side their manifest
  declared when they were registered. Adding a folder is registration, and it
  persists across sessions. Registering a path that is already in the store is
  a no-op. A folder whose manifest breaks later stays on its side, carrying the
  error (§4); one whose manifest now declares the other kind moves across at
  the next tick, and the store follows — the manifest decides, the store only
  remembers.

It lives in Electron's per-app, per-user data directory, beside `ui-state.json`
— on macOS `~/Library/Application Support/cocoa/store.json`, on Linux
`~/.config/cocoa/store.json`. `COCOA_STORE_PATH` overrides it, which is how a
drive run keeps its hands off the real one.

> It used to live at `~/.local/share/cocoa/store.json`, the same path hardcoded
> in both implementations so that a folder registered in one appeared in the
> other. That was the point while there were two. The workbench carries the
> file over once, by copy, and never looks at it again.

**Two fields have been retired**, and what replaced them is worth knowing:

- **`next_run_id`** was a monotonic counter making run ids platform-unique. It
  is gone, and so is platform-uniqueness: a run id is now allocated as one past
  the highest that *experiment* already has, read from its own records (§7).
  Two experiments both have a run `0`.

  The counter was a second opinion about what a folder contained, and the two
  could disagree — a folder carried over from another machine arrived with runs
  a fresh counter knew nothing about, and the next start overwrote one of them.
  Records cannot disagree with records. It also needs no crash handling: the
  run directory *is* the allocation, so a crash before it exists allocated
  nothing and a crash after it exists is skipped by the next maximum.

  A run id therefore no longer identifies a run on its own. Every address for
  one names its experiment too — a route, a cancel, a report, an agent path —
  which they all did already.

- **`last_args`** recorded the values each experiment was last started with, for
  an explicit *Fill from last run* action on the Start page. Both the field and
  the action are gone. §2's rule is unchanged and now unqualified: every
  declared parameter is supplied by hand, every time.

Names are platform-wide unique: registering a folder whose manifest name
collides with an already-registered one is refused. A currently-broken manifest
cannot collide, since it has no name.

This file stays plain JSON — it holds two short lists and being readable and
hand-editable is worth more than structure. If the global views (all active
runs, cross-entity history) ever make scanning every folder's `runs/` too slow,
the answer is a **rebuildable cache** that can be deleted at any time without
loss, never a second source of truth.
