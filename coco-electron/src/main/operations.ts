// The operations the renderer can ask for, as plain functions over the
// engine. They live here rather than inside the `ipcMain.handle` calls so
// they can be exercised without an Electron app around them — the handlers
// in `index.ts` are wiring: call one of these, publish, answer.
//
// Every one of them answers rather than throws: a refusal is an outcome the
// user reads, not a crash.

import fs from 'node:fs'
import path from 'node:path'
import type {
  AddFolderResult,
  CancelResult,
  CancelTarget,
  RemoveFolderResult,
  ReportResult,
  ReportTarget,
  StartResult
} from '@shared/world'
import type { Coco } from './engine/coco'

/** Reports larger than this are refused rather than sent over IPC whole. */
const MAX_REPORT_BYTES = 16 * 1024 * 1024

/** Starts a job or a bench by entity name, splitting params as the manifest asks. */
/**
 * `trigger` is the whole difference between a click and an agent's call
 * (§43): same lookup, same validation, same queue — one word on the record,
 * which is what the history table reads back as "you" or "agent".
 */
export async function start_run(
  engine: Coco,
  name: string,
  parameters: Record<string, string>,
  trigger: 'human' | 'agent' = 'human'
): Promise<StartResult> {
  try {
    const view = engine
      .entities()
      .find((entity) => entity.manifest !== null && entity.manifest.name === name)
    if (view === undefined || view.manifest === null) {
      return { ok: false, message: `no experiment named \`${name}\` is registered` }
    }
    let run_id: number
    if (view.manifest.kind === 'job') {
      const render: Record<string, string> = {}
      const launch: Record<string, string> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (view.manifest.render_params.includes(key)) render[key] = value
        else launch[key] = value
      }
      run_id = await engine.start_job(view.path, render, launch, trigger)
    } else {
      const start = await engine.start_bench(view.path, parameters, trigger)
      run_id = start.run_id
    }
    return { ok: true, run_id: String(run_id) }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * Requests a cancellation (§16.3). Success means the request was accepted —
 * the run moves to `CANCELLING` and only the next poll can call it cancelled.
 *
 * A bench cancels member by member, and members can disagree: this reports a
 * partial failure as a failure, naming what did not stop. (The Rust adapter
 * discards the per-member results here; a cancel that half worked should not
 * read as done.)
 */
export async function cancel(engine: Coco, target: CancelTarget): Promise<CancelResult> {
  try {
    if (target.kind === 'job_run') {
      await engine.cancel_run(target.job_id, Number(target.run_id))
      return { ok: true }
    }
    const results = await engine.cancel_bench(target.bench_id, Number(target.run_id))
    const failures = results.filter((result) => !result.ok)
    if (failures.length === 0) return { ok: true }
    const first = failures[0]
    const rest = failures.length > 1 ? ` (and ${failures.length - 1} more member(s) refused)` : ''
    return {
      ok: false,
      message: `run ${first.run_id} of \`${first.job}\` was not cancelled: ${first.error}${rest}`
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * Reads one run's report off disk (§20). The world already says whether a
 * report exists and in which format; this is the content behind that.
 *
 * Plain text wins over HTML when a run wrote both, matching `report_state_of`
 * in the world builder — the two must agree, or the viewer would offer a
 * format the page did not announce.
 */
export function read_report(engine: Coco, target: ReportTarget): ReportResult {
  const registered = engine.entities().some((entity) => entity.path === target.entity_id)
  if (!registered) {
    return { ok: false, message: `no experiment is registered at ${target.entity_id}` }
  }
  if (!/^\d+$/.test(target.run_id)) {
    return { ok: false, message: `\`${target.run_id}\` is not a run id` }
  }

  const dir = path.join(target.entity_id, 'report')
  for (const [format, file] of [
    ['PlainText', path.join(dir, `${target.run_id}.txt`)],
    ['Html', path.join(dir, `${target.run_id}.html`)]
  ] as const) {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (stat.size > MAX_REPORT_BYTES) {
      return {
        ok: false,
        message: `report is ${Math.round(stat.size / 1_000_000)} MB; too large to open in the app`
      }
    }
    try {
      return { ok: true, format, text: fs.readFileSync(file, 'utf8') }
    } catch (error) {
      return { ok: false, message: `report could not be read: ${(error as Error).message}` }
    }
  }
  return { ok: false, message: `run ${target.run_id} has no report` }
}

/**
 * Registers one picked folder (§11.5, with this form's divergence: the pick
 * is the folder, and nothing beneath it is searched).
 *
 * A folder registers only if its manifest is usable at the moment it is
 * picked; an unusable one is refused with the reason. A folder already in the
 * Explorer is a no-op, and says so rather than reporting a registration that
 * did not happen.
 */
export function add_folder(engine: Coco, folder: string): AddFolderResult {
  const before = new Set(engine.entities().map((entity) => entity.path))
  try {
    engine.register(folder)
  } catch (error) {
    return { ok: false, cancelled: false, message: (error as Error).message }
  }
  const added = engine.entities().find((entity) => !before.has(entity.path))
  if (added !== undefined) return { ok: true, entity_id: added.path, already: false }

  // `register` returns silently for a folder already in the store. Which one
  // it was is answered in the store's own terms — canonical paths, since that
  // is what `register` writes and what an entity id is.
  let canonical = folder
  try {
    canonical = fs.realpathSync(folder)
  } catch {
    // Unreadable now; `register` would have refused it above, so this is a
    // path that resolved a moment ago. Compare with what we were given.
  }
  return { ok: true, entity_id: canonical, already: true }
}

/**
 * Takes a folder out of the Explorer (§36: *remove from Explorer*, never
 * *delete folder*). Nothing on disk is touched — the manifest, the runs and
 * the reports stay exactly where they are, so adding the folder again brings
 * its whole history back.
 */
export function remove_folder(engine: Coco, entity_id: string): RemoveFolderResult {
  try {
    engine.unregister(entity_id)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}
