// Builds the renderer's World from engine state: the one JSON shape the
// renderer consumes, so the UI does not change when the engine underneath
// does.

import fs from 'node:fs'
import path from 'node:path'
import type {
  CampaignRun,
  Entity,
  JobRun,
  QueryHealth,
  ReportFile,
  ReportState,
  RunOrigin,
  RunStatus,
  World
} from '@shared/world'
import type { EngineError } from './errors'
import type { Engine } from './index'
import { report_in_flight, report_on_disk, reportable } from './job'
import { all_params, ended_at, started_at } from './record'
import type { CampaignRecord, RunRecord } from './record'
import { is_terminal } from './status'
import type { Status } from './status'
import type { ParamSpec } from '@shared/params'
import { format_params } from '@shared/params'

export function build_world(engine: Engine, last_refresh: string | null): World {
  const world: World = {
    entities: [],
    job_runs: {},
    campaign_runs: {},
    runs_by_job: {},
    runs_by_campaign: {},
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
      entity_for(job.path, manifest, 'Job', [...manifest.render_params, ...manifest.launch_params])
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

  for (const campaign of engine.campaigns()) {
    const manifest = campaign.manifest
    if (manifest === null) {
      world.entities.push(broken_entity(campaign, 'Campaign'))
      continue
    }
    world.entities.push(entity_for(campaign.path, manifest, 'Campaign', [...manifest.plan_params]))
    for (const run_view of [...campaign.runs.all()].reverse()) {
      if (run_view.record === null) {
        continue
      }
      const run = campaign_run_of(engine, campaign.path, run_view.record, now_iso)
      const runs = (world.campaign_runs[run.campaign_id] ??= {})
      runs[run.id] = run
      index_run(world.runs_by_campaign, run.campaign_id, run.id, run.started_at, runs)
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
  kind: 'Job' | 'Campaign'
): Entity {
  return {
    id: broken.path,
    kind,
    name: path.basename(broken.path),
    description: null,
    path: display_path(broken.path),
    manifest: { Invalid: { message: broken.manifest_error?.message ?? 'manifest error' } },
    parameters: []
  }
}

function entity_for(
  folder: string,
  manifest: { name: string; description?: string },
  kind: 'Job' | 'Campaign',
  parameters: ParamSpec[]
): Entity {
  return {
    id: folder,
    kind,
    name: manifest.name,
    description: manifest.description ?? null,
    path: display_path(folder),
    manifest: 'Valid',
    parameters
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
    report: report_in_flight(record) ? 'Generating' : report_state_of(job_path, record.run_id),
    report_error: record.report?.error ?? null,
    report_rerunnable: !report_in_flight(record) && reportable(record, 'manual'),
    deploy:
      record.deploy === undefined
        ? null
        : {
            check: record.deploy.check,
            reason: record.deploy.reason ?? null,
            at: record.deploy.at ?? null,
            error: record.deploy.error ?? null
          },
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
    Campaign: {
      name: origin.name,
      campaign_id: engine.find_campaign_by_name(origin.name)?.path ?? null,
      campaign_run_id: String(origin.run_id),
      call: origin.call
    }
  }
}

function campaign_run_of(
  engine: Engine,
  campaign_path: string,
  record: CampaignRecord,
  now_iso: string
): CampaignRun {
  let status: RunStatus = 'Error'
  let ended: string | null = null
  try {
    const derived = engine.campaign_status(campaign_path, record.run_id)
    status = map_status(derived.status)
    ended = campaign_ended_at(engine, record, derived.status)
  } catch {
    // Fall through to Error, as the Rust adapter does.
  }
  return {
    id: String(record.run_id),
    campaign_id: campaign_path,
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
    report: report_state_of(campaign_path, record.run_id),
    error: null
  }
}

/**
 * When a campaign run ended, if it has — end to end, as a person sees it (§8.2):
 * at its own report, when there was one (landed or failed); otherwise, having
 * settled without one (§9.1: a member failed or was cancelled), when its last
 * member ended; and a campaign that ended without members ending (every launch
 * failed, a member cocoa cannot resolve) is dated by its start, so that its
 * clock at least stops. Records written before `report.at` existed fall
 * through to the members.
 */
function campaign_ended_at(engine: Engine, record: CampaignRecord, status: Status): string | null {
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
    case 'DEPLOYING':
      return 'Deploying'
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

/** Every report file the run wrote, plain text first (§20). */
function report_state_of(folder: string, run_id: number): ReportState {
  const files: ReportFile[] = []
  for (const [format, extension] of [
    ['PlainText', 'txt'],
    ['Html', 'html']
  ] as const) {
    const file = path.join(folder, 'report', `${run_id}.${extension}`)
    if (!fs.existsSync(file)) {
      continue
    }
    try {
      files.push({ format, text_bytes: fs.statSync(file).size })
    } catch (cause) {
      return { ReadError: { message: (cause as Error).message } }
    }
  }
  return files.length > 0 ? { Available: { files } } : 'Missing'
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
