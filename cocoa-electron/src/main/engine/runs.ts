import fs from 'node:fs'
import path from 'node:path'
import { EngineError } from './errors'
import { write_atomic } from './store'

export interface RunView<R> {
  run_id: number
  record: R | null
  record_error: EngineError | null
}

interface RecordSlot<R> {
  record: R | null
  error: EngineError | null
}

/**
 * One folder's `runs/` (§7, §12). Records are cocoa's own files and nobody
 * else changes them, so they are read exactly once — when the folder is
 * first seen — and every write lands in memory first, then in
 * `runs/<id>/run.json`.
 */
export class Runs<R extends { run_id: number }> {
  /** The experiment folder whose `runs/` this is. */
  private readonly folder: string
  /** Each run's record, or the error reading it, by run id. */
  private readonly slots = new Map<number, RecordSlot<R>>()

  constructor(folder: string) {
    this.folder = folder
    let entries: string[]
    try {
      entries = fs.readdirSync(path.join(folder, 'runs'))
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue
      }
      const record_path = this.record_path(Number(entry))
      try {
        const text = fs.readFileSync(record_path, 'utf8')
        this.slots.set(Number(entry), { record: JSON.parse(text) as R, error: null })
      } catch (cause) {
        this.slots.set(Number(entry), {
          record: null,
          error: EngineError.store(
            record_path,
            `run.json does not parse: ${(cause as Error).message}`
          )
        })
      }
    }
  }

  /** Every run, newest first; one whose record does not parse carries the error. */
  all(): RunView<R>[] {
    const views = [...this.slots.entries()].map(([run_id, slot]) => ({
      run_id,
      record: slot.record,
      record_error: slot.error
    }))
    views.sort((a, b) => b.run_id - a.run_id)
    return views
  }

  /** The run's record; throws when it is missing or does not parse. */
  record(run_id: number): R {
    const slot = this.slots.get(run_id)
    if (slot === undefined) {
      throw EngineError.not_found(`run ${run_id} in ${this.folder}`)
    }
    if (slot.record === null) {
      throw slot.error ?? EngineError.not_found(`run ${run_id} in ${this.folder}`)
    }
    return slot.record
  }

  /** The run's record, or `null` when it is missing or does not parse. */
  find(run_id: number): R | null {
    return this.slots.get(run_id)?.record ?? null
  }

  /**
   * One past the highest id here, or `0`. Derived, never stored — §5 says
   * why there is no counter. Ids are per experiment: two experiments each
   * have a run `0`.
   */
  next_id(): number {
    if (this.slots.size === 0) {
      return 0
    }
    return Math.max(...this.slots.keys()) + 1
  }

  /** Memory first, then the folder. */
  write(record: R): void {
    this.slots.set(record.run_id, { record, error: null })
    write_atomic(this.record_path(record.run_id), JSON.stringify(record, null, 2))
  }

  /**
   * Forgets a run that was reserved and never launched (§7.1): the record
   * leaves memory and the folder. The run directory and the rendered script
   * in it are left as they are.
   */
  drop(run_id: number): void {
    this.slots.delete(run_id)
    fs.rmSync(this.record_path(run_id), { force: true })
  }

  private record_path(run_id: number): string {
    return path.join(this.folder, 'runs', String(run_id), 'run.json')
  }
}
