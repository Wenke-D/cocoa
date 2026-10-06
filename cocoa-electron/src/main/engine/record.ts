// Run and bench records (convention §7, §8, §12). Field names and enum
// spellings are the convention's, so a run.json written by an earlier cocoa
// still reads.

import type { Params } from '@shared/params'
import type { Status } from './status'
import { is_terminal } from './status'

export interface StatusChange {
  status: Status
  at: string
}

export type Trigger = 'human' | 'agent'

/** serde: `#[serde(tag = "by", rename_all = "snake_case")]` */
export type RunOrigin =
  { by: 'human' } | { by: 'agent' } | { by: 'bench'; run_id: number; name: string; call: number }

export interface RunRecord {
  run_id: number
  submission_id: string
  render: Params
  launch: Params
  status: Status
  history: StatusChange[]
  reason?: string
  error?: string
  /** A `FAILED` run's report, which runs beside its status (§7.3.1). */
  report?: RunReport
  /** What `check` answered at the start, and the deploy it led to (§7.5). */
  deploy?: RunDeploy
  origin: RunOrigin
}

/**
 * How a run's job was made ready before its launch (§7.5, §7.6). `check` is
 * the check script's word — a `CONFLICT` refuses the start and leaves no run
 * to record it on — and `reason` what it said beside the word. A `STALE` run
 * gets `at` once its deploy finished, with `error` when the script failed.
 * A run recorded before deploy existed has no field at all.
 */
export interface RunDeploy {
  check: 'CURRENT' | 'STALE'
  reason?: string
  at?: string
  error?: string
}

export interface BenchMember {
  run_id: number
  job: string
}

export interface LaunchFailure {
  job: string
  params: Params
  error: string
}

/**
 * The bench's own report, once attempted (§8.3). `at` is when — the moment the
 * bench ended, for a person reading its history (§8.2).
 */
export interface BenchReport {
  attempted: boolean
  at?: string
  error?: string
}

/**
 * A `FAILED` run's report (§7.3.1), in the bench report's shape. The healthy
 * path keeps its report on the status axis (§11) and never writes this.
 * `{ attempted: false }` is written with `FAILED` itself — the report is owed
 * — and `at`, with `error` when the script failed, once it has run. A run
 * recorded `FAILED` without it predates the rule and owes nothing.
 */
export type RunReport = BenchReport

/** Whether a `FAILED` run's report is owed or in flight (§7.3.1). */
export function report_owed(record: RunRecord): boolean {
  return record.report?.attempted === false
}

export interface BenchRecord {
  run_id: number
  bench: string
  by: Trigger
  started_at: string
  params: Params
  planned: number
  members: BenchMember[]
  launch_failures: LaunchFailure[]
  report?: BenchReport
}

export interface BenchMembersFileMember {
  run_id: number
  job: string
  params: Params
  submission_id: string
  report: string
}

export interface BenchMembersFile {
  run_id: number
  bench: string
  params: Params
  members: BenchMembersFileMember[]
}

/**
 * A local-offset timestamp with millisecond precision, e.g.
 * `2026-08-19T17:20:01.123+02:00` — the shape chrono's `DateTime<Local>`
 * writes (at nanosecond precision) and the mock scripts already parse.
 */
export function now_stamp(date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const offset_minutes = -date.getTimezoneOffset()
  const sign = offset_minutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offset_minutes)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  )
}

export function new_run_record(
  run_id: number,
  submission_id: string,
  render: Params,
  launch: Params,
  origin: RunOrigin,
  at: string,
  deploy?: RunDeploy
): RunRecord {
  // A run whose check said STALE waits on its job's deploy before it launches.
  const status: Status = deploy?.check === 'STALE' ? 'DEPLOYING' : 'STARTING'
  return {
    run_id: run_id,
    submission_id: submission_id,
    render,
    launch,
    status,
    history: [{ status, at }],
    ...(deploy !== undefined ? { deploy } : {}),
    origin
  }
}

export function started_at(record: RunRecord): string {
  return record.history[0]?.at ?? record.history[record.history.length - 1]?.at ?? ''
}

/** The first terminal change's time, if the run has ended (§9). */
export function ended_at(record: RunRecord): string | null {
  const change = record.history.find((entry) => is_terminal(entry.status))
  return change?.at ?? null
}

/**
 * Appends a history entry and switches status, carrying the reason only for
 * statuses that display one.
 */
export function apply_status(record: RunRecord, status: Status, at: string, reason?: string): void {
  record.history.push({ status, at })
  record.status = status
  if ((status === 'FAILED' || status === 'UNREACHABLE') && reason !== undefined && reason !== '') {
    record.reason = reason
  } else {
    delete record.reason
  }
}

/** Combined render + launch params; unambiguous because names never overlap. */
export function all_params(record: RunRecord): Params {
  return { ...record.render, ...record.launch }
}

/** BTreeMap parity: object keys in sorted order, so JSON output is stable. */
export function sorted(map: Params): Params {
  const result: Params = {}
  for (const key of Object.keys(map).sort()) {
    result[key] = map[key]
  }
  return result
}
