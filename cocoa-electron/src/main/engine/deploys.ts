// Making a job ready before it launches (convention §7.5, §7.6). Every start
// asks the job's `check` script first: `CURRENT` launches at once, `STALE`
// runs `deploy` and launches once it is done, `CONFLICT` refuses the start.
//
// One job is checked and deployed by one start at a time — its *gate*. A
// start that finds the gate held waits for it and then checks afresh, so two
// starts never deploy over each other, and the second one sees what the
// first deployed. A deploy holds the gate until its runs are launched.
//
// Like a launch (`in_flight.ts`), a deploy is spawned rather than waited
// for: its runs are recorded `DEPLOYING` at once, and the refresh tick
// collects the script's outcome.

import { EngineError } from './errors'
import type { Engine } from './index'
import * as invoke from './invoke'
import type { Invocation, Running } from './invoke'
import type { Job } from './memory'
import type { JobManifest } from './manifest'
import { apply_status, now_stamp } from './record'

/** What `check` said, when it allows a start at all (§7.5). */
export interface CheckAnswer {
  word: 'CURRENT' | 'STALE'
  reason?: string
}

/** A run waiting on its job's deploy: the launch it takes once that is done. */
export interface Waiting {
  run_id: number
  argv: string[]
  /** The launch command as the manifest spelled it, for its errors. */
  script: string
}

interface DeployInFlight {
  path: string
  script: string
  running: Running
  waiting: Waiting[]
  release: () => void
}

/** Lets a gate go. Releasing twice is harmless, so every path may. */
export type Release = () => void

export class Deploys {
  private readonly engine: Engine
  /** Each job's gate: the last holder's turn, which the next one waits out. */
  private readonly gates = new Map<string, Promise<void>>()
  private deploying: DeployInFlight[] = []
  /** Runs whose deploy is being spawned: held already, so no tick takes them for leftovers. */
  private spawning: { path: string; waiting: Waiting[] }[] = []

  constructor(engine: Engine) {
    this.engine = engine
  }

  /**
   * Waits for the job's gate and holds it. Whoever holds it is the only
   * start checking or deploying that job; the answer lets it go.
   */
  async acquire(path: string): Promise<Release> {
    const before = this.gates.get(path) ?? Promise.resolve()
    let open!: () => void
    const turn = new Promise<void>((resolve) => {
      open = resolve
    })
    const tail = before.then(() => turn)
    this.gates.set(path, tail)
    await before
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      open()
      if (this.gates.get(path) === tail) {
        this.gates.delete(path)
      }
    }
  }

  /**
   * Runs the job's `check` (§7.5). Answers `CURRENT` or `STALE`; a
   * `CONFLICT`, and a check that could not say, refuse the start by
   * throwing — with nothing recorded, since no run exists yet.
   */
  async check(job: Job, manifest: JobManifest): Promise<CheckAnswer> {
    const script = manifest.check.display
    let invocation: Invocation
    try {
      invocation = await invoke.run(
        job.path,
        [...manifest.check.words],
        this.engine.config.check_timeout
      )
    } catch (cause) {
      throw EngineError.io(job.path, cause)
    }
    if (!invoke.invocation_ok(invocation)) {
      throw EngineError.invocation(
        script,
        invocation.exit,
        invocation.timed_out,
        invoke.invocation_output(invocation)
      )
    }
    const lines = invoke.cocoa_return_lines(invocation.stdout)
    if (lines.length !== 1) {
      const said = lines.length === 0 ? 'nothing' : `${lines.length} lines`
      throw EngineError.validation(
        `\`${script}\` answered ${said}; a check answers exactly one line`
      )
    }
    const match = lines[0].match(/^(\S+)(?:\s+(.*))?$/)
    const word = match?.[1] ?? ''
    const reason = match?.[2]?.trim() || undefined
    if (word === 'CURRENT' || word === 'STALE') {
      return reason !== undefined ? { word, reason } : { word }
    }
    if (word === 'CONFLICT') {
      // The script's own judgement, and the whole of it: cocoa does not know
      // what a deploy would collide with, only that the folder says it would.
      throw EngineError.validation(
        `\`${manifest.name}\` cannot start now: deploying it would conflict` +
          (reason !== undefined ? ` — ${reason}` : '')
      )
    }
    throw EngineError.validation(
      `\`${script}\` answered \`${lines[0]}\`; a check answers CURRENT, STALE or CONFLICT`
    )
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
