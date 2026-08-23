// Deleting a run (convention §12.1): the one operation that removes what coco
// wrote. Everything the run left on disk goes — `runs/<id>/` whole, and its
// report files — and nothing else: the folder's other runs, and for a bench
// run the member runs in their own jobs' folders, are not touched.

import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from './index'
import { EngineError } from './errors'
import type { Bench, Job } from './memory'
import { is_terminal } from './status'

/**
 * Deletes a finished job run: record, rendered artifact, report. An active
 * run is refused — cancel is the way to stop work — and so is UNREACHABLE:
 * a run coco cannot see may still be running, and deleting its record would
 * be the one way to never find out.
 */
export function delete_run(job: Job, run_id: number): void {
  const record = job.runs.record(run_id)
  if (!is_terminal(record.status)) {
    throw EngineError.validation(
      `run ${run_id} (${record.status}) is not finished and cannot be deleted; ` +
        `cancel it first, and let the cancellation land`
    )
  }
  remove_run_files(job.path, run_id)
  job.runs.drop(run_id)
}

/**
 * Deletes a finished bench run: its record, `members.json`, its own report.
 * The member runs belong to their jobs and stay; each keeps its origin, which
 * names the bench and the call. A bench whose status cannot be derived — a
 * member gone missing — counts as finished here: that wreckage is exactly
 * what deletion is for.
 */
export function delete_bench_run(engine: Engine, bench: Bench, run_id: number): void {
  bench.runs.record(run_id)
  let terminal = true
  try {
    terminal = is_terminal(engine.bench_status(bench.path, run_id).status)
  } catch {
    // Underivable: treat as finished.
  }
  if (!terminal) {
    throw EngineError.validation(
      `bench run ${run_id} still has members running and cannot be deleted; cancel it first`
    )
  }
  remove_run_files(bench.path, run_id)
  bench.runs.drop(run_id)
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
