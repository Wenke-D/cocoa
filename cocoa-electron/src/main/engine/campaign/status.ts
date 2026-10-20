// The status a campaign run derives from its members (convention §9.1).

import type { Engine } from '../engine'
import { report_on_disk } from '../job/report'
import type { CampaignRecord, RunRecord } from '../record'
import { is_terminal } from '../status'
import type { Status } from '../status'
import type { Campaign } from './campaign'

export interface CampaignStatusView {
  status: Status
  missing_members: string[]
  succeeded: number
  failed: number
  cancelled: number
  running: number
  errors: number
}

/** Derives a campaign run's status (§9.1). Never stored, computed from memory. */
export function campaign_status(
  engine: Engine,
  campaign: Campaign,
  run_id: number
): CampaignStatusView {
  const record = campaign.runs.record(run_id)
  const resolved = engine.resolve_members(record)
  const missing = resolved.filter((member) => member.record === null).map((m) => m.job_name)
  const members = resolved
    .map((member) => member.record)
    .filter((record): record is RunRecord => record !== null)

  const status =
    missing.length > 0
      ? 'ERROR'
      : derive_campaign_status(members, record, report_on_disk(campaign.path, run_id))

  const counts: CampaignStatusView = {
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

/** The campaign status derivation (§9.1), over fully-resolved members. */
function derive_campaign_status(
  members: RunRecord[],
  campaign: CampaignRecord,
  report_exists: boolean
): Status {
  if (members.some((member) => member.status === 'CANCELLING')) {
    return 'CANCELLING'
  }
  if (members.some((member) => !is_terminal(member.status))) {
    // A member waiting on its job's deploy has not launched either.
    if (members.every((member) => member.status === 'STARTING' || member.status === 'DEPLOYING')) {
      return 'STARTING'
    }
    return 'RUNNING'
  }
  if (campaign.launch_failures.length > 0 || members.some((m) => m.status === 'ERROR')) {
    return 'ERROR'
  }
  if (members.some((m) => m.status === 'FAILED')) {
    return 'FAILED'
  }
  if (members.some((m) => m.status === 'CANCELLED')) {
    return 'CANCELLED'
  }
  if (campaign.report !== undefined && campaign.report.attempted) {
    if (campaign.report.error !== undefined) {
      return 'ERROR'
    }
    if (!report_exists) {
      return 'ERROR'
    }
  }
  return report_exists ? 'SUCCEEDED' : 'ANALYZING'
}
