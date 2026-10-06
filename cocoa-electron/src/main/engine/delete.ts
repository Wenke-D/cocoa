// Deleting a run (convention §12.1): the one operation that removes what cocoa
// wrote. Everything the run left on disk goes — `runs/<id>/` whole, and its
// report files — and a campaign run takes the runs it dispatched with it, so a
// deletion never leaves half a fan-out behind: no campaign pointing at members
// that are gone, no member naming a campaign that is.

import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from './index'
import { EngineError } from './errors'
import type { Campaign, Job } from './memory'
import { report_owed } from './record'
import { is_terminal } from './status'

/**
 * Deletes a finished job run: record, rendered artifact, report. An active
 * run is refused — cancel is the way to stop work — and so is UNREACHABLE:
 * a run cocoa cannot see may still be running, and deleting its record would
 * be the one way to never find out. A run a campaign dispatched is refused
 * outright, whatever its status: it is part of a fan-out, and the fan-out
 * is deleted whole, from the campaign's side. A FAILED run whose report has
 * not landed yet waits for it.
 */
export function delete_run(job: Job, run_id: number): void {
  const record = job.runs.record(run_id)
  if (record.origin.by === 'campaign') {
    throw EngineError.validation(
      `run ${run_id} was dispatched by campaign \`${record.origin.name}\` (call ` +
        `${record.origin.call}); delete that campaign run instead — it takes the runs ` +
        `it dispatched with it`
    )
  }
  if (!is_terminal(record.status)) {
    throw EngineError.validation(
      `run ${run_id} (${record.status}) is not finished and cannot be deleted; ` +
        `cancel it first, and let the cancellation land`
    )
  }
  if (report_owed(record)) {
    throw EngineError.validation(`${report_running(`run ${run_id}`)}; delete it once it lands`)
  }
  remove_run_files(job.path, run_id)
  job.runs.drop(run_id)
}

/**
 * Deletes a settled campaign run whole: its record, `members.json` and report,
 * and every member run it dispatched, each from its own job's folder. Every
 * resolvable member must itself be finished — a campaign can settle while a
 * member still runs (§9.1), and deleting a running record is exactly what
 * this refuses everywhere. A member that cannot be resolved — its job
 * unregistered, its record already gone — has nothing left to delete and
 * does not block the rest.
 */
export function delete_campaign_run(engine: Engine, campaign: Campaign, run_id: number): void {
  const record = campaign.runs.record(run_id)
  let terminal = true
  try {
    terminal = is_terminal(engine.campaign_status(campaign.path, run_id).status)
  } catch {
    // Underivable: treat as settled. That wreckage is what deletion is for.
  }
  if (!terminal) {
    throw EngineError.validation(
      `campaign run ${run_id} still has members running and cannot be deleted; cancel it first`
    )
  }
  const members = engine.resolve_members(record)
  for (const member of members) {
    if (member.record !== null && !is_terminal(member.record.status)) {
      throw EngineError.validation(
        `member run ${member.run_id} of \`${member.job_name}\` ` +
          `(${member.record.status}) is still active; cancel it first`
      )
    }
    if (member.record !== null && report_owed(member.record)) {
      throw EngineError.validation(
        `${report_running(`member run ${member.run_id} of \`${member.job_name}\``)}; ` +
          `delete the campaign run once it lands`
      )
    }
  }
  for (const member of members) {
    if (member.job_path !== null && member.record !== null) {
      remove_run_files(member.job_path, member.run_id)
      engine.job(member.job_path).runs.drop(member.run_id)
    }
  }
  remove_run_files(campaign.path, run_id)
  campaign.runs.drop(run_id)
}

/**
 * A failed run's report still to land (§7.3.1). Its script writes
 * `report/<id>.*` when it finishes, and a deletion before then would leave
 * those files to the next run that takes the id (§5).
 */
function report_running(run: string): string {
  return `${run} is FAILED and its report is still running`
}

function remove_run_files(folder: string, run_id: number): void {
  try {
    fs.rmSync(path.join(folder, 'runs', String(run_id)), { recursive: true, force: true })
    fs.rmSync(path.join(folder, 'report', `${run_id}.txt`), { force: true })
    fs.rmSync(path.join(folder, 'report', `${run_id}.html`), { force: true })
  } catch (cause) {
    throw EngineError.io(folder, cause)
  }
}
