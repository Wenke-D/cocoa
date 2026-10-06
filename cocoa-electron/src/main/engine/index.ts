// The engine: every operation the convention defines, over registered
// folders (convention §1–§12). **Memory is the truth**: the whole domain
// state lives in memory, reads never touch the disk, and writes go through
// to the experiment folder. Script invocations are async, because the
// Electron main process must not block.
//
// Five files, along the seams the domain has:
//
//   memory.ts     the truth — `Job`, `Campaign`, their runs, registration, write-through
//   job.ts        start / poll / report / cancel, one job (§7, §10, §11)
//   campaign.ts      plan / start / report / cancel / status, one campaign (§8, §9)
//   in_flight.ts  the launch scripts not yet answered (§7.1)
//   deploys.ts    each job's gate: check before a start, deploy when stale (§7.5, §7.6)
//   index.ts      this: `Engine`, which is the memory plus those operations,
//                 and the refresh tick that drives them all (§7.5)

import * as campaign from './campaign'
import type { CampaignStart, CampaignStatusView, MemberCancel, PlanInstance } from './campaign'
import { as_engine_error } from './errors'
import type { EngineError } from './errors'
import { Deploys } from './deploys'
import { InFlight } from './in_flight'
import * as del from './delete'
import * as job from './job'
import { reportable } from './job'
import type { PollReport, ReportMode } from './job'
import { Memory } from './memory'
import { apply_status, now_stamp } from './record'
import type { RunOrigin, Trigger } from './record'
import { is_terminal } from './status'
import type { Status } from './status'

/** Timeouts (convention §6), in milliseconds. */
export interface Config {
  launch_timeout: number
  poll_timeout: number
  cancel_timeout: number
  plan_timeout: number
  report_timeout: number
  check_timeout: number
  deploy_timeout: number
}

export const DEFAULT_CONFIG: Config = {
  launch_timeout: 60_000,
  poll_timeout: 60_000,
  cancel_timeout: 60_000,
  plan_timeout: 120_000,
  report_timeout: 600_000,
  check_timeout: 60_000,
  // A deploy may build what it puts in place; it gets the report's allowance.
  deploy_timeout: 600_000
}

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
 * The engine: the truth (`Memory`) with the convention's operations over it.
 * Operations are called directly — there is no queue. Synchronous work is
 * atomic on the event loop, and every write that follows an `await` guards
 * itself against the world having moved (`poll_job`'s history check,
 * `cancel_run`'s recheck, `start_job`'s reservation).
 *
 * Every operation takes a folder, the id a job or campaign is addressed by
 * everywhere (IPC, the agent socket, a campaign's members), and resolves it
 * once; the operation modules work on the `Job` or `Campaign` itself.
 */
export class Engine extends Memory {
  readonly config: Config
  /** The launch scripts this engine is still waiting on. */
  readonly in_flight: InFlight
  /** Each job's gate, and the deploys this engine is still waiting on. */
  readonly deploys: Deploys

  constructor(store_path: string, config: Config = DEFAULT_CONFIG) {
    super(store_path)
    this.config = config
    this.in_flight = new InFlight(this)
    this.deploys = new Deploys(this)
  }

  // ------------------------------------------------------------------
  // Job operations — job.ts
  // ------------------------------------------------------------------

  async start_job(
    folder: string,
    render: Record<string, unknown>,
    launch: Record<string, unknown>,
    by: Trigger
  ): Promise<number> {
    const origin: RunOrigin = by === 'human' ? { by: 'human' } : { by: 'agent' }
    return job.start_job(this, this.job(folder), render, launch, origin)
  }

  async poll_job(folder: string): Promise<PollReport> {
    return job.poll_job(this, this.job(folder))
  }

  async report_run(folder: string, run_id: number, mode: ReportMode): Promise<void> {
    return job.report_run(this, this.job(folder), run_id, mode)
  }

  request_report(folder: string, run_id: number): void {
    job.request_report(this.job(folder), run_id)
  }

  async cancel_run(folder: string, run_id: number): Promise<void> {
    return job.cancel_run(this, this.job(folder), run_id)
  }

  delete_run(folder: string, run_id: number): void {
    del.delete_run(this.job(folder), run_id)
  }

  delete_campaign_run(folder: string, run_id: number): void {
    del.delete_campaign_run(this, this.campaign(folder), run_id)
  }

  // ------------------------------------------------------------------
  // Campaign operations — campaign.ts
  // ------------------------------------------------------------------

  async plan_campaign(folder: string, params: Record<string, unknown>): Promise<PlanInstance[]> {
    return campaign.plan_campaign(this, this.campaign(folder), params)
  }

  async start_campaign(
    folder: string,
    params: Record<string, unknown>,
    by: Trigger
  ): Promise<CampaignStart> {
    return campaign.start_campaign(this, this.campaign(folder), params, by)
  }

  async campaign_report(folder: string, run_id: number): Promise<void> {
    return campaign.campaign_report(this, this.campaign(folder), run_id)
  }

  async cancel_campaign(folder: string, run_id: number): Promise<MemberCancel[]> {
    return campaign.cancel_campaign(this, this.campaign(folder), run_id)
  }

  campaign_status(folder: string, run_id: number): CampaignStatusView {
    return campaign.campaign_status(this, this.campaign(folder), run_id)
  }

  // ------------------------------------------------------------------
  // Launches and deploys — in_flight.ts, deploys.ts
  // ------------------------------------------------------------------

  harvest_launches(): EngineError[] {
    return this.in_flight.harvest()
  }

  /**
   * Waits until no deploy and no launch is in flight. For tests and
   * shutdown. A deploy that lands launches its runs, so deploys go first.
   */
  async settle_launches(): Promise<EngineError[]> {
    const errors: EngineError[] = []
    while (this.deploys.count() > 0) {
      errors.push(...(await this.deploys.harvest()))
      if (this.deploys.count() > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    errors.push(...(await this.in_flight.settle()))
    return errors
  }

  launches_in_flight(): number {
    return this.in_flight.count()
  }

  /** The close (§10): deploys first, since a deploy that lands would launch. */
  abandon_launches(): void {
    this.deploys.abandon()
    this.in_flight.abandon()
  }

  // ------------------------------------------------------------------
  // Refresh
  // ------------------------------------------------------------------

  /**
   * One refresh tick (§7.5, §10): harvest, reconcile disk → memory, poll,
   * auto-report, campaign reports. Deploys are harvested before launches: a
   * deploy that landed spawns the launches waiting on it.
   */
  async refresh(): Promise<RefreshReport> {
    const deploy_errors = await this.deploys.harvest()
    const report: RefreshReport = {
      polls: 0,
      poll_changes: [],
      poll_warnings: [],
      poll_errors: [],
      reports_run: 0,
      report_errors: [],
      launch_errors: [...deploy_errors, ...this.in_flight.harvest()]
    }

    this.reconcile()

    for (const job of this.jobs()) {
      if (job.manifest === null) {
        continue
      }
      report.polls += 1
      try {
        const poll = await this.poll_job(job.path)
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
          !this.in_flight.holds(job.path, run_view.run_id) &&
          !this.deploys.holds(job.path, run_view.run_id)
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
            await this.report_run(job.path, run_view.run_id, 'auto')
          } catch (cause) {
            report.report_errors.push(as_engine_error(job.path, cause))
          }
        }
      }
    }

    for (const campaign of this.campaigns()) {
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
          const status = this.campaign_status(campaign.path, run_view.run_id)
          if (status.status === 'ANALYZING') {
            report.reports_run += 1
            await this.campaign_report(campaign.path, run_view.run_id)
          }
        } catch (cause) {
          report.report_errors.push(as_engine_error(campaign.path, cause))
        }
      }
    }
    return report
  }
}
