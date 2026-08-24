// The read routes' answers. Every caller is on this machine, so detail
// responses carry file *locations* rather than file contents.

import path from 'node:path'
import type { BenchRun, Entity, JobRun, ReportState, World } from '@shared/world'
import { bench_run, job_run } from '@shared/world'
import type { Maybe } from '@shared/maybe'
import { empty, some } from '@shared/maybe'
import type { AgentResponse } from './answer'
import { failure, json } from './answer'

function run_ids_of(world: World, entity: Entity): string[] {
  const index = entity.kind === 'Job' ? world.runs_by_job : world.runs_by_bench
  return index[entity.id] ?? []
}

function is_active_status(status: string): boolean {
  return !['Succeeded', 'Failed', 'Cancelled', 'Error'].includes(status)
}

export function list_entities(world: World, kind: 'Job' | 'Bench'): AgentResponse {
  const items = world.entities
    .filter((entity) => entity.kind === kind)
    .map((entity) => {
      const ids = run_ids_of(world, entity)
      const active = ids.filter((id) => {
        const run = kind === 'Job' ? job_run(world, entity.id, id) : bench_run(world, entity.id, id)
        return run !== undefined && is_active_status(run.status)
      }).length
      return {
        name: entity.name,
        folder: entity.id,
        manifest: entity.manifest,
        parameters: entity.parameters,
        runs: ids.length,
        active
      }
    })
  return json(200, items)
}

/** Where the report file is, when there is one to read. */
function report_location(folder: string, run_id: string, report: ReportState): Maybe<string> {
  if (typeof report === 'object' && 'Available' in report) {
    const extension = report.Available.format === 'Html' ? 'html' : 'txt'
    return some(path.join(folder, 'report', `${run_id}.${extension}`))
  }
  return empty()
}

function find_entity(world: World, name: string, kind: 'Job' | 'Bench'): Entity | undefined {
  return world.entities.find((entity) => entity.name === name && entity.kind === kind)
}

/** A name that exists as the other kind deserves a pointer, not a flat no. */
function no_such_entity(world: World, name: string, asked: 'Job' | 'Bench'): AgentResponse {
  const [this_, other] = asked === 'Job' ? ['job', 'benches'] : ['bench', 'jobs']
  if (world.entities.some((entity) => entity.name === name)) {
    return failure(404, `${name} is not a ${this_}; ask /${other}/${name}`)
  }
  return failure(404, `No such ${this_}: ${name}`)
}

export function job_detail(world: World, name: string): AgentResponse {
  const entity = find_entity(world, name, 'Job')
  if (entity === undefined) {
    return no_such_entity(world, name, 'Job')
  }
  const folder = entity.id

  const runs = run_ids_of(world, entity)
    .map((id) => job_run(world, folder, id))
    .filter((run): run is JobRun => run !== undefined)
    .map((run) => {
      const run_dir = path.join(folder, 'runs', run.id)
      return {
        id: run.id,
        status: run.status,
        origin: run.origin,
        started_at: run.started_at,
        ended_at: run.ended_at,
        parameters: run.parameters,
        query_health: run.query_health,
        error: run.error,
        location: {
          run_dir: run_dir,
          record: path.join(run_dir, 'run.json'),
          report: report_location(folder, run.id, run.report).or_null()
        }
      }
    })

  return json(200, {
    name: entity.name,
    kind: 'job',
    folder,
    manifest: entity.manifest,
    parameters: entity.parameters,
    runs
  })
}

export function bench_detail(world: World, name: string): AgentResponse {
  const entity = find_entity(world, name, 'Bench')
  if (entity === undefined) {
    return no_such_entity(world, name, 'Bench')
  }
  const folder = entity.id

  const name_of = (entity_id: string): string =>
    world.entities.find((candidate) => candidate.id === entity_id)?.name ?? entity_id

  const runs = run_ids_of(world, entity)
    .map((id) => bench_run(world, folder, id))
    .filter((run): run is BenchRun => run !== undefined)
    .map((run) => {
      const run_dir = path.join(folder, 'runs', run.id)
      return {
        id: run.id,
        status: run.status,
        by: run.by,
        started_at: run.started_at,
        ended_at: run.ended_at,
        parameters: run.parameters,
        query_health: run.query_health,
        error: run.error,
        calls: run.plan.steps.map((step) => ({
          call: step.index,
          job: name_of(step.job_id),
          parameters: step.parameters,
          // Follow it under /jobs/{job}: the member is an ordinary job run,
          // and its id only means anything beside that job's name — ids are
          // per experiment (§10.1).
          run_id: step.run_id
        })),
        location: {
          run_dir: run_dir,
          record: path.join(run_dir, 'run.json'),
          members: path.join(run_dir, 'members.json'),
          report: report_location(folder, run.id, run.report).or_null()
        }
      }
    })

  return json(200, {
    name: entity.name,
    kind: 'bench',
    folder,
    manifest: entity.manifest,
    parameters: entity.parameters,
    runs
  })
}
