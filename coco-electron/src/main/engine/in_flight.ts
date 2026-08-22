// The launches whose scripts have not answered yet (convention §7.1). A start
// means "launched", not waited-for: `launch` is spawned, the run is recorded
// with an empty submission id, and the script's one `COCO_RETURN:` line — the
// submission id — is collected here on a later tick.

import { EngineError, as_engine_error } from './errors'
import * as invoke from './invoke'
import type { Invocation, Running } from './invoke'
import type { Memory } from './memory'
import { apply_status, now_stamp } from './record'

interface LaunchInFlight {
  path: string
  run_id: number
  script: string
  running: Running
}

/**
 * The launch scripts this engine is holding, and what their answers do to
 * the records in `memory`.
 */
export class InFlight {
  private readonly memory: Memory
  private launching: LaunchInFlight[] = []

  constructor(memory: Memory) {
    this.memory = memory
  }

  /** Starts holding one launch; `harvest` collects it once the script returns. */
  track(path: string, run_id: number, script: string, running: Running): void {
    this.launching.push({ path, run_id, script, running })
  }

  count(): number {
    return this.launching.length
  }

  /** Whether one run's launch script is still in this engine's hands. */
  holds(path: string, run_id: number): boolean {
    return this.launching.some((launch) => launch.path === path && launch.run_id === run_id)
  }

  /** Collects launch scripts that have finished since the last look (§7.1). */
  harvest(): EngineError[] {
    const errors: EngineError[] = []
    const still: LaunchInFlight[] = []
    for (const in_flight of this.launching) {
      const invocation = in_flight.running.try_finish()
      if (invocation === null) {
        still.push(in_flight)
        continue
      }
      let submission_id: string | null = null
      let failure: EngineError | null = null
      try {
        submission_id = parse_launch_return(invocation)
      } catch (cause) {
        failure = invocation_error(in_flight.script, invocation, (cause as Error).message)
      }
      if (submission_id !== null) {
        try {
          const record = this.memory.run_record(in_flight.path, in_flight.run_id)
          record.submission_id = submission_id
          this.memory.write_run_record(in_flight.path, record)
        } catch (cause) {
          errors.push(as_engine_error(in_flight.path, cause))
        }
      } else if (failure !== null) {
        try {
          const record = this.memory.run_record(in_flight.path, in_flight.run_id)
          apply_status(record, 'ERROR', now_stamp())
          record.error = failure.message
          this.memory.write_run_record(in_flight.path, record)
        } catch {
          // The record is gone; the error below still reaches the caller.
        }
        errors.push(failure)
      }
    }
    this.launching = still
    return errors
  }

  /** Waits until no launch is in flight. For tests and shutdown. */
  async settle(): Promise<EngineError[]> {
    const errors: EngineError[] = []
    while (this.launching.length > 0) {
      errors.push(...this.harvest())
      if (this.launching.length > 0) {
        await sleep(5)
      }
    }
    return errors
  }

  /**
   * The way a closing coco leaves its launches (§10): the close waits for
   * nothing. An answer already delivered is still collected; a script that
   * has not answered is killed and its run marked ERROR now, honestly,
   * saying why the run cannot be tracked.
   */
  abandon(): void {
    this.harvest()
    for (const in_flight of this.launching) {
      in_flight.running.kill()
      try {
        const record = this.memory.run_record(in_flight.path, in_flight.run_id)
        apply_status(record, 'ERROR', now_stamp())
        record.error =
          'coco closed before the launch script answered; the run can no longer be tracked'
        this.memory.write_run_record(in_flight.path, record)
      } catch {
        // Nothing left to mark.
      }
    }
    this.launching = []
  }
}

/**
 * A launch must exit 0 and print exactly one `COCO_RETURN:` line whose
 * payload is a single non-empty token (§7.1).
 */
function parse_launch_return(invocation: Invocation): string {
  if (invocation.timed_out || invocation.exit !== 0) {
    throw new Error('')
  }
  const lines = invoke.coco_return_lines(invocation.stdout)
  const last = lines[lines.length - 1]
  if (last === undefined) {
    throw new Error('script printed no COCO_RETURN: line')
  }
  if (last === '' || last.split(/\s+/).length !== 1) {
    throw new Error('COCO_RETURN: payload must be a single token')
  }
  return last
}

function invocation_error(script: string, invocation: Invocation, detail: string): EngineError {
  const output =
    detail === ''
      ? invoke.invocation_output(invocation)
      : `${detail}\n${invoke.invocation_output(invocation)}`
  return EngineError.invocation(script, invocation.exit, invocation.timed_out, output)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
