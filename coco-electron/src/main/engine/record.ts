// Run and bench records (convention §7, §8, §12). Port of engine/record.rs.
// Field names and enum spellings match serde exactly, so run.json files are
// interchangeable between the Rust and TS engines.

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
  render: Record<string, string>
  launch: Record<string, string>
  status: Status
  history: StatusChange[]
  reason?: string
  error?: string
  origin: RunOrigin
}

export interface BenchMember {
  run_id: number
  job: string
}

export interface LaunchFailure {
  job: string
  params: Record<string, string>
  error: string
}

export interface BenchReport {
  attempted: boolean
  error?: string
}

export interface BenchRecord {
  run_id: number
  bench: string
  by: Trigger
  started_at: string
  params: Record<string, string>
  planned: number
  members: BenchMember[]
  launch_failures: LaunchFailure[]
  report?: BenchReport
}

export interface BenchMembersFileMember {
  run_id: number
  job: string
  params: Record<string, string>
  submission_id: string
  report: string
}

export interface BenchMembersFile {
  run_id: number
  bench: string
  params: Record<string, string>
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
  render: Record<string, string>,
  launch: Record<string, string>,
  origin: RunOrigin,
  at: string
): RunRecord {
  return {
    run_id: run_id,
    submission_id: submission_id,
    render,
    launch,
    status: 'STARTING',
    history: [{ status: 'STARTING', at }],
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
export function all_params(record: RunRecord): Record<string, string> {
  return { ...record.render, ...record.launch }
}
