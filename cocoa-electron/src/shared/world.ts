// TypeScript mirror of cocoa's `src/view_model` as serde serializes it.
// Serde's externally-tagged enum convention: a unit variant is a bare string,
// a struct variant is `{ VariantName: { ...fields } }`.

import type { ParamSpec, Params } from './params'

export type EntityKind = 'Job' | 'Bench'

export type ManifestState = 'Valid' | 'Missing' | { Invalid: { message: string } }

export type RunStatus =
  | 'Starting'
  | 'Pending'
  | 'Running'
  | 'Completed'
  | 'Analyzing'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelling'
  | 'Cancelled'
  | 'Error'

export type QueryHealth = 'Healthy' | 'Delayed' | { Unavailable: { message: string } }

export type Trigger = 'Human' | 'Agent'

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

export type ReportFormat = 'PlainText' | 'Html'

export type ReportState =
  | 'Unavailable'
  | 'Generating'
  | 'Missing'
  | { Available: { format: ReportFormat; text_bytes: number } }
  | { ReadError: { message: string } }

export interface Entity {
  id: string
  kind: EntityKind
  name: string
  /** The manifest's `description`, or `null` when it gives none. */
  description: string | null
  path: string
  manifest: ManifestState
  /** What a start must supply, in the order the form shows them (§17.3). */
  parameters: ParamSpec[]
}

export interface JobRun {
  id: string
  job_id: string
  origin: RunOrigin
  started_at: string
  ended_at: string | null
  parameters: string
  /** The same, as given: what a new run from this one would be started with. */
  params: Params
  status: RunStatus
  query_health: QueryHealth
  last_successful_query: string
  report: ReportState
  error: string | null
}

export interface BenchPlanStep {
  index: number
  job_id: string
  parameters: string
  run_id: string
}

export interface BenchRun {
  id: string
  bench_id: string
  by: Trigger
  started_at: string
  ended_at: string | null
  parameters: string
  params: Params
  plan: { steps: BenchPlanStep[] }
  status: RunStatus
  query_health: QueryHealth
  last_successful_query: string
  report: ReportState
  error: string | null
}

/**
 * Runs, by the experiment they belong to and then by their id.
 *
 * Nested because a run id is only unique *within* its experiment (§10.1): it
 * is allocated as one past the highest that experiment already has, so two
 * experiments both have a run `1`. A flat map keyed by id would collide, and
 * would be claiming a global uniqueness nothing guarantees.
 *
 * This is also the shape the engine already holds internally
 * (`jobRecords: Map<folder, Map<run_id, ...>>`); the flat view was the odd one
 * out.
 */
export type RunsByEntity<T> = Record<string, Record<string, T>>

export interface World {
  entities: Entity[]
  job_runs: RunsByEntity<JobRun>
  bench_runs: RunsByEntity<BenchRun>
  /** Each experiment's run ids, oldest first — the index carries the order. */
  runs_by_job: Record<string, string[]>
  runs_by_bench: Record<string, string[]>
  last_refresh: string | null
}

/** One job run, or `undefined`. The pair is the address; neither half alone. */
export function job_run(world: World, job_id: string, run_id: string): JobRun | undefined {
  return world.job_runs[job_id]?.[run_id]
}

export function bench_run(world: World, bench_id: string, run_id: string): BenchRun | undefined {
  return world.bench_runs[bench_id]?.[run_id]
}

export function empty_world(): World {
  return {
    entities: [],
    job_runs: {},
    bench_runs: {},
    runs_by_job: {},
    runs_by_bench: {},
    last_refresh: null
  }
}

// ---------------------------------------------------------------------------
// What the main process sends and answers over IPC.
//
// The protocol is event-driven: the backend is the only party that judges
// change. The renderer bootstraps once (the one irreducible full-state
// message — a fresh page owns nothing), then applies events. Events from one
// logical operation arrive as ONE batch, so the renderer never sees a torn
// world (a member succeeded while its bench still reads running).

export interface BootstrapPayload {
  world: World
}

/**
 * How loudly a notice speaks. `error` is the Rust `TransientMessage`'s
 * `is_error`: it is styled as a failure and, here, stays until it is
 * dismissed or replaced — a message nobody had time to read is the same as
 * no message at all.
 */
export type NoticeLevel = 'info' | 'error'

export type CocoaEvent =
  | { kind: 'entity-upserted'; entity: Entity }
  | { kind: 'entity-removed'; id: string }
  /** The run carries its own `job_id`, so an upsert needs nothing else. */
  | { kind: 'job-run-upserted'; run: JobRun }
  /** A removal has no run to carry the pair, so it names both halves. */
  | { kind: 'job-run-removed'; job_id: string; id: string }
  | { kind: 'bench-run-upserted'; run: BenchRun }
  | { kind: 'bench-run-removed'; bench_id: string; id: string }
  /** Heartbeat: the engine completed a refresh pass. Content-free. */
  | { kind: 'refreshed'; at: string }
  /**
   * Something the user should be told, in one sentence. The transient
   * message is the only place a failed refresh can report itself — a poll
   * script that will not run is not visible anywhere else, because there is
   * no run whose row could carry it.
   */
  | { kind: 'notice'; level: NoticeLevel; text: string }

export type StartResult = { ok: true; run_id: string } | { ok: false; message: string }

/**
 * What a cancel is aimed at. A modal is a temporary action, not a place, so
 * this is never part of a route (specification §9).
 */
export type CancelTarget =
  | { kind: 'job_run'; job_id: string; run_id: string }
  | { kind: 'bench_run'; bench_id: string; run_id: string }

export type CancelResult = { ok: true } | { ok: false; message: string }

/** The run to delete for good (§16.4): same two addresses a cancel uses. */
export type DeleteTarget =
  | { kind: 'job_run'; job_id: string; run_id: string }
  | { kind: 'bench_run'; bench_id: string; run_id: string }

export type DeleteResult = { ok: true } | { ok: false; message: string }

/** Which run's report to read. The entity id is the folder it lives in. */
export interface ReportTarget {
  entity_id: string
  run_id: string
}

export type AddFolderResult =
  /** `already` distinguishes "registered it" from "it was already there" —
   * a folder already in the Explorer is a no-op, never a duplicate (§11.5). */
  | { ok: true; entity_id: string; already: boolean }
  /** `cancelled` is not a failure: cancelling the picker does nothing at all. */
  | { ok: false; cancelled: boolean; message: string }

export type RemoveFolderResult = { ok: true } | { ok: false; message: string }

export type ReportResult =
  { ok: true; format: ReportFormat; text: string } | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Presentation helpers, mirroring the impls on the Rust types.

const TERMINAL: readonly RunStatus[] = ['Succeeded', 'Failed', 'Cancelled', 'Error']

export function is_terminal(status: RunStatus): boolean {
  return TERMINAL.includes(status)
}

export function is_active(status: RunStatus): boolean {
  return !is_terminal(status)
}

const CANCELLABLE: readonly RunStatus[] = ['Starting', 'Pending', 'Running']

/**
 * Whether a run is still the cluster's to stop. `Cancelling` is excluded: the
 * request is already in flight, and asking twice is not a second answer. An
 * unreachable run displays as `Running`, and is cancellable — not knowing its
 * status is no reason to be unable to stop it.
 */
export function is_cancellable(status: RunStatus): boolean {
  return CANCELLABLE.includes(status)
}

export function query_available(health: QueryHealth): boolean {
  return typeof health === 'string' || !('Unavailable' in health)
}

/** Mirrors `JobRun::display_status`: unavailable query shows Unknown. */
export function display_status(status: RunStatus, health: QueryHealth): string {
  return query_available(health) ? status : 'Unknown'
}

export function manifest_blocking_reason(state: ManifestState): string | null {
  if (state === 'Valid') {
    return null
  }
  if (state === 'Missing') {
    return 'No manifest was found in this folder.'
  }
  return `Manifest is invalid: ${state.Invalid.message}`
}

/** Mirrors `RunOrigin`'s history-row label: `you`, `agent`, or the Bench. */
export function origin_label(origin: RunOrigin): string {
  if (origin === 'Human') {
    return 'you'
  }
  if (origin === 'Agent') {
    return 'agent'
  }
  return `${origin.Bench.name} · call ${origin.Bench.call}`
}

export function trigger_label(by: Trigger): string {
  return by === 'Human' ? 'you' : 'agent'
}

export function report_summary(report: ReportState): string {
  if (report === 'Unavailable') {
    return 'Report is not yet available.'
  }
  if (report === 'Generating') {
    return 'Report is being generated.'
  }
  if (report === 'Missing') {
    return 'Report is missing.'
  }
  if ('Available' in report) {
    const label = report.Available.format === 'Html' ? 'HTML' : 'Plain text'
    return `${label} report is available.`
  }
  return `Unable to read report: ${report.ReadError.message}`
}

/**
 * How long a run has taken: `HH:MM:SS` while it runs — a clock, ticking off
 * `now_ms` — and `1h 12m 33s` once it has ended, a length with its empty
 * leading units dropped. A finished run's duration is a fact, not a clock,
 * and `00:00:00` reads as one still to start (§22.2).
 */
export function format_duration(
  started_at: string,
  ended_at: string | null,
  now_ms: number
): string {
  const start = Date.parse(started_at)
  const end = ended_at !== null ? Date.parse(ended_at) : now_ms
  const total = Math.max(0, Math.floor((end - start) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (ended_at === null) {
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  }
  const parts: string[] = []
  if (h > 0) {
    parts.push(`${h}h`)
  }
  if (h > 0 || m > 0) {
    parts.push(`${m}m`)
  }
  parts.push(`${s}s`)
  return parts.join(' ')
}

const DAY_SECONDS = 86400

/** The units of `format_relative`, longest first; a month is thirty days and a year 365. */
const RELATIVE_UNITS: readonly (readonly [number, string])[] = [
  [365 * DAY_SECONDS, 'year'],
  [30 * DAY_SECONDS, 'month'],
  [DAY_SECONDS, 'day'],
  [3600, 'hour'],
  [60, 'minute']
]

/** "38 seconds ago", "2 days ago": the largest unit that fits, whole, and never the next one down. */
export function format_relative(then: string, now_ms: number): string {
  const seconds = Math.max(0, Math.floor((now_ms - Date.parse(then)) / 1000))
  if (seconds === 0) {
    return 'just now'
  }
  for (const [length, unit] of RELATIVE_UNITS) {
    if (seconds >= length) {
      const count = Math.floor(seconds / length)
      return `${count} ${unit}${count === 1 ? '' : 's'} ago`
    }
  }
  return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`
}

/** `HH:MM:SS` in local time, as the cancel modal states a start (§16.1). */
export function format_clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function format_started_at(started_at: string): string {
  const date = new Date(started_at)
  if (Number.isNaN(date.getTime())) {
    return started_at
  }
  return date.toLocaleString()
}
