# 10. Domain Types

The domain types live in `src/shared/world.ts` because both sides need them: the
main process builds them, the renderer reads them, and one definition is what
keeps the two from drifting.

Ids are plain strings. TypeScript has no newtype, and a branded type would buy
compile-time separation at the cost of every boundary — JSON, the socket, the
records on disk — needing a cast. The field name carries the meaning instead:
`job_id`, `run_id`, `bench_run_id` are never spelled `id` where the kind is
ambiguous.

**A run id is unique within its experiment and nowhere wider.** It is allocated
as one past the highest that experiment already has (convention §5), so two
experiments both have a run `0`. The pair is the address; neither half means
anything alone, which is why every route, cancel target, report target and
agent path names the experiment as well — and why the world holds runs nested
by experiment rather than in one flat map:

```ts
export type RunsByEntity<T> = Record<string, Record<string, T>>

job_runs: RunsByEntity<JobRun>      // world.job_runs[job_id][run_id]
bench_runs: RunsByEntity<BenchRun>
```

The one link that cannot be spelled as a pair is a dispatched run seen from its
bench: the bench run knows the child's id but not whose job it is. Its **plan**
answers that — `plan.steps[].job_id` — and is the authoritative link between
the two (§2.3.1).

```ts
export type EntityKind = 'Job' | 'Bench'
```

The unions below are serialized the way serde writes an externally-tagged enum —
a unit variant is a bare string, a struct variant is `{ Variant: { ...fields } }`.
This is not a TypeScript idiom; it is deliberate. It is the wire format the
records on disk and the agent socket already use ([convention](../convention/README.md)), so a
record written by either implementation is read by the other without a
translation layer.

## 10.1 Entity Kind### 10.1 Entity Kind

An entity is a folder holding a `cocoa.toml`; the manifest's own `kind` decides
which of the two it is.

## 10.2 Execution Status

```ts
export type RunStatus =
  | 'Deploying'   // the job's deploy is running; not launched yet (convention §7.6)
  | 'Starting'    // launch script spawned, no submission id yet (§3)
  | 'Pending'     // queued by the cluster, not yet running
  | 'Running'
  | 'Completed'   // finished; the report has not been taken yet
  | 'Analyzing'   // the report script is running
  | 'Succeeded'
  | 'Failed'
  | 'Cancelling'
  | 'Cancelled'
  | 'Error'       // cocoa could not carry out its own side of the protocol
```

`Completed` and `Analyzing` are the report's half of the lifecycle: a run whose
work is done but whose report has not been produced is not yet `Succeeded`,
because the user opens the report to find out what happened (§7.1).

`Error` is cocoa's own failure, not the experiment's — a poll that cannot be
spawned, a launch whose output never arrived, a report script that exits
non-zero. It must be told apart from `Failed`, which is the experiment's verdict.

That verdict is never overwritten. A `Failed` run gets a report too, run after
the verdict and beside it rather than on it: it never passes through
`Analyzing`, and a report script that fails on it leaves it `Failed`, with the
failure in its report state (§10.5, convention §7.3.1).

`Unknown` is not a status. It should not permanently overwrite the last known
execution status.

Instead, query availability must be tracked separately.

## 10.3 Query Health

```ts
export type QueryHealth =
  | 'Healthy'
  | 'Delayed'
  | { Unavailable: { message: string } }
```

When query health is unavailable, the UI may present the display status as:

```text
Unknown
```

The detail page should still show:

```text
Last known status: Running
Last successful query: 38 seconds ago
```

This distinction is mandatory:

```text
Execution Failed ≠ Query Unavailable
```

## 10.4 Manifest State

```ts
export type ManifestState =
  | 'Valid'
  | 'Missing'
  | { Invalid: { message: string } }
```

An invalid or missing manifest disables Start.

## 10.5 Report State

```ts
export type ReportFormat = 'PlainText' | 'Html'

export interface ReportFile {
  format: ReportFormat
  text_bytes: number
}

export type ReportState =
  | 'Unavailable'
  | 'Generating'
  | 'Missing'
  | { Available: { files: ReportFile[] } }   // one or both, plain text first
  | { ReadError: { message: string } }
```

`Available` carries the report's **size, not its text**. A report can be
megabytes, the world is sent to the renderer on every change (§26), and a run
list has no use for the body. The text is fetched by its own request when the
viewer opens (§20), which is also the only place a read error can be raised
against the file as it is now rather than as it was at the last tick.

Format decides presentation, never availability. See §20.

Report state is independent from execution state.

A failed run may have a report. cocoa runs the report script when a run turns
`Failed`, and the run reads `Failed` from that moment on: while the script
runs, the report is `Generating`; once it lands, it is `Available` like any
other. A run that was `Failed` before cocoa did this has none until it is
reported by hand.

`Generating` is a report in flight, whichever path it is on: an `Analyzing`
run's, or a `Failed` run's.

A job run also carries `report_error: string | null`: why a `Failed` run's
report script failed — its captured output. On the healthy path a failed
report is the run's own `Error`, and `report_error` stays `null`. And
`report_rerunnable: boolean`: whether its report can be re-run by hand now
(convention §7.3.2) — the engine would take it, and it is not already
`Generating`.

A succeeded run may temporarily have no report.

## 10.6 Run Origin

Every Job run records how it was started, and every Bench run records who asked.

```ts
export type RunOrigin =
  | 'Human'
  | 'Agent'
  | {
      Bench: {
        name: string
        bench_id: string | null
        bench_run_id: string
        call: number
      }
    }

/** A Bench is never dispatched by another Bench (§2.2), so who asked for one
 *  gets a type that cannot say otherwise. */
export type Trigger = 'Human' | 'Agent'
```

Exactly one of the three is true of any run, so the history's Source column is
one column with three kinds of value rather than two columns (§13.3): the Bench
name as a link, or `you`, or `agent`.

Origin is recorded at dispatch, not worked out at read time. Reconstructing it —
finding the Bench by name and scanning its members for this run — has to invent
an answer when the Bench folder is gone, and a run that outlives its Bench then
shows a confident wrong call number instead of the name it was dispatched under.
`name` and `call` are therefore recorded; `bench_id` is resolved for navigation
only, and is `None` once the Bench has left the Explorer — the run keeps its
history, the link simply stops being a link.

`call` counts from 1, as the plan's own validation errors count (§15.4). The
same call must not have two numbers.

Who asked is a property of the surface the request arrived through, and only
that surface knows it: the workbench records `Human`, and an interface built for
an agent records `Agent`. It is a parameter of the start operation rather than
something the engine decides.


Origin is presentation and navigation metadata only. It must not change how the
run executes, and it must not exclude the run from the owning Job's history.

## 10.7 Bench Plan

```ts
export interface BenchPlanStep {
  index: number
  job_id: string
  parameters: string
  run_id: string
}

export interface BenchPlan {
  steps: BenchPlanStep[]
}
```

`job_id` must resolve to a Job that exists in the Explorer. The plan holds a
reference, never an embedded copy of the Job definition.

The same `job_id` may appear in several calls with different `parameters`.
Identity within a plan is `index`, never `job_id`.

`index` fixes display order only. It implies no execution order.
