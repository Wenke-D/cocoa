// TypeScript mirror of coco's `src/view_model` as serde serializes it.
// Serde's externally-tagged enum convention: a unit variant is a bare string,
// a struct variant is `{ VariantName: { ...fields } }`.

import type { UiState } from './ui'

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
  path: string
  manifest: ManifestState
  parameter_names: string[]
  last_used: Record<string, string>
}

export interface JobRun {
  id: string
  job_id: string
  origin: RunOrigin
  started_at: string
  ended_at: string | null
  parameters: string
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
  plan: { steps: BenchPlanStep[] }
  status: RunStatus
  query_health: QueryHealth
  last_successful_query: string
  report: ReportState
  error: string | null
}

export interface World {
  entities: Entity[]
  job_runs: Record<string, JobRun>
  bench_runs: Record<string, BenchRun>
  runs_by_job: Record<string, string[]>
  runs_by_bench: Record<string, string[]>
  last_refresh: string | null
}

export function emptyWorld(): World {
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
  /** Where the user was when they last closed the window (`@shared/ui`). */
  ui: UiState
}

/**
 * How loudly a notice speaks. `error` is the Rust `TransientMessage`'s
 * `is_error`: it is styled as a failure and, here, stays until it is
 * dismissed or replaced — a message nobody had time to read is the same as
 * no message at all.
 */
export type NoticeLevel = 'info' | 'error'

export type CocoEvent =
  | { kind: 'entity-upserted'; entity: Entity }
  | { kind: 'entity-removed'; id: string }
  | { kind: 'job-run-upserted'; run: JobRun }
  | { kind: 'job-run-removed'; id: string }
  | { kind: 'bench-run-upserted'; run: BenchRun }
  | { kind: 'bench-run-removed'; id: string }
  /** Heartbeat: the engine completed a refresh pass. Content-free. */
  | { kind: 'refreshed'; at: string }
  /**
   * Something the user should be told, in one sentence. The transient
   * message is the only place a failed refresh can report itself — a poll
   * script that will not run is not visible anywhere else, because there is
   * no run whose row could carry it.
   */
  | { kind: 'notice'; level: NoticeLevel; text: string }

export type StartResult = { ok: true; runId: string } | { ok: false; message: string }

/**
 * What a cancel is aimed at. A modal is a temporary action, not a place, so
 * this is never part of a route (specification §9).
 */
export type CancelTarget =
  | { kind: 'jobRun'; jobId: string; runId: string }
  | { kind: 'benchRun'; benchId: string; runId: string }

export type CancelResult = { ok: true } | { ok: false; message: string }

/** Which run's report to read. The entity id is the folder it lives in. */
export interface ReportTarget {
  entityId: string
  runId: string
}

export type AddFolderResult =
  /** `already` distinguishes "registered it" from "it was already there" —
   * a folder already in the Explorer is a no-op, never a duplicate (§11.5). */
  | { ok: true; entityId: string; already: boolean }
  /** `cancelled` is not a failure: cancelling the picker does nothing at all. */
  | { ok: false; cancelled: boolean; message: string }

export type RemoveFolderResult = { ok: true } | { ok: false; message: string }

export type ReportResult =
  { ok: true; format: ReportFormat; text: string } | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Presentation helpers, mirroring the impls on the Rust types.

const TERMINAL: readonly RunStatus[] = ['Succeeded', 'Failed', 'Cancelled', 'Error']

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.includes(status)
}

export function isActive(status: RunStatus): boolean {
  return !isTerminal(status)
}

const CANCELLABLE: readonly RunStatus[] = ['Starting', 'Pending', 'Running']

/**
 * Whether a run is still the cluster's to stop. `Cancelling` is excluded: the
 * request is already in flight, and asking twice is not a second answer. An
 * unreachable run displays as `Running`, and is cancellable — not knowing its
 * status is no reason to be unable to stop it.
 */
export function isCancellable(status: RunStatus): boolean {
  return CANCELLABLE.includes(status)
}

export function queryAvailable(health: QueryHealth): boolean {
  return typeof health === 'string' || !('Unavailable' in health)
}

/** Mirrors `JobRun::display_status`: unavailable query shows Unknown. */
export function displayStatus(status: RunStatus, health: QueryHealth): string {
  return queryAvailable(health) ? status : 'Unknown'
}

export function manifestBlockingReason(state: ManifestState): string | null {
  if (state === 'Valid') return null
  if (state === 'Missing') return 'No manifest was found in this folder.'
  return `Manifest is invalid: ${state.Invalid.message}`
}

/** Mirrors `RunOrigin`'s history-row label: `you`, `agent`, or the Bench. */
export function originLabel(origin: RunOrigin): string {
  if (origin === 'Human') return 'you'
  if (origin === 'Agent') return 'agent'
  return `${origin.Bench.name} · call ${origin.Bench.call}`
}

export function triggerLabel(by: Trigger): string {
  return by === 'Human' ? 'you' : 'agent'
}

export function reportSummary(report: ReportState): string {
  if (report === 'Unavailable') return 'Report is not yet available.'
  if (report === 'Generating') return 'Report is being generated.'
  if (report === 'Missing') return 'Report is missing.'
  if ('Available' in report) {
    const label = report.Available.format === 'Html' ? 'HTML' : 'Plain text'
    return `${label} report is available.`
  }
  return `Unable to read report: ${report.ReadError.message}`
}

/** `HH:MM:SS`, mirrors `format_duration`. */
export function formatDuration(startedAt: string, endedAt: string | null, nowMs: number): string {
  const start = Date.parse(startedAt)
  const end = endedAt !== null ? Date.parse(endedAt) : nowMs
  const total = Math.max(0, Math.floor((end - start) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** "38 seconds ago", mirrors `format_relative`. */
export function formatRelative(then: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(then)) / 1000))
  if (seconds === 0) return 'just now'
  if (seconds === 1) return '1 second ago'
  if (seconds < 60) return `${seconds} seconds ago`
  if (seconds < 120) return '1 minute ago'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 7200) return '1 hour ago'
  return `${Math.floor(seconds / 3600)} hours ago`
}

/** `HH:MM:SS` in local time, as the cancel modal states a start (§16.1). */
export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatStartedAt(startedAt: string): string {
  const date = new Date(startedAt)
  if (Number.isNaN(date.getTime())) return startedAt
  return date.toLocaleString()
}
