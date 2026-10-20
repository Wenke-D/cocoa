// Planning a campaign (convention §8.1): run `plan`, check every call.

import type { Engine } from '../engine'
import { EngineError } from '../errors'
import * as invoke from '../invoke'
import type { Invocation } from '../invoke'
import type { Params } from '@shared/params'
import { argv_of } from '@shared/params'
import { param_problems, validate_params } from '../params'
import type { Campaign } from './campaign'

export interface PlanInstance {
  job_path: string
  job_name: string
  render: Params
  launch: Params
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
