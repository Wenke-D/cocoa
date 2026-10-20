// A job's deploy (convention §7.6). Like a launch (`in_flight.ts`), a deploy
// is spawned rather than waited for: its runs are recorded `DEPLOYING` at
// once, and the refresh tick collects the script's outcome.

import { EngineError } from './errors'
import type { Engine } from './engine'
import * as invoke from './invoke'
import type { Invocation, Running } from './invoke'
import type { Job } from './job/job'
import type { JobManifest } from './manifest'
import type { Release } from './job_gates'
import { apply_status, now_stamp } from './record'

/** A run waiting on its job's deploy: the launch it takes once that is done. */
export interface Waiting {
  run_id: number
  argv: string[]
  /** The launch command as the manifest spelled it, for its errors. */
  script: string
}

/** A deploy spawned and not yet collected, and the runs waiting on it. */
interface DeployInFlight {
  /** The job's folder. */
  path: string
  /** The deploy command as the manifest spelled it, for its errors. */
  script: string
  running: Running
  waiting: Waiting[]
  /** Lets the job's gate go once the waiting runs are launched. */
  release: () => void
}

/** The deploys spawned and not yet collected (§7.6). */
export class Deploys {
  private readonly engine: Engine
  /** Deploys spawned and not yet collected by the refresh tick. */
  private deploying: DeployInFlight[] = []
  /** Runs whose deploy is being spawned: held already, so no tick takes them for leftovers. */
  private spawning: { path: string; waiting: Waiting[] }[] = []

  constructor(engine: Engine) {
    this.engine = engine
  }

  /**
   * Spawns the job's `deploy` (§7.6) for runs already recorded `DEPLOYING`,
   * and holds the gate until `harvest` has launched them. A script that
   * cannot be spawned at all lets the gate go and throws; the caller drops
   * the runs it reserved.
   */
  async begin(
    job: Job,
    manifest: JobManifest,
    waiting: Waiting[],
    release: Release
  ): Promise<void> {
    const spawning = { path: job.path, waiting }
    this.spawning.push(spawning)
    let running: Running
    try {
      running = await invoke.spawn(
        job.path,
        [...manifest.deploy.words],
        this.engine.config.deploy_timeout
      )
    } catch (cause) {
      release()
      throw EngineError.io(job.path, cause)
    } finally {
      this.spawning = this.spawning.filter((entry) => entry !== spawning)
    }
    this.deploying.push({
      path: job.path,
      script: manifest.deploy.display,
      running,
      waiting,
      release
    })
  }

  count(): number {
    return this.deploying.length
  }

  /** Whether one run is waiting on a deploy this engine is holding. */
  holds(path: string, run_id: number): boolean {
    return [...this.spawning, ...this.deploying].some(
      (deploy) => deploy.path === path && deploy.waiting.some((run) => run.run_id === run_id)
    )
  }

  /**
   * Collects the deploys that have finished since the last look (§7.6). A
   * deploy that exited 0 launches every run waiting on it, as a start would
   * have; one that failed moves them all to `ERROR` with its output, since
   * none of them was ever launched. Either way the gate opens afterwards.
   */
  async harvest(): Promise<EngineError[]> {
    const errors: EngineError[] = []
    const done: [DeployInFlight, Invocation][] = []
    const still: DeployInFlight[] = []
    for (const deploy of this.deploying) {
      const invocation = deploy.running.try_finish()
      if (invocation === null) {
        still.push(deploy)
      } else {
        done.push([deploy, invocation])
      }
    }
    // Taken out before the awaits below, so a harvest that overlaps this
    // one never collects the same deploy twice.
    this.deploying = still

    for (const [deploy, invocation] of done) {
      try {
        if (invoke.invocation_ok(invocation)) {
          errors.push(...(await this.launch_waiting(deploy)))
        } else {
          errors.push(this.fail_waiting(deploy, invocation))
        }
      } finally {
        deploy.release()
      }
    }
    return errors
  }

  private async launch_waiting(deploy: DeployInFlight): Promise<EngineError[]> {
    const errors: EngineError[] = []
    for (const waiting of deploy.waiting) {
      let job: Job
      try {
        job = this.engine.job(deploy.path)
        const record = job.runs.record(waiting.run_id)
        apply_status(record, 'STARTING', now_stamp())
        if (record.deploy !== undefined) {
          record.deploy.at = now_stamp()
        }
        job.runs.write(record)
      } catch (cause) {
        errors.push(cause instanceof EngineError ? cause : EngineError.io(deploy.path, cause))
        continue
      }
      // From here on it is an ordinary launch (§7.1), the rest of whose life
      // `in_flight.ts` already knows.
      try {
        const running = await invoke.spawn(
          deploy.path,
          waiting.argv,
          this.engine.config.launch_timeout
        )
        this.engine.in_flight.track(deploy.path, waiting.run_id, waiting.script, running)
      } catch (cause) {
        const failure = EngineError.io(deploy.path, cause)
        this.mark_error(deploy.path, waiting.run_id, failure.message)
        errors.push(failure)
      }
    }
    return errors
  }

  private fail_waiting(deploy: DeployInFlight, invocation: Invocation): EngineError {
    const output = invoke.invocation_output(invocation)
    const failure = EngineError.invocation(
      deploy.script,
      invocation.exit,
      invocation.timed_out,
      output
    )
    for (const waiting of deploy.waiting) {
      this.mark_error(deploy.path, waiting.run_id, `deploy failed: ${failure.message}`, output)
    }
    return failure
  }

  /** Moves a run that never launched to `ERROR`, saying why. */
  private mark_error(path: string, run_id: number, error: string, deploy_error?: string): void {
    try {
      const runs = this.engine.job(path).runs
      const record = runs.record(run_id)
      apply_status(record, 'ERROR', now_stamp())
      record.error = error
      if (record.deploy !== undefined) {
        record.deploy.at = now_stamp()
        if (deploy_error !== undefined) {
          record.deploy.error = deploy_error
        }
      }
      runs.write(record)
    } catch {
      // The job or its record is gone; the error still reaches the caller.
    }
  }

  /**
   * The way a closing cocoa leaves its deploys (§10): the close waits for
   * nothing. The script is killed and every run waiting on it marked
   * `ERROR` now — none of them was launched, and nothing will launch them.
   */
  abandon(): void {
    for (const deploy of this.deploying) {
      deploy.running.kill()
      for (const waiting of deploy.waiting) {
        this.mark_error(
          deploy.path,
          waiting.run_id,
          'cocoa closed before the deploy finished; the run was never launched'
        )
      }
      deploy.release()
    }
    this.deploying = []
  }
}
