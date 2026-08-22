// The engine: every operation the convention defines, over registered
// folders (convention §1–§12). **Memory is the truth**: the whole domain
// state lives in memory, reads never touch the disk, and writes go through
// to the experiment folder. Script invocations are async, because the
// Electron main process must not block.
//
// Five files, along the seams the domain has:
//
//   memory.ts     the truth — registration, manifests, records, write-through
//   job.ts        start / poll / report / cancel, one job (§7, §10, §11)
//   bench.ts      plan / start / report / cancel / status, one bench (§8, §9)
//   in_flight.ts  the launch scripts not yet answered (§7.1)
//   index.ts      this: `Engine`, which is the memory plus those operations,
//                 and the refresh tick that drives them all (§7.5)

import * as bench from './bench'
import type { BenchStart, BenchStatusView, MemberCancel, PlanInstance } from './bench'
import { as_engine_error } from './errors'
import type { EngineError } from './errors'
import { InFlight } from './in_flight'
import * as job from './job'
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
}

export const DEFAULT_CONFIG: Config = {
  launch_timeout: 60_000,
  poll_timeout: 60_000,
  cancel_timeout: 60_000,
  plan_timeout: 120_000,
  report_timeout: 600_000
}

export interface RefreshReport {
  polls: number
  poll_changes: [number, Status][]
  poll_warnings: string[]
  poll_errors: EngineError[]
  reports_run: number
  report_errors: EngineError[]
  launch_errors: EngineError[]
}

/**
 * The engine: the truth (`Memory`) with the convention's operations over it.
 * Operations are called directly — there is no queue. Synchronous work is
 * atomic on the event loop, and every write that follows an `await` guards
 * itself against the world having moved (`poll_job`'s history check,
 * `cancel_run`'s recheck, `start_job`'s reservation).
 */
export class Engine extends Memory {
  readonly config: Config
  /** The launch scripts this engine is still waiting on. */
  readonly in_flight: InFlight

  constructor(store_path: string, config: Config = DEFAULT_CONFIG) {
    super(store_path)
    this.config = config
    this.in_flight = new InFlight(this)
  }

  // ------------------------------------------------------------------
  // Job operations — job.ts
  // ------------------------------------------------------------------

  async start_job(
    folder: string,
    render: Record<string, string>,
    launch: Record<string, string>,
    by: Trigger
  ): Promise<number> {
    const origin: RunOrigin = by === 'human' ? { by: 'human' } : { by: 'agent' }
    return job.start_job(this, folder, render, launch, origin)
  }

  async poll_job(folder: string): Promise<PollReport> {
    return job.poll_job(this, folder)
  }

  async report_run(folder: string, run_id: number, mode: ReportMode): Promise<void> {
    return job.report_run(this, folder, run_id, mode)
  }

  async cancel_run(folder: string, run_id: number): Promise<void> {
    return job.cancel_run(this, folder, run_id)
  }

  // ------------------------------------------------------------------
  // Bench operations — bench.ts
  // ------------------------------------------------------------------

  async plan_bench(folder: string, params: Record<string, string>): Promise<PlanInstance[]> {
    return bench.plan_bench(this, folder, params)
  }

  async start_bench(
    folder: string,
    params: Record<string, string>,
    by: Trigger
  ): Promise<BenchStart> {
    return bench.start_bench(this, folder, params, by)
  }

  async bench_report(folder: string, run_id: number): Promise<void> {
    return bench.bench_report(this, folder, run_id)
  }

  async cancel_bench(folder: string, run_id: number): Promise<MemberCancel[]> {
    return bench.cancel_bench(this, folder, run_id)
  }

  bench_status(folder: string, run_id: number): BenchStatusView {
    return bench.bench_status(this, folder, run_id)
  }

  // ------------------------------------------------------------------
  // Launches — in_flight.ts
  // ------------------------------------------------------------------

  harvest_launches(): EngineError[] {
    return this.in_flight.harvest()
  }

  async settle_launches(): Promise<EngineError[]> {
    return this.in_flight.settle()
  }

  launches_in_flight(): number {
    return this.in_flight.count()
  }

  abandon_launches(): void {
    this.in_flight.abandon()
  }

  // ------------------------------------------------------------------
  // Refresh
  // ------------------------------------------------------------------

  /**
   * One refresh tick (§7.5, §10): harvest, reconcile disk → memory, poll,
   * auto-report, bench reports.
   */
  async refresh(): Promise<RefreshReport> {
    const report: RefreshReport = {
      polls: 0,
      poll_changes: [],
      poll_warnings: [],
      poll_errors: [],
      reports_run: 0,
      report_errors: [],
      launch_errors: this.in_flight.harvest()
    }

    this.reconcile()

    for (const view of this.entities()) {
      const manifest = view.manifest
      if (manifest === null) {
        continue
      }
      if (manifest.kind === 'job') {
        report.polls += 1
        try {
          const poll = await this.poll_job(view.path)
          report.poll_changes.push(...poll.changed)
          report.poll_warnings.push(...poll.warnings)
        } catch (cause) {
          report.poll_errors.push(as_engine_error(view.path, cause))
        }
        for (const run_view of this.job_runs(view.path)) {
          const record = run_view.record
          if (record === null) {
            continue
          }
          // A run still "launching" whose script this engine is not holding
          // is a previous session's leftover (§10): the stdout that carried
          // its submission id died with that process.
          if (
            record.submission_id === '' &&
            !is_terminal(record.status) &&
            !this.in_flight.holds(view.path, run_view.run_id)
          ) {
            apply_status(record, 'ERROR', now_stamp())
            record.error =
              'coco closed while the launch script was running; the submission id is lost'
            try {
              this.write_run_record(view.path, record)
            } catch (cause) {
              report.report_errors.push(as_engine_error(view.path, cause))
            }
            continue
          }
          if (record.status === 'COMPLETED' || record.status === 'ANALYZING') {
            report.reports_run += 1
            try {
              await this.report_run(view.path, run_view.run_id, 'auto')
            } catch (cause) {
              report.report_errors.push(as_engine_error(view.path, cause))
            }
          }
        }
      } else {
        for (const run_view of this.bench_runs(view.path)) {
          const record = run_view.record
          if (record === null) {
            continue
          }
          const needs_report = record.report === undefined || !record.report.attempted
          if (!needs_report) {
            continue
          }
          try {
            const status = this.bench_status(view.path, run_view.run_id)
            if (status.status === 'ANALYZING') {
              report.reports_run += 1
              await this.bench_report(view.path, run_view.run_id)
            }
          } catch (cause) {
            report.report_errors.push(as_engine_error(view.path, cause))
          }
        }
      }
    }
    return report
  }
}
