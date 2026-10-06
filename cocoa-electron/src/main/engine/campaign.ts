// The campaign operations (convention §8, §9): plan, start, report, cancel, and
// the status a campaign run derives from its members. A campaign is built out of
// job runs — its start is job starts, its cancel is job cancels — so this
// module leans on `job.ts`.

import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from './index'
import { EngineError } from './errors'
import * as invoke from './invoke'
import type { Invocation } from './invoke'
import type { Campaign } from './memory'
import type { Params } from '@shared/params'
import { argv_of } from '@shared/params'
import type { CheckAnswer, Release } from './deploys'
import { WAITING_ON_DEPLOY, cancel_run, dispatch, prepare_start, report_on_disk } from './job'
import type { PreparedStart } from './job'
import { param_problems, validate_params } from './params'
import { all_params, now_stamp, sorted } from './record'
import type {
  CampaignMember,
  CampaignMembersFile,
  CampaignRecord,
  LaunchFailure,
  RunRecord,
  Trigger
} from './record'
import { is_cancellable, is_terminal } from './status'
import type { Status } from './status'
import { write_atomic } from './store'

export interface PlanInstance {
  job_path: string
  job_name: string
  render: Params
  launch: Params
}

export interface CampaignStart {
  run_id: number
  members: CampaignMember[]
  launch_failures: LaunchFailure[]
}

export interface CampaignStatusView {
  status: Status
  missing_members: string[]
  succeeded: number
  failed: number
  cancelled: number
  running: number
  errors: number
}

/** How one member took a campaign's cancel (§9.1). */
export interface MemberCancel {
  run_id: number
  job: string
  ok: boolean
  error?: string
}

interface PlanLine {
  job: string
  /** As the plan wrote them: JSON values, checked against the job's manifest below. */
  params: Record<string, unknown>
}

/** Runs `plan` and validates every instance before anything is submitted (§8.1). */
export async function plan_campaign(
  engine: Engine,
  campaign: Campaign,
  params_given: Record<string, unknown>
): Promise<PlanInstance[]> {
  const manifest = campaign.usable_manifest()
  const params = validate_params(manifest.plan_params, params_given, 'plan')

  const argv = [...manifest.plan.words]
  for (const name of Object.keys(params).sort()) {
    argv.push(...argv_of(name, params[name]))
  }
  let invocation: Invocation
  try {
    invocation = await invoke.run(campaign.path, argv, engine.config.plan_timeout)
  } catch (cause) {
    throw EngineError.io(campaign.path, cause)
  }
  if (!invoke.invocation_ok(invocation)) {
    throw EngineError.invocation(
      manifest.plan.display,
      invocation.exit,
      invocation.timed_out,
      invoke.invocation_output(invocation)
    )
  }

  const lines = invoke.cocoa_return_lines(invocation.stdout)
  if (lines.length === 0) {
    throw EngineError.validation('plan produced no instances; a campaign start needs at least one')
  }

  // Every call is checked, not just up to the first bad one (§8.1).
  const instances: PlanInstance[] = []
  const problems: string[] = []
  for (const [index, line] of lines.entries()) {
    const call = index + 1
    let planned: PlanLine
    try {
      planned = parse_plan_line(line)
    } catch (cause) {
      problems.push(`call ${call}: ${(cause as Error).message}`)
      continue
    }
    const job = engine.find_job_by_name(planned.job)
    if (job === null) {
      problems.push(`call ${call}: \`${planned.job}\` is not a registered job`)
      continue
    }
    const job_manifest = job.usable_manifest()
    const wrong = param_problems(
      [...job_manifest.render_params, ...job_manifest.launch_params],
      planned.params
    )
    if (wrong.length > 0) {
      problems.push(`call ${call}: job \`${planned.job}\` — ${wrong.join('; ')}`)
      continue
    }
    const render: Params = {}
    const launch: Params = {}
    const render_names = new Set(job_manifest.render_params.map((param) => param.name))
    for (const [name, value] of Object.entries(planned.params as Params)) {
      if (render_names.has(name)) {
        render[name] = value
      } else {
        launch[name] = value
      }
    }
    instances.push({ job_path: job.path, job_name: job_manifest.name, render, launch })
  }

  if (problems.length > 0) {
    throw EngineError.invalid_plan(lines.length, problems)
  }
  return instances
}

/**
 * Starts a campaign: validates the plan, checks every job it calls, then
 * dispatches every instance (§8.2). Each job is checked once, under its gate,
 * before anything is dispatched (§7.5): a `CONFLICT` anywhere refuses the
 * whole start, naming every job at fault, and a stale job's members all wait
 * on one deploy of it.
 */
export async function start_campaign(
  engine: Engine,
  campaign: Campaign,
  params_given: Record<string, unknown>,
  by: Trigger
): Promise<CampaignStart> {
  const manifest = campaign.usable_manifest()
  const params = validate_params(manifest.plan_params, params_given, 'plan')
  const instances = await plan_campaign(engine, campaign, params)

  // Gates are taken in one order — by folder — so two campaign starts calling
  // the same jobs can never each hold one the other waits on.
  const paths = [...new Set(instances.map((instance) => instance.job_path))].sort()
  const checked = new Map<string, { release: Release; answer: CheckAnswer | null }>()
  const problems: string[] = []
  try {
    for (const job_path of paths) {
      const job = engine.job(job_path)
      const job_manifest = job.usable_manifest()
      const release = await engine.deploys.acquire(job_path)
      const gate: { release: Release; answer: CheckAnswer | null } = { release, answer: null }
      checked.set(job_path, gate)
      try {
        gate.answer = await engine.deploys.check(job, job_manifest)
      } catch (cause) {
        problems.push(`job \`${job_manifest.name}\`: ${(cause as Error).message}`)
      }
    }
  } catch (cause) {
    for (const gate of checked.values()) {
      gate.release()
    }
    throw cause
  }
  if (problems.length > 0) {
    for (const gate of checked.values()) {
      gate.release()
    }
    throw EngineError.validation(
      `the campaign cannot start, nothing was dispatched: ${problems.join('; ')}`
    )
  }

  const campaign_run_id = campaign.runs.next_id()
  const outcomes: (number | Error)[] = new Array<number | Error>(instances.length)
  for (const job_path of paths) {
    const job = engine.job(job_path)
    const job_manifest = job.usable_manifest()
    const gate = checked.get(job_path) as { release: Release; answer: CheckAnswer }
    const calls: number[] = []
    const starts: PreparedStart[] = []
    for (const [index, instance] of instances.entries()) {
      if (instance.job_path !== job_path) {
        continue
      }
      try {
        starts.push(
          prepare_start(job, job_manifest, instance.render, instance.launch, {
            by: 'campaign',
            run_id: campaign_run_id,
            name: manifest.name,
            call: index + 1
          })
        )
        calls.push(index)
      } catch (cause) {
        outcomes[index] = cause as Error
      }
    }
    const dispatched = await dispatch(engine, job, job_manifest, starts, gate.answer, gate.release)
    for (const [position, index] of calls.entries()) {
      outcomes[index] = dispatched[position]
    }
  }

  const members: CampaignMember[] = []
  const launch_failures: LaunchFailure[] = []
  for (const [index, instance] of instances.entries()) {
    const outcome = outcomes[index]
    if (typeof outcome === 'number') {
      members.push({ run_id: outcome, job: instance.job_name })
    } else {
      launch_failures.push({
        job: instance.job_name,
        params: { ...instance.render, ...instance.launch },
        error: outcome.message
      })
    }
  }

  const record: CampaignRecord = {
    run_id: campaign_run_id,
    campaign: manifest.name,
    by,
    started_at: now_stamp(),
    params: sorted(params),
    planned: members.length + launch_failures.length,
    members,
    launch_failures: launch_failures
  }
  campaign.runs.write(record)

  return { run_id: campaign_run_id, members, launch_failures }
}

/** Runs the campaign's report over its members' results (§8.3). */
export async function campaign_report(
  engine: Engine,
  campaign: Campaign,
  run_id: number
): Promise<void> {
  const manifest = campaign.usable_manifest()
  const record = campaign.runs.record(run_id)

  const resolved = engine.resolve_members(record)
  const block_reasons: string[] = []
  if (record.launch_failures.length > 0) {
    block_reasons.push(`${record.launch_failures.length} launch(es) failed`)
  }
  for (const member of resolved) {
    if (member.record === null) {
      block_reasons.push(`member \`${member.job_name}\` run ${member.run_id} cannot be resolved`)
    } else if (member.record.status !== 'SUCCEEDED') {
      block_reasons.push(
        `member \`${member.job_name}\` run ${member.run_id} ended ${member.record.status}`
      )
    }
  }
  if (block_reasons.length > 0) {
    throw EngineError.validation(`no campaign report: ${block_reasons.join(', ')}`)
  }

  const run_dir = path.join(campaign.path, 'runs', String(run_id))
  const members_file: CampaignMembersFile = {
    run_id: run_id,
    campaign: record.campaign,
    params: record.params,
    members: resolved.map((member) => {
      const member_record = member.record as RunRecord
      const job_path = member.job_path as string
      return {
        run_id: member.run_id,
        job: member.job_name,
        params: all_params(member_record),
        submission_id: member_record.submission_id,
        report: path.join(job_path, 'report', `${member.run_id}.txt`)
      }
    })
  }
  write_atomic(path.join(run_dir, 'members.json'), JSON.stringify(members_file, null, 2))

  const report_dir = path.join(campaign.path, 'report')
  try {
    fs.mkdirSync(report_dir, { recursive: true })
  } catch (cause) {
    throw EngineError.io(report_dir, cause)
  }
  const argv = [
    ...manifest.report.words,
    '--run',
    String(run_id),
    '--members',
    `runs/${run_id}/members.json`
  ]
  let invocation: Invocation
  try {
    invocation = await invoke.run(campaign.path, argv, engine.config.report_timeout)
  } catch (cause) {
    throw EngineError.io(campaign.path, cause)
  }

  const report_path = path.join(report_dir, `${run_id}.txt`)
  const ok = invoke.invocation_ok(invocation) && fs.existsSync(report_path)
  const error = ok
    ? undefined
    : invoke.invocation_ok(invocation)
      ? `report script exited 0 but produced no report/${run_id}.txt`
      : invoke.invocation_output(invocation)
  record.report = { attempted: true, at: now_stamp(), ...(error !== undefined ? { error } : {}) }
  campaign.runs.write(record)

  if (!ok) {
    throw EngineError.invocation(
      manifest.report.display,
      invocation.exit,
      invocation.timed_out,
      error ?? ''
    )
  }
}

/** Cancels a campaign run by cancelling its still-cancellable members (§3, §9.1). */
export async function cancel_campaign(
  engine: Engine,
  campaign: Campaign,
  run_id: number
): Promise<MemberCancel[]> {
  const record = campaign.runs.record(run_id)
  const results: MemberCancel[] = []
  for (const member of record.members) {
    const job = engine.find_job_by_name(member.job)
    if (job === null) {
      throw EngineError.not_found(`member job \`${member.job}\` of campaign run ${run_id}`)
    }
    const member_record = job.runs.find(member.run_id)
    if (member_record === null) {
      continue
    }
    // Not skipped like a finished member: it will launch once the deploy is
    // done, so a cancel that passed over it in silence would read as done.
    if (member_record.status === 'DEPLOYING') {
      results.push({
        run_id: member.run_id,
        job: member.job,
        ok: false,
        error: WAITING_ON_DEPLOY
      })
      continue
    }
    if (!is_cancellable(member_record.status)) {
      continue
    }
    try {
      await cancel_run(engine, job, member.run_id)
      results.push({ run_id: member.run_id, job: member.job, ok: true })
    } catch (cause) {
      results.push({
        run_id: member.run_id,
        job: member.job,
        ok: false,
        error: (cause as Error).message
      })
    }
  }
  return results
}

/** Derives a campaign run's status (§9.1). Never stored, computed from memory. */
export function campaign_status(
  engine: Engine,
  campaign: Campaign,
  run_id: number
): CampaignStatusView {
  const record = campaign.runs.record(run_id)
  const resolved = engine.resolve_members(record)
  const missing = resolved.filter((member) => member.record === null).map((m) => m.job_name)
  const members = resolved
    .map((member) => member.record)
    .filter((record): record is RunRecord => record !== null)

  const status =
    missing.length > 0
      ? 'ERROR'
      : derive_campaign_status(members, record, report_on_disk(campaign.path, run_id))

  const counts: CampaignStatusView = {
    status,
    missing_members: missing,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    running: 0,
    errors: 0
  }
  for (const member of members) {
    switch (member.status) {
      case 'SUCCEEDED':
        counts.succeeded += 1
        break
      case 'FAILED':
        counts.failed += 1
        break
      case 'CANCELLED':
        counts.cancelled += 1
        break
      case 'ERROR':
        counts.errors += 1
        break
      default:
        counts.running += 1
    }
  }
  return counts
}

/** The campaign status derivation (§9.1), over fully-resolved members. */
function derive_campaign_status(
  members: RunRecord[],
  campaign: CampaignRecord,
  report_exists: boolean
): Status {
  if (members.some((member) => member.status === 'CANCELLING')) {
    return 'CANCELLING'
  }
  if (members.some((member) => !is_terminal(member.status))) {
    // A member waiting on its job's deploy has not launched either.
    if (members.every((member) => member.status === 'STARTING' || member.status === 'DEPLOYING')) {
      return 'STARTING'
    }
    return 'RUNNING'
  }
  if (campaign.launch_failures.length > 0 || members.some((m) => m.status === 'ERROR')) {
    return 'ERROR'
  }
  if (members.some((m) => m.status === 'FAILED')) {
    return 'FAILED'
  }
  if (members.some((m) => m.status === 'CANCELLED')) {
    return 'CANCELLED'
  }
  if (campaign.report !== undefined && campaign.report.attempted) {
    if (campaign.report.error !== undefined) {
      return 'ERROR'
    }
    if (!report_exists) {
      return 'ERROR'
    }
  }
  return report_exists ? 'SUCCEEDED' : 'ANALYZING'
}

function parse_plan_line(line: string): PlanLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new Error(`not a JSON object: ${(cause as Error).message}`, { cause })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('must be a JSON object')
  }
  const object = value as Record<string, unknown>
  const job = object.job
  if (typeof job !== 'string') {
    throw new Error('missing string field `job`')
  }
  const raw_params = object.params
  if (typeof raw_params !== 'object' || raw_params === null || Array.isArray(raw_params)) {
    throw new Error('missing object field `params`')
  }
  // The values are checked against the job's manifest by the caller, which
  // knows their shapes; here only what no shape allows is refused.
  const params: Record<string, unknown> = {}
  for (const [name, param_value] of Object.entries(raw_params as Record<string, unknown>)) {
    if (typeof param_value !== 'string' && !Array.isArray(param_value)) {
      throw new Error(`param \`${name}\` must be a string or a list of strings`)
    }
    params[name] = param_value
  }
  return { job, params }
}
