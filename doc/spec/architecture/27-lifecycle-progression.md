# 27. Lifecycle Progression

## 27.1 Job Start

```text
Starting → Running → Completed → Analyzing → Succeeded
```

`Starting` means the launch script was spawned, not that it answered (§3). The
refresh tick harvests the submission id. The poll script's reported word drives
the rest; `Completed` and `Analyzing` are the report's half (§10.2).

Also reachable:

```text
Running → Failed          (its report runs after, beside the status)
Running → Cancelling → Cancelled
anywhere → Error          (cocoa could not carry out its own side)
```

`Failed` is terminal the moment poll says it, and stays so: the report a failed
run gets is recorded beside its status and never moves it (convention §7.3.1).

## 27.2 Campaign Start

Starting a Campaign creates a Campaign run plus one Job run per plan call, all at once.

```text
Campaign: Starting

Call 1: Starting
Call 2: Starting
Call 3: Starting
...
```

Every call starts together. No call is ever `Pending` on cocoa's account — only
the cluster can make a run pending.

Children advance independently, and finish out of order:

```text
Campaign Running · 0 / 6 finished
Call 2 Succeeded          Campaign Running · 1 / 6
Call 5 Failed             Campaign Running · 2 / 6   ← siblings keep running
Call 1 Succeeded          Campaign Running · 3 / 6
Call 3 Succeeded          Campaign Running · 4 / 6
Call 6 Succeeded          Campaign Running · 5 / 6
Call 4 Succeeded          Campaign Failed  · 6 / 6   ← aggregate resolves last
```

The Campaign must not reach a terminal status while any child is still active, and
a failed child must not stop its siblings. The Campaign's status is **derived** from
its children, not stored independently of them.

## 27.3 The Refresh Tick

One interval drives everything: `REFRESH_INTERVAL_MS = 3000` in
`src/main/index.ts`. On each tick the engine harvests pending launches, polls
active runs, takes reports that are due, re-reads manifests, rebuilds
the world, and publishes the difference.

A tick that finds a pass under way is dropped. The status bar's refresh queues
behind it instead, one at a time: a second one while it is pending is ignored,
and the button is held down until the answer so that never happens by hand.

There is no filesystem watcher (§4.3) and no per-run timer. Duration fields tick
in the renderer off a clock of its own; they are display, and they must not
cause a request.
