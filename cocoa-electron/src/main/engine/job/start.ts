// Starting a job (convention §7.1, §7.5): validate, render, check, launch.

import fs from 'node:fs'
import path from 'node:path'
import type { Waiting } from '../deploys'
import type { Release } from '../job_gates'
import { check } from './check'
import type { CheckAnswer } from './check'
import type { Engine } from '../engine'
import { EngineError } from '../errors'
import * as invoke from '../invoke'
import type { Running } from '../invoke'
import type { JobManifest } from '../manifest'
import type { Params } from '@shared/params'
import { argv_of } from '@shared/params'
import { validate_params } from '../params'
import { new_run_record, now_stamp, sorted } from '../record'
import type { RunDeploy, RunOrigin } from '../record'
import * as template from '../template'
import type { Job } from './job'

/** A start checked and rendered, not yet written anywhere (§2.1, §6.1). */
export interface PreparedStart {
  render: Params
  launch: Params
  rendered: string
  origin: RunOrigin
}

/**
 * Validates a start's values and renders its template — everything about a
 * start that can be refused without running a script or writing a file.
 */
export function prepare_start(
  job: Job,
  manifest: JobManifest,
  render_given: Record<string, unknown>,
  launch_given: Record<string, unknown>,
  origin: RunOrigin
): PreparedStart {
  const render: Params = validate_params(manifest.render_params, render_given, 'render')
  const launch: Params = validate_params(manifest.launch_params, launch_given, 'launch')

  // The template is read from disk at the moment of use — it is authored
  // content, not engine state, and must be as fresh as the start.
  const template_path = path.join(job.path, manifest.template)
  let source: string
  try {
    source = fs.readFileSync(template_path, 'utf8')
  } catch (cause) {
    throw EngineError.io(template_path, cause)
  }
  try {
    template.analyze(
      source,
      manifest.render_params.map((param) => param.name)
    )
  } catch (cause) {
    throw EngineError.template(template_path, (cause as Error).message)
  }
  let rendered: string
  try {
    rendered = template.render(source, render)
  } catch (cause) {
    throw EngineError.template(template_path, (cause as Error).message)
  }
  return { render, launch, rendered, origin }
}

/**
 * Starts a job (§7.1, §7.5): checks it under its gate, then launches — at
 * once when it is current, after its deploy when it is stale. A start means
 * "launched", not waited-for: the run is recorded before its script
 * answers. `origin` says who asked: a person, an agent, or a campaign's call.
 */
export async function start_job(
  engine: Engine,
  job: Job,
  render_given: Record<string, unknown>,
  launch_given: Record<string, unknown>,
  origin: RunOrigin
): Promise<number> {
  const manifest = job.usable_manifest()
  const prepared = prepare_start(job, manifest, render_given, launch_given, origin)
  const release = await engine.gates.acquire(job.path)
  let answer: CheckAnswer
  try {
    answer = await check(engine, job, manifest)
  } catch (cause) {
    release()
    throw cause
  }
  const [outcome] = await dispatch(engine, job, manifest, [prepared], answer, release)
  if (outcome instanceof Error) {
    throw outcome
  }
  return outcome
}

/**
 * Launches prepared starts of one job whose `check` has answered, under the
 * gate `release` lets go (§7.5). `CURRENT` launches each now and opens the
 * gate; `STALE` records each `DEPLOYING` and hands the gate to the one deploy
 * they all wait on (§7.6). Answers, per start and in order, its run id or
 * why it did not start; a start that did not start leaves no run behind.
 */
export async function dispatch(
  engine: Engine,
  job: Job,
  manifest: JobManifest,
  starts: PreparedStart[],
  answer: CheckAnswer,
  release: Release
): Promise<(number | Error)[]> {
  const deploy: RunDeploy =
    answer.reason !== undefined
      ? { check: answer.word, reason: answer.reason }
      : { check: answer.word }

  if (answer.word === 'CURRENT') {
    try {
      const outcomes: (number | Error)[] = []
      for (const start of starts) {
        try {
          const reserved = reserve(job, manifest, start, { ...deploy })
          await launch(engine, job, manifest, reserved)
          outcomes.push(reserved.run_id)
        } catch (cause) {
          outcomes.push(cause as Error)
        }
      }
      return outcomes
    } finally {
      release()
    }
  }

  const outcomes: (number | Error)[] = []
  const waiting: Waiting[] = []
  for (const start of starts) {
    try {
      const reserved = reserve(job, manifest, start, { ...deploy })
      waiting.push({
        run_id: reserved.run_id,
        argv: reserved.argv,
        script: manifest.launch.display
      })
      outcomes.push(reserved.run_id)
    } catch (cause) {
      outcomes.push(cause as Error)
    }
  }
  if (waiting.length === 0) {
    release()
    return outcomes
  }
  try {
    await engine.deploys.begin(job, manifest, waiting, release)
  } catch (cause) {
    // A deploy that cannot be spawned at all refuses every start that waited
    // on it, as a launch that cannot be spawned refuses its own.
    for (const run of waiting) {
      job.runs.drop(run.run_id)
    }
    return outcomes.map((outcome) => (typeof outcome === 'number' ? (cause as Error) : outcome))
  }
  return outcomes
}

interface Reserved {
  run_id: number
  argv: string[]
}

/**
 * Takes a run id and writes what a start leaves on disk before its script
 * runs: the run directory, the rendered artifact, and the record.
 */
function reserve(
  job: Job,
  manifest: JobManifest,
  start: PreparedStart,
  deploy: RunDeploy
): Reserved {
  const run_id = job.runs.next_id()
  const run_dir = path.join(job.path, 'runs', String(run_id))
  try {
    fs.mkdirSync(run_dir, { recursive: true })
  } catch (cause) {
    throw EngineError.io(run_dir, cause)
  }

  const artifact = artifact_name(manifest.template)
  try {
    fs.writeFileSync(path.join(run_dir, artifact), start.rendered)
  } catch (cause) {
    throw EngineError.io(path.join(run_dir, artifact), cause)
  }

  const argv = [...manifest.launch.words]
  argv.push('--script', `runs/${run_id}/${artifact}`)
  argv.push('--run', String(run_id))
  for (const name of Object.keys(start.launch).sort()) {
    argv.push(...argv_of(name, start.launch[name]))
  }

  // The record is written in the same synchronous stretch the id was picked
  // in: a concurrent start must find it taken rather than pick it too.
  const record = new_run_record(
    run_id,
    '',
    sorted(start.render),
    sorted(start.launch),
    start.origin,
    now_stamp(),
    deploy
  )
  job.runs.write(record)
  return { run_id, argv }
}

/**
 * Spawns a reserved run's `launch`. Only a script that cannot be started at
 * all refuses the start itself: that is a folder problem the submitter can
 * act on now, and it leaves no run behind — the reservation is dropped.
 */
async function launch(
  engine: Engine,
  job: Job,
  manifest: JobManifest,
  reserved: Reserved
): Promise<void> {
  let running: Running
  try {
    running = await invoke.spawn(job.path, reserved.argv, engine.config.launch_timeout)
  } catch (cause) {
    job.runs.drop(reserved.run_id)
    throw EngineError.io(job.path, cause)
  }
  engine.in_flight.track(job.path, reserved.run_id, manifest.launch.display, running)
}

/** Strips a trailing `.tmpl` from the template's file name (§6.1). */
function artifact_name(template_rel: string): string {
  const name = path.basename(template_rel)
  if (name.endsWith('.tmpl') && name !== '.tmpl') {
    return name.slice(0, -'.tmpl'.length)
  }
  return name
}
