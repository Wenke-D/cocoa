// Run and campaign records (convention §7, §8, §12). Field names and enum
// spellings are the convention's, so any run.json written to it reads.

import type { Params } from '@shared/params'
import type { Status } from './status'
import { is_terminal } from './status'

/** One entry of a run's history: the status it moved to, and when. */
export interface StatusChange {
  status: Status
  at: string
}

/** Which surface a start came through: the workbench or the agent interface. */
export type Trigger = 'human' | 'agent'

/** Who started a run, tagged by `by`. */
export type RunOrigin =
  { by: 'human' } | { by: 'agent' } | { by: 'campaign'; run_id: number; name: string; call: number }

/** A job run's `runs/<id>/run.json` (§7.1). */
export interface RunRecord {
  run_id: number
  /** The launch script's id for the run, opaque to cocoa; poll, report and cancel get it back. */
  submission_id: string
  /** The params substituted into the template. */
  render: Params
  /** The params passed to the launch script as `--name value`. */
  launch: Params
  status: Status
  /** Every status the run has had, oldest first. */
  history: StatusChange[]
  /** The script's free-text reason, kept while the run is `FAILED` or `UNREACHABLE`. */
  reason?: string
  /** Why the run is `ERROR`. */
  error?: string
  /** A `FAILED` run's report, which runs beside its status (§7.3.1). */
  report?: RunReport
  /** What `check` answered at the start, and the deploy it led to (§7.5). */
  deploy?: RunDeploy
  origin: RunOrigin
  /** The report is locked: not regenerated, and the run not deleted (§7.3.3). */
  report_locked?: true
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

/** A run a campaign dispatched, by its id in its job's folder. */
export interface CampaignMember {
  /** The call's current run. */
  run_id: number
  job: string
  /** Earlier runs of this call, oldest first, each replaced by the next (§8.5). */
  attempts?: number[]
}

/** A plan instance whose launch failed, so no run exists for it (§8.2). */
export interface LaunchFailure {
  job: string
  params: Params
  error: string
}

/**
 * The campaign's own report, once attempted (§8.3). `at` is when — the moment the
 * campaign ended, for a person reading its history (§8.2). A regenerate marks
 * it `attempted: false` again and keeps `at`: the report changes, the end does
 * not.
 */
export interface CampaignReport {
  attempted: boolean
  at?: string
  error?: string
}

/**
 * A `FAILED` run's report (§7.3.1), in the campaign report's shape. The healthy
 * path keeps its report on the status axis (§11) and never writes this.
 * `{ attempted: false }` is written with `FAILED` itself — the report is owed
 * — and `at`, with `error` when the script failed, once it has run. A run
 * recorded `FAILED` without it predates the rule and owes nothing.
 */
export type RunReport = CampaignReport

/** Whether a `FAILED` run's report is owed or in flight (§7.3.1). */
export function report_owed(record: RunRecord): boolean {
  return record.report?.attempted === false
}

/** A campaign run's `runs/<id>/run.json` (§8.2). Its status is derived on every read, never stored. */
export interface CampaignRecord {
  run_id: number
  /** The campaign's name. */
  campaign: string
  by: Trigger
  started_at: string
  params: Params
  /** How many instances the plan produced. */
  planned: number
  /** What actually launched; the rest are in `launch_failures`. */
  members: CampaignMember[]
  launch_failures: LaunchFailure[]
  report?: CampaignReport
  /** The campaign's own report is locked, as a job run's can be (§7.3.3). */
  report_locked?: true
}

/** One succeeded member, as `members.json` lists it. */
export interface CampaignMembersFileMember {
  run_id: number
  job: string
  params: Params
  submission_id: string
  /** The absolute path of the member's report: its `report/<id>.txt`, or its
   * `report/<id>.html` when that is the only one it wrote. */
  report: string
  /** The absolute path of the member's report attachment directory, or `null` when its report attached nothing. */
  attachments: string | null
}

/** The `members.json` written for a campaign's report script, so it never goes looking (§8.3). */
export interface CampaignMembersFile {
  run_id: number
  campaign: string
  params: Params
  members: CampaignMembersFileMember[]
}

/**
 * A local-offset timestamp with millisecond precision, e.g.
 * `2026-08-19T17:20:01.123+02:00`.
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

/** Object keys in sorted order, so JSON output is stable. */
export function sorted(map: Params): Params {
  const result: Params = {}
  for (const key of Object.keys(map).sort()) {
    result[key] = map[key]
  }
  return result
}
