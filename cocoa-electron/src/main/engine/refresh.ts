// The refresh tick (§7.5, §10): what the engine does on every pass.

import type { Engine } from './engine'
import { as_engine_error } from './errors'
import type { EngineError } from './errors'
import { reportable } from './job'
import { apply_status, now_stamp } from './record'
import { is_terminal } from './status'
import type { Status } from './status'

export interface RefreshReport {
  polls: number
  poll_changes: [number, Status][]
  poll_warnings: string[]
  poll_errors: EngineError[]
  reports_run: number
  report_errors: EngineError[]
  /** Launches that failed, and deploys that failed the launches waiting on them. */
  launch_errors: EngineError[]
}

/**
 * One refresh tick (§7.5, §10): harvest, reconcile disk → memory, poll,
 * auto-report, campaign reports. Deploys are harvested before launches: a
 * deploy that landed spawns the launches waiting on it.
 */
export async function refresh(engine: Engine): Promise<RefreshReport> {
  const deploy_errors = await engine.deploys.harvest()
  const report: RefreshReport = {
    polls: 0,
    poll_changes: [],
    poll_warnings: [],
    poll_errors: [],
    reports_run: 0,
    report_errors: [],
    launch_errors: [...deploy_errors, ...engine.in_flight.harvest()]
  }

  engine.reconcile()

  for (const job of engine.jobs()) {
    if (job.manifest === null) {
      continue
    }
    report.polls += 1
    try {
      const poll = await engine.poll_job(job.path)
      report.poll_changes.push(...poll.changed)
      report.poll_warnings.push(...poll.warnings)
    } catch (cause) {
      report.poll_errors.push(as_engine_error(job.path, cause))
    }
    for (const run_view of job.runs.all()) {
      const record = run_view.record
      if (record === null) {
        continue
      }
      // A run still "launching" whose script this engine is not holding
      // is a previous session's leftover (§10): the stdout that carried
      // its submission id died with that process. One still deploying is
      // the same, a stage earlier: nothing will launch it now (§7.6).
      if (
        record.submission_id === '' &&
        !is_terminal(record.status) &&
        !engine.in_flight.holds(job.path, run_view.run_id) &&
        !engine.deploys.holds(job.path, run_view.run_id)
      ) {
        const deploying = record.status === 'DEPLOYING'
        apply_status(record, 'ERROR', now_stamp())
        record.error = deploying
          ? 'cocoa closed while the deploy script was running; the run was never launched'
          : 'cocoa closed while the launch script was running; the submission id is lost'
        try {
          job.runs.write(record)
        } catch (cause) {
          report.report_errors.push(as_engine_error(job.path, cause))
        }
        continue
      }
      // Every due report: a completed run's, and a FAILED run's owed one
      // (§7.3.1) — whether poll or a person (§7.3.2) made it due. A run
      // already FAILED on disk before that rule owes nothing.
      if (reportable(record, 'auto')) {
        report.reports_run += 1
        try {
          await engine.report_run(job.path, run_view.run_id, 'auto')
        } catch (cause) {
          report.report_errors.push(as_engine_error(job.path, cause))
        }
      }
    }
  }

  for (const campaign of engine.campaigns()) {
    if (campaign.manifest === null) {
      continue
    }
    for (const run_view of campaign.runs.all()) {
      const record = run_view.record
      if (record === null) {
        continue
      }
      const needs_report = record.report === undefined || !record.report.attempted
      if (!needs_report) {
        continue
      }
      try {
        const status = engine.campaign_status(campaign.path, run_view.run_id)
        if (status.status === 'ANALYZING') {
          report.reports_run += 1
          await engine.campaign_report(campaign.path, run_view.run_id)
        }
      } catch (cause) {
        report.report_errors.push(as_engine_error(campaign.path, cause))
      }
    }
  }
  return report
}
