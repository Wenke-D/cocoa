// Cancelling a campaign run (convention §9.1): its cancel is job cancels.

import type { Engine } from '../engine'
import { EngineError } from '../errors'
import { WAITING_ON_DEPLOY, cancel_run } from '../job/cancel'
import { is_cancellable } from '../status'
import type { Campaign } from './campaign'
import { campaign_status } from './status'

/** How one member took a campaign's cancel (§9.1). */
export interface MemberCancel {
  run_id: number
  job: string
  ok: boolean
  error?: string
}

/** Cancels a campaign run by cancelling its still-cancellable members (§3, §9.1). */
export async function cancel_campaign(
  engine: Engine,
  campaign: Campaign,
  run_id: number
): Promise<MemberCancel[]> {
  const record = campaign.runs.record(run_id)
  // The window offers Cancel only on a cancellable run; a caller with no
  // button to hide — the agent socket — is refused here instead, rather than
  // told a settled campaign was cancelled when nothing was asked of anyone.
  const status = campaign_status(engine, campaign, run_id).status
  if (!is_cancellable(status)) {
    throw EngineError.validation(`campaign run ${run_id} (${status}) cannot be cancelled`)
  }
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
