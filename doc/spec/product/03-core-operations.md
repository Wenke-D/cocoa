# 3. Core Backend Operations

The real product will eventually expose three operational concepts:

```text
Check
Deploy
Start
Query
Cancel
```

Every Start is preceded by a **Check**: the job's own script says whether
what its runs use is in place. `CURRENT` starts at once; `STALE` runs the
job's **Deploy** first, the run reading `DEPLOYING` until it is done;
`CONFLICT` — a deploy now would race with work in progress — refuses the start
with the script's reason. One job is checked and deployed by one start at a
time, so deploys never overlap (convention §7.5, §7.6).

Starting a Job begins execution directly. A start means *launched*: the run
exists, visibly `STARTING`, from the moment its launch script is spawned. The
script's answer arrives in its own time and is collected by the refresh tick —
a submission id completes the record; a failure or timeout moves the run to
`ERROR` with the output attached. Only a script that cannot be spawned at all
refuses the start itself, because that is a folder problem the submitter can
act on now.

Closing cocoa waits for nothing. In practice a start is watched until it shows
running before anyone walks away, so a close with a launch still unanswered
is the rare worst case, not one worth a grace period — cocoa handles it by
being honest instead of by waiting. An answer that already arrived is still
collected on the way out; a script that has not answered is killed and its
run moved to `ERROR` at the close, recording that cocoa closed too soon and
the run can no longer be tracked (§10). Only a *crash* leaves a run
mid-launch with nothing recorded; the next refresh finds it and moves it to
`ERROR`, because the stdout that carried its submission id died with the
process that read it.

Starting a Campaign returns a **plan** — a list of `(existing Job, parameters)` calls,
all dispatched at once. The Campaign itself executes nothing; it fans out to Jobs.
Each dispatch is an ordinary Job Start.

Who triggers what:

- **Check** is automatic, before every Start; **Deploy** follows a `STALE`
  check. Neither is a user action of its own.
- **Start** is triggered by the user, or by an agent through §43.
- **Cancel** is triggered by the user after confirmation.
- **Query** is automatic, on the refresh tick.
- Query must not be presented as a primary user action.
- A small manual Refresh action must be provided as a fallback.

Report retrieval is treated as read-only data access rather than an experiment operation.
