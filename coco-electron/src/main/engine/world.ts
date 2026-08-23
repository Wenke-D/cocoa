// Builds the renderer's World from engine state: the one JSON shape the
// renderer consumes, so the UI does not change when the engine underneath
// does.

import fs from 'node:fs'
import path from 'node:path'
import type {
  BenchRun,
  Entity,
  JobRun,
  QueryHealth,
  ReportState,
  RunOrigin,
  RunStatus,
  World
} from '@shared/world'
import type { EngineError } from './errors'
import type { Engine } from './index'
import { report_on_disk } from './job'
import { all_params, ended_at, started_at } from './record'
import type { BenchRecord, RunRecord } from './record'
import { is_terminal } from './status'
import type { Status } from './status'

export function build_world(engine: Engine, last_refresh: string | null): World {
  const world: World = {
    entities: [],
    job_runs: {},
    bench_runs: {},
    runs_by_job: {},
    runs_by_bench: {},
    last_refresh: last_refresh
  }
  const now_iso = new Date().toISOString()

  // A folder whose manifest is unusable is still listed, as what the store
  // says it is, carrying the error; its runs wait for a manifest.
  for (const job of engine.jobs()) {
    const manifest = job.manifest
    if (manifest === null) {
      world.entities.push(broken_entity(job, 'Job'))
      continue
    }
    world.entities.push(
      entity_for(job.path, manifest.name, 'Job', [
        ...manifest.render_params,
        ...manifest.launch_params
      ])
    )
    // Oldest first, which is also the order the index wants: two runs
    // started in the same millisecond tie on start time, and then
    // insertion order — ascending run id — is what keeps them
    // chronological.
    for (const run_view of [...job.runs.all()].reverse()) {
      if (run_view.record === null) {
        continue
      }
      const run = job_run_of(engine, job.path, run_view.record, now_iso)
      const runs = (world.job_runs[run.job_id] ??= {})
      runs[run.id] = run
      index_run(world.runs_by_job, run.job_id, run.id, run.started_at, runs)
    }
  }

  for (const bench of engine.benches()) {
    const manifest = bench.manifest
    if (manifest === null) {
      world.entities.push(broken_entity(bench, 'Bench'))
      continue
    }
    world.entities.push(entity_for(bench.path, manifest.name, 'Bench', [...manifest.plan_params]))
    for (const run_view of [...bench.runs.all()].reverse()) {
      if (run_view.record === null) {
        continue
      }
      const run = bench_run_of(engine, bench.path, run_view.record, now_iso)
      const runs = (world.bench_runs[run.bench_id] ??= {})
      runs[run.id] = run
      index_run(world.runs_by_bench, run.bench_id, run.id, run.started_at, runs)
    }
  }

  return world
}

/**
 * Keeps each entity's run index sorted by start time, oldest first (§35).
 *
 * `runs` is that one entity's runs, which is all this needs to compare
 * against — ids are unique within an experiment and nowhere wider.
 */
function index_run(
  index: Record<string, string[]>,
  entity_id: string,
  run_id: string,
  started_at_iso: string,
  runs: Record<string, { started_at: string }>
): void {
  const list = index[entity_id] ?? (index[entity_id] = [])
  const start_ms = Date.parse(started_at_iso)
  let position = list.length
  for (let i = 0; i < list.length; i += 1) {
    const other = runs[list[i]]
    if (other !== undefined && Date.parse(other.started_at) > start_ms) {
      position = i
      break
    }
  }
  list.splice(position, 0, run_id)
}

function broken_entity(
  broken: { path: string; manifest_error: EngineError | null },
  kind: 'Job' | 'Bench'
): Entity {
  return {
    id: broken.path,
    kind,
    name: path.basename(broken.path),
    path: display_path(broken.path),
    manifest: { Invalid: { message: broken.manifest_error?.message ?? 'manifest error' } },
    parameter_names: []
  }
}

function entity_for(
  folder: string,
  name: string,
  kind: 'Job' | 'Bench',
  parameter_names: string[]
): Entity {
  return {
    id: folder,
    kind,
    name,
    path: display_path(folder),
    manifest: 'Valid',
    parameter_names: parameter_names
  }
}

function job_run_of(engine: Engine, job_path: string, record: RunRecord, now_iso: string): JobRun {
  const [status, query_health] = display_status_of(record)
  return {
    id: String(record.run_id),
    job_id: job_path,
    origin: origin_of(engine, record),
    started_at: started_at(record),
    ended_at: ended_at(record),
    parameters: format_params(all_params(record)),
    params: all_params(record),
    status,
    query_health: query_health,
    last_successful_query: now_iso,
    report: report_state_of(job_path, record.run_id),
    error: record.error ?? null
  }
}

function origin_of(engine: Engine, record: RunRecord): RunOrigin {
  const origin = record.origin ?? { by: 'human' }
  if (origin.by === 'human') {
    return 'Human'
  }
  if (origin.by === 'agent') {
    return 'Agent'
  }
  return {
    Bench: {
      name: origin.name,
      bench_id: engine.find_bench_by_name(origin.name)?.path ?? null,
      bench_run_id: String(origin.run_id),
      call: origin.call
    }
  }
}

function bench_run_of(
  engine: Engine,
  bench_path: string,
  record: BenchRecord,
  now_iso: string
): BenchRun {
  let status: RunStatus = 'Error'
  let ended: string | null = null
  try {
    const derived = engine.bench_status(bench_path, record.run_id)
    status = map_status(derived.status)
    ended = bench_ended_at(engine, record, derived.status)
  } catch {
    // Fall through to Error, as the Rust adapter does.
  }
  return {
    id: String(record.run_id),
    bench_id: bench_path,
    by: record.by === 'agent' ? 'Agent' : 'Human',
    started_at: record.started_at,
    ended_at: ended,
    parameters: format_params(record.params),
    params: record.params,
    plan: {
      steps: record.members.map((member, index) => {
        const job = engine.find_job_by_name(member.job)
        const member_record = job?.runs.find(member.run_id) ?? null
        return {
          index,
          job_id: job?.path ?? member.job,
          parameters: member_record === null ? '' : format_params(all_params(member_record)),
          run_id: String(member.run_id)
        }
      })
    },
    status,
    query_health: 'Healthy',
    last_successful_query: now_iso,
    report: report_state_of(bench_path, record.run_id),
    error: null
  }
}

/**
 * When a bench run ended, if it has — end to end, as a person sees it (§8.2):
 * at its own report, when there was one (landed or failed); otherwise, having
 * settled without one (§9.1: a member failed or was cancelled), when its last
 * member ended; and a bench that ended without members ending (every launch
 * failed, a member coco cannot resolve) is dated by its start, so that its
 * clock at least stops. Records written before `report.at` existed fall
 * through to the members.
 */
function bench_ended_at(engine: Engine, record: BenchRecord, status: Status): string | null {
  if (record.report?.attempted === true && record.report.at !== undefined) {
    return record.report.at
  }
  if (!is_terminal(status)) {
    return null
  }
  const members = engine.resolve_members(record)
  const ends = members
    .map((member) => (member.record === null ? null : ended_at(member.record)))
    .filter((at): at is string => at !== null)
  if (members.length > 0 && ends.length === members.length) {
    return ends.reduce((latest, at) => (Date.parse(at) > Date.parse(latest) ? at : latest))
  }
  return record.started_at
}

/** UNREACHABLE shows the last known status plus unavailable query health. */
function display_status_of(record: RunRecord): [RunStatus, QueryHealth] {
  if (record.status === 'UNREACHABLE') {
    const last_known = [...record.history]
      .reverse()
      .find((change) => change.status !== 'UNREACHABLE')
    return [
      last_known !== undefined ? map_status(last_known.status) : 'Starting',
      { Unavailable: { message: record.reason ?? 'unreachable' } }
    ]
  }
  return [map_status(record.status), 'Healthy']
}

function map_status(status: Status): RunStatus {
  switch (status) {
    case 'STARTING':
      return 'Starting'
    case 'PENDING':
      return 'Pending'
    case 'RUNNING':
      return 'Running'
    case 'COMPLETED':
      return 'Completed'
    case 'ANALYZING':
      return 'Analyzing'
    case 'SUCCEEDED':
      return 'Succeeded'
    case 'FAILED':
      return 'Failed'
    case 'CANCELLING':
      return 'Cancelling'
    case 'CANCELLED':
      return 'Cancelled'
    case 'UNREACHABLE':
      return 'Running'
    case 'ERROR':
      return 'Error'
  }
}

function report_state_of(folder: string, run_id: number): ReportState {
  const txt = path.join(folder, 'report', `${run_id}.txt`)
  if (fs.existsSync(txt)) {
    return size_of(txt, 'PlainText')
  }
  const html = path.join(folder, 'report', `${run_id}.html`)
  if (fs.existsSync(html)) {
    return size_of(html, 'Html')
  }
  return 'Missing'
}

function size_of(file: string, format: 'PlainText' | 'Html'): ReportState {
  try {
    return { Available: { format, text_bytes: fs.statSync(file).size } }
  } catch (cause) {
    return { ReadError: { message: (cause as Error).message } }
  }
}

function format_params(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((name) => `--${name} ${params[name]}`)
    .join(' ')
}

/** `~`-folds paths under home, component-wise (specification §24.4). */
export function display_path(folder: string): string {
  let home = process.env.HOME ?? ''
  if (home === '') {
    return folder
  }
  try {
    home = fs.realpathSync(home)
  } catch {
    // Compare against the un-canonicalized home.
  }
  if (folder === home) {
    return '~'
  }
  if (folder.startsWith(home + path.sep)) {
    return `~${path.sep}${folder.slice(home.length + 1)}`
  }
  return folder
}

export { report_on_disk }
