# 9. Status

cocoa keeps its own closed vocabulary. Scripts speak it; cocoa does not learn new
state names at runtime.

| Status | Set by | Terminal | Meaning |
|---|---|---|---|
| `DEPLOYING` | cocoa | no | Record written, the job's deploy in flight, not launched yet (§7.6) |
| `STARTING` | cocoa | no | Record written, launch invoked, nothing polled yet |
| `PENDING` | poll | no | Accepted by the scheduler, not yet running |
| `RUNNING` | poll | no | Executing |
| `COMPLETED` | poll | no | Work finished successfully; report not run yet |
| `ANALYZING` | cocoa | no | The report script is in flight |
| `SUCCEEDED` | cocoa | **yes** | Finished and reported |
| `FAILED` | poll | **yes** | The work finished unsuccessfully; its report runs beside it (§7.3.1) |
| `CANCELLING` | cocoa | no | Cancel invoked, not yet confirmed by a poll |
| `CANCELLED` | poll | **yes** | Confirmed cancelled |
| `UNREACHABLE` | poll / cocoa | no | cocoa cannot currently see this run (§10) |
| `ERROR` | cocoa | **yes**\* | Something cocoa did not expect; the reason is shown |

The healthy path is:

```
STARTING → PENDING → RUNNING → COMPLETED → ANALYZING → SUCCEEDED
```

preceded by `DEPLOYING` when the start's check said `STALE` (§7.5).

`FAILED` and `CANCELLED` end a run immediately: they skip `ANALYZING`. A
`CANCELLED` run has no report. A `FAILED` run gets one, run beside its status
rather than on it: the report has its own state in the record, and the run
stays `FAILED` whatever the script does (§7.3.1). `ERROR` never has a report,
whatever it came from (§11).

\* The one healable exception: a run left at `ERROR` by a failed report script
returns to the healthy path once the script is fixed — a successful manual
report re-run moves it to `SUCCEEDED` (§7.3, §11).

**Who owns what.** The cluster's words — `PENDING`, `RUNNING`, `COMPLETED`,
`FAILED`, `CANCELLED`, `UNREACHABLE` — come from poll. cocoa sets `DEPLOYING`,
`STARTING`, `ANALYZING`, `SUCCEEDED`, `CANCELLING` and `ERROR`, each describing an
operation cocoa itself has in flight or a conclusion only cocoa can draw.

cocoa stops polling a run that reaches a terminal status, and a later poll line
for it is ignored. `UNREACHABLE` is deliberately **not** terminal: polling
continues, and the next good poll replaces it with the real status.

A run's full status history is kept in its record with a timestamp per change,
so the last known status stays visible even while the current one is
`UNREACHABLE`. Duration runs from the record's start to the first terminal
change.

Every timestamp a record carries — `started_at`, each status change, the
bench's `report.at` — is RFC 3339 with the writer's UTC offset,
`2026-08-23T13:02:40.123+02:00`: a moment, never a wall-clock reading that
only means something in the room it was taken in. A reader converts to its
own local zone for display; the folder may be read from another one.

## 9.1 Bench status is derived, never stored

A bench run's status is computed from its members every time it is read. It is
not a field in the record and not cached in the UI. In order:

1. Any member unresolvable → `ERROR` (§9.2).
2. Any member `CANCELLING` → `CANCELLING`.
3. Any member non-terminal → `RUNNING`, or `STARTING` while every member is
   `STARTING` or `DEPLOYING`.
4. All members terminal → the bench settles. Recorded `launch_failures`
   (§8.2), or any member that ended `ERROR`, make the bench `ERROR`; otherwise
   any member that ended `FAILED` makes it `FAILED`; otherwise any member that
   ended `CANCELLED` makes it `CANCELLED`. No bench report runs in any of these
   cases (§8.3).
5. All members succeeded and nothing failed to launch → the bench's own report
   decides: in flight → `ANALYZING`, on disk → `SUCCEEDED`, script failed →
   `ERROR`.

A failing member never aborts its siblings — instances are independent — so the
bench stays active until every member is terminal.

Note the order: a recorded launch failure decides the bench's *final* outcome,
but it does not cut the run short. A bench that dispatched ten of twelve
instances still reads `RUNNING` while those ten work, and only settles at
`ERROR` once they are all terminal. Steps 2 and 3 come first for exactly that
reason.

## 9.2 Members that cannot be resolved

A bench run's members are ordinary job runs living in their own jobs' folders,
referenced by `{run_id, job name}`. If that job is unregistered later, or its
record is gone, the member cannot be resolved.

The bench run then reads `ERROR`, and **names the members it cannot find** —
their job names are in the record, so cocoa always knows which ones are missing.
Re-registering the job heals every one of its member rows and the bench returns
to its real status.
