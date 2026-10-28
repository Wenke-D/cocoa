// The engine: every operation the convention defines, over registered
// folders (convention §1–§12). **Memory is the truth**: the whole domain
// state lives in memory, reads never touch the disk, and writes go through
// to the experiment folder. Script invocations are async, because the
// Electron main process must not block.

import { cancel_campaign } from './campaign/cancel'
import type { MemberCancel } from './campaign/cancel'
import { plan_campaign } from './campaign/plan'
import type { PlanInstance } from './campaign/plan'
import { campaign_report, request_campaign_report } from './campaign/report'
import { start_campaign } from './campaign/start'
import type { CampaignStart } from './campaign/start'
import { campaign_status } from './campaign/status'
import type { CampaignStatusView } from './campaign/status'
import { DEFAULT_CONFIG } from './config'
import type { Config } from './config'
import type { EngineError } from './errors'
import { visualize } from './visualize'
import { Deploys } from './deploys'
import { InFlight } from './in_flight'
import { JobGates } from './job_gates'
import * as del from './delete'
import { cancel_run } from './job/cancel'
import { poll_job } from './job/poll'
import type { PollReport } from './job/poll'
import { report_in_flight, report_run, request_report } from './job/report'
import type { ReportMode } from './job/report'
import { start_job } from './job/start'
import { Memory } from './memory'
import type { RunOrigin, Trigger } from './record'
import { refresh } from './refresh'
import { set_report_lock } from './report_lock'
import type { RefreshReport } from './refresh'

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
  /** Each job's gate: one start at a time checks or deploys a job (§7.5). */
  readonly gates = new JobGates()
  /** The deploys this engine is still waiting on. */
  readonly deploys: Deploys

  constructor(store_path: string, config: Config = DEFAULT_CONFIG) {
    super(store_path)
    this.config = config
    this.in_flight = new InFlight(this)
    this.deploys = new Deploys(this)
  }

  // ------------------------------------------------------------------
  // Job operations
  // ------------------------------------------------------------------

  async start_job(
    folder: string,
    render: Record<string, unknown>,
    launch: Record<string, unknown>,
    by: Trigger
  ): Promise<number> {
    const origin: RunOrigin = by === 'human' ? { by: 'human' } : { by: 'agent' }
    return start_job(this, this.job(folder), render, launch, origin)
  }

  async poll_job(folder: string): Promise<PollReport> {
    return poll_job(this, this.job(folder))
  }

  async report_run(folder: string, run_id: number, mode: ReportMode): Promise<void> {
    return report_run(this, this.job(folder), run_id, mode)
  }

  /** Asks for a job run's or a campaign run's report again, by hand (§7.3.2, §8.3). */
  request_report(folder: string, run_id: number): void {
    const job = this.jobs().find((candidate) => candidate.path === folder)
    if (job !== undefined) {
      request_report(job, run_id)
    } else {
      request_campaign_report(this, this.campaign(folder), run_id)
    }
  }

  /** Locks or unlocks a job run's or a campaign run's report (§7.3.3). */
  set_report_lock(folder: string, run_id: number, locked: boolean): void {
    const job = this.jobs().find((candidate) => candidate.path === folder)
    if (job !== undefined) {
      set_report_lock(folder, job.runs, run_id, locked, report_in_flight)
    } else {
      set_report_lock(
        folder,
        this.campaign(folder).runs,
        run_id,
        locked,
        (record) => record.report?.attempted === false
      )
    }
  }

  async cancel_run(folder: string, run_id: number): Promise<void> {
    return cancel_run(this, this.job(folder), run_id)
  }

  delete_run(folder: string, run_id: number): void {
    del.delete_run(this.job(folder), run_id)
  }

  delete_campaign_run(folder: string, run_id: number): void {
    del.delete_campaign_run(this, this.campaign(folder), run_id)
  }

  // ------------------------------------------------------------------
  // Campaign operations
  // ------------------------------------------------------------------

  async plan_campaign(folder: string, params: Record<string, unknown>): Promise<PlanInstance[]> {
    return plan_campaign(this, this.campaign(folder), params)
  }

  async start_campaign(
    folder: string,
    params: Record<string, unknown>,
    by: Trigger
  ): Promise<CampaignStart> {
    return start_campaign(this, this.campaign(folder), params, by)
  }

  async campaign_report(folder: string, run_id: number): Promise<void> {
    return campaign_report(this, this.campaign(folder), run_id)
  }

  async cancel_campaign(folder: string, run_id: number): Promise<MemberCancel[]> {
    return cancel_campaign(this, this.campaign(folder), run_id)
  }

  campaign_status(folder: string, run_id: number): CampaignStatusView {
    return campaign_status(this, this.campaign(folder), run_id)
  }

  /**
   * Opens a job's or a campaign's viewer on one reported run (§7.7, §8.4);
   * `on_failure` hears of a viewer that exits non-zero, whenever that is.
   */
  async visualize(
    folder: string,
    run_id: number,
    on_failure: (error: EngineError) => void
  ): Promise<void> {
    const entity = this.jobs().find((job) => job.path === folder) ?? this.campaign(folder)
    return visualize(entity, run_id, on_failure)
  }

  // ------------------------------------------------------------------
  // Launches and deploys
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

  /** One refresh tick (§7.5, §10). */
  async refresh(): Promise<RefreshReport> {
    return refresh(this)
  }
}
