// A campaign's own report over its members' results (convention §8.3).

import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from '../engine'
import { EngineError } from '../errors'
import * as invoke from '../invoke'
import type { Invocation } from '../invoke'
import { all_params, now_stamp } from '../record'
import type { CampaignMembersFile, RunRecord } from '../record'
import { report_dir, report_path } from '../report_paths'
import { write_atomic } from '../store'
import type { Campaign } from './campaign'

/** Runs the campaign's report over its members' results (§8.3). */
export async function campaign_report(
  engine: Engine,
  campaign: Campaign,
  run_id: number
): Promise<void> {
  const manifest = campaign.usable_manifest()
  const record = campaign.runs.record(run_id)

  const resolved = engine.resolve_members(record)
  const block_reasons: string[] = []
  if (record.launch_failures.length > 0) {
    block_reasons.push(`${record.launch_failures.length} launch(es) failed`)
  }
  for (const member of resolved) {
    if (member.record === null) {
      block_reasons.push(`member \`${member.job_name}\` run ${member.run_id} cannot be resolved`)
    } else if (member.record.status !== 'SUCCEEDED') {
      block_reasons.push(
        `member \`${member.job_name}\` run ${member.run_id} ended ${member.record.status}`
      )
    }
  }
  if (block_reasons.length > 0) {
    throw EngineError.validation(`no campaign report: ${block_reasons.join(', ')}`)
  }

  const run_dir = path.join(campaign.path, 'runs', String(run_id))
  const members_file: CampaignMembersFile = {
    run_id: run_id,
    campaign: record.campaign,
    params: record.params,
    members: resolved.map((member) => {
      const member_record = member.record as RunRecord
      const job_path = member.job_path as string
      return {
        run_id: member.run_id,
        job: member.job_name,
        params: all_params(member_record),
        submission_id: member_record.submission_id,
        report: report_path(job_path, member.run_id)
      }
    })
  }
  write_atomic(path.join(run_dir, 'members.json'), JSON.stringify(members_file, null, 2))

  const folder = report_dir(campaign.path)
  try {
    fs.mkdirSync(folder, { recursive: true })
  } catch (cause) {
    throw EngineError.io(folder, cause)
  }
  const argv = [
    ...manifest.report.words,
    '--run',
    String(run_id),
    '--members',
    `runs/${run_id}/members.json`
  ]
  let invocation: Invocation
  try {
    invocation = await invoke.run(campaign.path, argv, engine.config.report_timeout)
  } catch (cause) {
    throw EngineError.io(campaign.path, cause)
  }

  const ok = invoke.invocation_ok(invocation) && fs.existsSync(report_path(campaign.path, run_id))
  const error = ok
    ? undefined
    : invoke.invocation_ok(invocation)
      ? `report script exited 0 but produced no report/${run_id}.txt`
      : invoke.invocation_output(invocation)
  record.report = { attempted: true, at: now_stamp(), ...(error !== undefined ? { error } : {}) }
  campaign.runs.write(record)

  if (!ok) {
    throw EngineError.invocation(
      manifest.report.display,
      invocation.exit,
      invocation.timed_out,
      error ?? ''
    )
  }
}
