// Builds the renderer's World from engine state. Port of the world-building
// half of src/adapter/engine.rs — same JSON shape the renderer already
// consumes, so the UI code does not change when the engine underneath does.

import fs from 'node:fs'
import os from 'node:os'
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
import type { Coco } from './coco'
import { reportOnDisk } from './coco'
import { allParams, endedAt, startedAt } from './record'
import type { BenchRecord, RunRecord } from './record'
import type { Status } from './status'

export function buildWorld(coco: Coco, lastRefresh: string | null): World {
  const world: World = {
    entities: [],
    job_runs: {},
    bench_runs: {},
    runs_by_job: {},
    runs_by_bench: {},
    last_refresh: lastRefresh
  }
  const nowIso = new Date().toISOString()

  for (const view of coco.entities()) {
    const manifest = view.manifest
    if (manifest === null) {
      world.entities.push({
        id: view.path,
        kind: 'Job',
        name: path.basename(view.path),
        path: displayPath(view.path),
        manifest: { Invalid: { message: view.manifestError?.message ?? 'manifest error' } },
        parameter_names: [],
        last_used: {}
      })
      continue
    }

    if (manifest.kind === 'job') {
      world.entities.push(
        entityFor(coco, view.path, manifest.name, 'Job', [
          ...manifest.render_params,
          ...manifest.launch_params
        ])
      )
      // Oldest first, which is also the order the index wants: two runs
      // started in the same millisecond tie on start time, and then
      // insertion order — ascending run id — is what keeps them
      // chronological.
      for (const runView of [...coco.jobRuns(view.path)].reverse()) {
        if (runView.record === null) continue
        const run = jobRunOf(coco, view.path, runView.record, nowIso)
        world.job_runs[run.id] = run
        indexRun(world.runs_by_job, run.job_id, run.id, run.started_at, world.job_runs)
      }
    } else {
      world.entities.push(
        entityFor(coco, view.path, manifest.name, 'Bench', [...manifest.plan_params])
      )
      for (const runView of [...coco.benchRuns(view.path)].reverse()) {
        if (runView.record === null) continue
        const run = benchRunOf(coco, view.path, runView.record, nowIso)
        world.bench_runs[run.id] = run
        indexRun(world.runs_by_bench, run.bench_id, run.id, run.started_at, world.bench_runs)
      }
    }
  }

  return world
}

/** Keeps each entity's run index sorted by start time, oldest first (§35). */
function indexRun(
  index: Record<string, string[]>,
  entityId: string,
  runId: string,
  startedAtIso: string,
  runs: Record<string, { started_at: string }>
): void {
  const list = index[entityId] ?? (index[entityId] = [])
  const startMs = Date.parse(startedAtIso)
  let position = list.length
  for (let i = 0; i < list.length; i += 1) {
    const other = runs[list[i]]
    if (other !== undefined && Date.parse(other.started_at) > startMs) {
      position = i
      break
    }
  }
  list.splice(position, 0, runId)
}

function entityFor(
  coco: Coco,
  folder: string,
  name: string,
  kind: 'Job' | 'Bench',
  parameterNames: string[]
): Entity {
  return {
    id: folder,
    kind,
    name,
    path: displayPath(folder),
    manifest: 'Valid',
    parameter_names: parameterNames,
    last_used: coco.lastArgs()[name] ?? {}
  }
}

function jobRunOf(coco: Coco, jobPath: string, record: RunRecord, nowIso: string): JobRun {
  const [status, queryHealth] = displayStatusOf(record)
  return {
    id: String(record.run_id),
    job_id: jobPath,
    origin: originOf(coco, record),
    started_at: startedAt(record),
    ended_at: endedAt(record),
    parameters: formatParams(allParams(record)),
    status,
    query_health: queryHealth,
    last_successful_query: nowIso,
    report: reportStateOf(jobPath, record.run_id),
    error: record.error ?? null
  }
}

function originOf(coco: Coco, record: RunRecord): RunOrigin {
  const origin = record.origin ?? { by: 'human' }
  if (origin.by === 'human') return 'Human'
  if (origin.by === 'agent') return 'Agent'
  return {
    Bench: {
      name: origin.name,
      bench_id: coco.findBenchPathByName(origin.name),
      bench_run_id: String(origin.run_id),
      call: origin.call
    }
  }
}

function benchRunOf(coco: Coco, benchPath: string, record: BenchRecord, nowIso: string): BenchRun {
  let status: RunStatus = 'Error'
  try {
    status = mapStatus(coco.benchStatus(benchPath, record.run_id).status)
  } catch {
    // Fall through to Error, as the Rust adapter does.
  }
  return {
    id: String(record.run_id),
    bench_id: benchPath,
    by: record.by === 'agent' ? 'Agent' : 'Human',
    started_at: record.started_at,
    ended_at: null,
    parameters: formatParams(record.params),
    plan: {
      steps: record.members.map((member, index) => {
        const found = coco.findJobByName(member.job)
        let parameters = ''
        if (found !== null) {
          try {
            parameters = formatParams(allParams(coco.runRecord(found[0], member.run_id)))
          } catch {
            parameters = ''
          }
        }
        return {
          index,
          job_id: found?.[0] ?? member.job,
          parameters,
          run_id: String(member.run_id)
        }
      })
    },
    status,
    query_health: 'Healthy',
    last_successful_query: nowIso,
    report: reportStateOf(benchPath, record.run_id),
    error: null
  }
}

/** UNREACHABLE shows the last known status plus unavailable query health. */
function displayStatusOf(record: RunRecord): [RunStatus, QueryHealth] {
  if (record.status === 'UNREACHABLE') {
    const lastKnown = [...record.history]
      .reverse()
      .find((change) => change.status !== 'UNREACHABLE')
    return [
      lastKnown !== undefined ? mapStatus(lastKnown.status) : 'Starting',
      { Unavailable: { message: record.reason ?? 'unreachable' } }
    ]
  }
  return [mapStatus(record.status), 'Healthy']
}

function mapStatus(status: Status): RunStatus {
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

function reportStateOf(folder: string, runId: number): ReportState {
  const txt = path.join(folder, 'report', `${runId}.txt`)
  if (fs.existsSync(txt)) {
    return sizeOf(txt, 'PlainText')
  }
  const html = path.join(folder, 'report', `${runId}.html`)
  if (fs.existsSync(html)) {
    return sizeOf(html, 'Html')
  }
  return 'Missing'
}

function sizeOf(file: string, format: 'PlainText' | 'Html'): ReportState {
  try {
    return { Available: { format, text_bytes: fs.statSync(file).size } }
  } catch (cause) {
    return { ReadError: { message: (cause as Error).message } }
  }
}

function formatParams(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((name) => `--${name} ${params[name]}`)
    .join(' ')
}

/** `~`-folds paths under home, component-wise (specification §24.4). */
export function displayPath(folder: string): string {
  let home = process.env.HOME ?? ''
  if (home === '') return folder
  try {
    home = fs.realpathSync(home)
  } catch {
    // Compare against the un-canonicalized home.
  }
  if (folder === home) return '~'
  if (folder.startsWith(home + path.sep)) {
    return `~${path.sep}${folder.slice(home.length + 1)}`
  }
  return folder
}

export { reportOnDisk }

export function defaultStorePath(): string {
  const override = process.env.COCO_STORE_PATH
  if (override !== undefined && override !== '') return override
  return path.join(os.homedir(), '.local', 'share', 'coco', 'store.json')
}
