// Starting a campaign (convention §8.2): its start is job starts, one per
// planned call.

import type { CheckAnswer, Release } from '../deploys'
import type { Engine } from '../engine'
import { EngineError } from '../errors'
import { dispatch, prepare_start } from '../job/start'
import type { PreparedStart } from '../job/start'
import { validate_params } from '../params'
import { now_stamp, sorted } from '../record'
import type { CampaignMember, CampaignRecord, LaunchFailure, Trigger } from '../record'
import type { Campaign } from './campaign'
import { plan_campaign } from './plan'

export interface CampaignStart {
  run_id: number
  members: CampaignMember[]
  launch_failures: LaunchFailure[]
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
