// The bench operations (convention §8, §9): plan, start, report, cancel, and
// the status a bench run derives from its members. A bench is built out of
// job runs — its start is job starts, its cancel is job cancels — so this
// module leans on `job.ts`.

import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from './index'
import { EngineError } from './errors'
import * as invoke from './invoke'
import type { Invocation } from './invoke'
import type { Bench } from './memory'
import { cancel_run, describe_names, report_on_disk, start_job, validate_params } from './job'
import { all_params, now_stamp, sorted } from './record'
import type {
  BenchMember,
  BenchMembersFile,
  BenchRecord,
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
  render: Record<string, string>
  launch: Record<string, string>
}

export interface BenchStart {
  run_id: number
  members: BenchMember[]
  launch_failures: LaunchFailure[]
}

export interface BenchStatusView {
  status: Status
  missing_members: string[]
  succeeded: number
  failed: number
  cancelled: number
  running: number
  errors: number
}

/** How one member took a bench's cancel (§9.1). */
export interface MemberCancel {
  run_id: number
  job: string
  ok: boolean
  error?: string
}

interface PlanLine {
  job: string
  params: Record<string, string>
}

/** Runs `plan` and validates every instance before anything is submitted (§8.1). */
export async function plan_bench(
  engine: Engine,
  bench: Bench,
  params: Record<string, string>
): Promise<PlanInstance[]> {
  const manifest = bench.usable_manifest()
  validate_params(manifest.plan_params, params, 'plan')

  const argv = [...manifest.plan.words]
  for (const name of Object.keys(params).sort()) {
    argv.push(`--${name}`, params[name])
  }
  let invocation: Invocation
  try {
    invocation = await invoke.run(bench.path, argv, engine.config.plan_timeout)
  } catch (cause) {
    throw EngineError.io(bench.path, cause)
  }
  if (!invoke.invocation_ok(invocation)) {
    throw EngineError.invocation(
      manifest.plan.display,
      invocation.exit,
      invocation.timed_out,
      invoke.invocation_output(invocation)
    )
  }

  const lines = invoke.coco_return_lines(invocation.stdout)
  if (lines.length === 0) {
    throw EngineError.validation('plan produced no instances; a bench start needs at least one')
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
    const expected = new Set([...job_manifest.render_params, ...job_manifest.launch_params])
    const provided = new Set(Object.keys(planned.params))
    const missing = [...expected].filter((name) => !provided.has(name)).sort()
    const extra = [...provided].filter((name) => !expected.has(name)).sort()
    if (missing.length > 0 || extra.length > 0) {
      const wrong: string[] = []
      if (missing.length > 0) {
        wrong.push(`missing ${describe_names(missing)}`)
      }
      if (extra.length > 0) {
        wrong.push(`extra ${describe_names(extra)}`)
      }
      problems.push(`call ${call}: job \`${planned.job}\` — ${wrong.join(', ')}`)
      continue
    }
    const render: Record<string, string> = {}
    const launch: Record<string, string> = {}
    for (const [name, value] of Object.entries(planned.params)) {
      if (job_manifest.render_params.includes(name)) {
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

/** Starts a bench: validates the plan, then dispatches every instance (§8.2). */
export async function start_bench(
  engine: Engine,
  bench: Bench,
  params: Record<string, string>,
  by: Trigger
): Promise<BenchStart> {
  const manifest = bench.usable_manifest()
  const instances = await plan_bench(engine, bench, params)
  const bench_run_id = bench.runs.next_id()

  const members: BenchMember[] = []
  const launch_failures: LaunchFailure[] = []
  for (const [index, instance] of instances.entries()) {
    try {
      const run_id = await start_job(
        engine,
        engine.job(instance.job_path),
        instance.render,
        instance.launch,
        {
          by: 'bench',
          run_id: bench_run_id,
          name: manifest.name,
          call: index + 1
        }
      )
      members.push({ run_id: run_id, job: instance.job_name })
    } catch (cause) {
      launch_failures.push({
        job: instance.job_name,
        params: { ...instance.render, ...instance.launch },
        error: (cause as Error).message
      })
    }
  }

  const record: BenchRecord = {
    run_id: bench_run_id,
    bench: manifest.name,
    by,
    started_at: now_stamp(),
    params: sorted(params),
    planned: members.length + launch_failures.length,
    members,
    launch_failures: launch_failures
  }
  bench.runs.write(record)

  return { run_id: bench_run_id, members, launch_failures }
}

/** Runs the bench's report over its members' results (§8.3). */
export async function bench_report(engine: Engine, bench: Bench, run_id: number): Promise<void> {
  const manifest = bench.usable_manifest()
  const record = bench.runs.record(run_id)

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
    throw EngineError.validation(`no bench report: ${block_reasons.join(', ')}`)
  }

  const run_dir = path.join(bench.path, 'runs', String(run_id))
  const members_file: BenchMembersFile = {
    run_id: run_id,
    bench: record.bench,
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

  const report_dir = path.join(bench.path, 'report')
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
    invocation = await invoke.run(bench.path, argv, engine.config.report_timeout)
  } catch (cause) {
    throw EngineError.io(bench.path, cause)
  }

  const report_path = path.join(report_dir, `${run_id}.txt`)
  const ok = invoke.invocation_ok(invocation) && fs.existsSync(report_path)
  const error = ok
    ? undefined
    : invoke.invocation_ok(invocation)
      ? `report script exited 0 but produced no report/${run_id}.txt`
      : invoke.invocation_output(invocation)
  record.report = { attempted: true, ...(error !== undefined ? { error } : {}) }
  bench.runs.write(record)

  if (!ok) {
    throw EngineError.invocation(
      manifest.report.display,
      invocation.exit,
      invocation.timed_out,
      error ?? ''
    )
  }
}

/** Cancels a bench run by cancelling its still-cancellable members (§3, §9.1). */
export async function cancel_bench(
  engine: Engine,
  bench: Bench,
  run_id: number
): Promise<MemberCancel[]> {
  const record = bench.runs.record(run_id)
  const results: MemberCancel[] = []
  for (const member of record.members) {
    const job = engine.find_job_by_name(member.job)
    if (job === null) {
      throw EngineError.not_found(`member job \`${member.job}\` of bench run ${run_id}`)
    }
    const member_record = job.runs.find(member.run_id)
    if (member_record === null) {
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

/** Derives a bench run's status (§9.1). Never stored, computed from memory. */
export function bench_status(engine: Engine, bench: Bench, run_id: number): BenchStatusView {
  const record = bench.runs.record(run_id)
  const resolved = engine.resolve_members(record)
  const missing = resolved.filter((member) => member.record === null).map((m) => m.job_name)
  const members = resolved
    .map((member) => member.record)
    .filter((record): record is RunRecord => record !== null)

  const status =
    missing.length > 0
      ? 'ERROR'
      : derive_bench_status(members, record, report_on_disk(bench.path, run_id))

  const counts: BenchStatusView = {
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

/** The bench status derivation (§9.1), over fully-resolved members. */
function derive_bench_status(
  members: RunRecord[],
  bench: BenchRecord,
  report_exists: boolean
): Status {
  if (members.some((member) => member.status === 'CANCELLING')) {
    return 'CANCELLING'
  }
  if (members.some((member) => !is_terminal(member.status))) {
    if (members.every((member) => member.status === 'STARTING')) {
      return 'STARTING'
    }
    return 'RUNNING'
  }
  if (bench.launch_failures.length > 0 || members.some((m) => m.status === 'ERROR')) {
    return 'ERROR'
  }
  if (members.some((m) => m.status === 'FAILED')) {
    return 'FAILED'
  }
  if (members.some((m) => m.status === 'CANCELLED')) {
    return 'CANCELLED'
  }
  if (bench.report !== undefined && bench.report.attempted) {
    if (bench.report.error !== undefined) {
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
  const params: Record<string, string> = {}
  for (const [name, param_value] of Object.entries(raw_params as Record<string, unknown>)) {
    if (typeof param_value !== 'string') {
      throw new Error(`param \`${name}\` must be a string`)
    }
    params[name] = param_value
  }
  return { job, params }
}
