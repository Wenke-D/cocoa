// Running a campaign's call again in its place (convention §8.5): a new run of
// the member's job takes over the call, and the run it replaces is kept as
// the member's earlier attempt.

import type { Engine } from '../engine'
import { EngineError } from '../errors'
import { start_job } from '../job/start'
import type { CampaignMember, CampaignRecord, RunOrigin } from '../record'
import { locked_refusal } from '../report_lock'
import { is_terminal } from '../status'
import type { Campaign } from './campaign'

/** A member while its new run starts: the campaign run, then the member's job and run id. */
function key_of(folder: string, run_id: number, job_path: string, member_run_id: number): string {
  return `${folder}\n${run_id}\n${job_path}\n${member_run_id}`
}

/** Whether any call of the campaign run is being run again just now. */
export function replacing_in(engine: Engine, folder: string, run_id: number): boolean {
  const prefix = `${folder}\n${run_id}\n`
  return [...engine.replacing].some((key) => key.startsWith(prefix))
}

/**
 * The call number of the member to run again, or the refusal (§8.5): it must
 * be a current member, of the job asked for, finished without succeeding, and
 * not already being run again; and the campaign's report must not be locked,
 * since the new run would have it regenerated.
 */
function call_to_replace(
  engine: Engine,
  campaign: Campaign,
  record: CampaignRecord,
  member_run_id: number,
  job_path: string
): number {
  // Run ids are per job (§5): a member is its job and its run id together.
  const job = engine.job(job_path)
  const of_job = (member: CampaignMember): boolean =>
    engine.find_job_by_name(member.job)?.path === job_path
  const index = record.members.findIndex(
    (member) => member.run_id === member_run_id && of_job(member)
  )
  const name = `run ${member_run_id} of \`${job.manifest?.name ?? job_path}\``
  if (index === -1) {
    const earlier = record.members.some(
      (member) => member.attempts?.includes(member_run_id) === true && of_job(member)
    )
    throw EngineError.validation(
      earlier
        ? `${name} is an earlier attempt in campaign run ${record.run_id}; ` +
            `only the call's current run is run again`
        : `${name} is not a member of campaign run ${record.run_id}`
    )
  }
  const old = job.runs.find(member_run_id)
  if (old === null) {
    throw EngineError.validation(`${name} cannot be resolved`)
  }
  if (!is_terminal(old.status)) {
    throw EngineError.validation(`${name} (${old.status}) is not finished`)
  }
  if (old.status === 'SUCCEEDED') {
    throw EngineError.validation(`${name} succeeded; only a call that did not succeed is run again`)
  }
  if (record.report_locked === true) {
    throw locked_refusal(`campaign run ${record.run_id}`, 'run a call again')
  }
  if (engine.replacing.has(key_of(campaign.path, record.run_id, job_path, member_run_id))) {
    throw EngineError.validation(`${name} is already being run again`)
  }
  return old.origin.by === 'campaign' ? old.origin.call : index + 1
}

/**
 * Starts a new run of a member's job with the values given, in the member's
 * place (§8.5). The start is an ordinary one (§7.5) under the campaign's
 * origin and the call's number; once it is recorded the member points at it,
 * the replaced run joins the member's `attempts`, and a campaign report
 * already attempted is owed again. A refused start leaves the campaign as it
 * was. Answers the new run's id.
 */
export async function replace_member(
  engine: Engine,
  campaign: Campaign,
  run_id: number,
  member_run_id: number,
  job_path: string,
  render: Record<string, unknown>,
  launch: Record<string, unknown>
): Promise<number> {
  const record = campaign.runs.record(run_id)
  const call = call_to_replace(engine, campaign, record, member_run_id, job_path)
  const origin: RunOrigin = { by: 'campaign', run_id, name: record.campaign, call }
  const key = key_of(campaign.path, run_id, job_path, member_run_id)
  engine.replacing.add(key)
  let new_run_id: number
  try {
    new_run_id = await start_job(engine, engine.job(job_path), render, launch, origin)
  } finally {
    engine.replacing.delete(key)
  }

  // Found again after the start's awaits: a hand edit may have reloaded the
  // record, and the campaign run cannot have been deleted meanwhile.
  const current = campaign.runs.find(run_id)
  const member = current?.members.find(
    (candidate) =>
      candidate.run_id === member_run_id &&
      engine.find_job_by_name(candidate.job)?.path === job_path
  )
  if (current === null || member === undefined) {
    throw EngineError.validation(
      `run ${new_run_id} started, but campaign run ${run_id} no longer lists run ` +
        `${member_run_id} to replace`
    )
  }
  member.attempts = [...(member.attempts ?? []), member_run_id]
  member.run_id = new_run_id
  if (current.report !== undefined) {
    current.report = { attempted: false }
  }
  campaign.runs.write(current)
  return new_run_id
}
