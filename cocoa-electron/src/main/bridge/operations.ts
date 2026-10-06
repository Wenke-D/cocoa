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
  StartResult,
  DeleteTarget,
  DeleteResult,
  RerunReportResult,
  RerunReportTarget
} from '@shared/world'
import type { Engine } from '../engine'

/** Reports larger than this are refused rather than sent over IPC whole. */
const MAX_REPORT_BYTES = 16 * 1024 * 1024

/** Starts a job or a campaign by entity name, splitting params as the manifest asks. */
/**
 * `trigger` is the whole difference between a click and an agent's call
 * (§43): same lookup, same validation, same queue — one word on the record,
 * which is what the history table reads back as "you" or "agent".
 */
export async function start_run(
  engine: Engine,
  name: string,
  parameters: Record<string, unknown>,
  trigger: 'human' | 'agent' = 'human'
): Promise<StartResult> {
  try {
    const job = engine.find_job_by_name(name)
    const campaign = engine.find_campaign_by_name(name)
    let run_id: number
    if (job !== null) {
      const manifest = job.usable_manifest()
      const render_names = new Set(manifest.render_params.map((param) => param.name))
      const render: Record<string, unknown> = {}
      const launch: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (render_names.has(key)) {
          render[key] = value
        } else {
          launch[key] = value
        }
      }
      run_id = await engine.start_job(job.path, render, launch, trigger)
    } else if (campaign !== null) {
      const start = await engine.start_campaign(campaign.path, parameters, trigger)
      run_id = start.run_id
    } else {
      return { ok: false, message: `no experiment named \`${name}\` is registered` }
    }
    return { ok: true, run_id: String(run_id) }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * Deletes a finished run for good (§16.4): everything it left on disk, and
 * nothing else. The engine refuses anything still moving; here that refusal
 * is answered, never thrown, like every other operation.
 */
export function delete_run(engine: Engine, target: DeleteTarget): DeleteResult {
  try {
    if (target.kind === 'job_run') {
      engine.delete_run(target.job_id, Number(target.run_id))
    } else {
      engine.delete_campaign_run(target.campaign_id, Number(target.run_id))
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * Re-runs a job run's report by hand (convention §7.3.2). Accepted means the
 * report is due — the run reads `Generating` — not that it ran: the refresh
 * tick runs it, and its outcome arrives the way an automatic report's does.
 */
export function rerun_report(engine: Engine, target: RerunReportTarget): RerunReportResult {
  try {
    if (!/^\d+$/.test(target.run_id)) {
      return { ok: false, message: `\`${target.run_id}\` is not a run id` }
    }
    engine.request_report(target.job_id, Number(target.run_id))
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * Requests a cancellation (§16.3). Success means the request was accepted —
 * the run moves to `CANCELLING` and only the next poll can call it cancelled.
 *
 * A campaign cancels member by member, and members can disagree: this reports a
 * partial failure as a failure, naming what did not stop. (The Rust adapter
 * discards the per-member results here; a cancel that half worked should not
 * read as done.)
 */
export async function cancel(engine: Engine, target: CancelTarget): Promise<CancelResult> {
  try {
    if (target.kind === 'job_run') {
      await engine.cancel_run(target.job_id, Number(target.run_id))
      return { ok: true }
    }
    const results = await engine.cancel_campaign(target.campaign_id, Number(target.run_id))
    const failures = results.filter((result) => !result.ok)
    if (failures.length === 0) {
      return { ok: true }
    }
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
 * Reads one report file of a run off disk (§20): the format the target names.
 * The world already says which files exist; this is the content behind one.
 */
export function read_report(engine: Engine, target: ReportTarget): ReportResult {
  if (!engine.registered(target.entity_id)) {
    return { ok: false, message: `no experiment is registered at ${target.entity_id}` }
  }
  if (!/^\d+$/.test(target.run_id)) {
    return { ok: false, message: `\`${target.run_id}\` is not a run id` }
  }

  const format = target.format
  if (format !== 'PlainText' && format !== 'Html') {
    return { ok: false, message: `\`${String(format)}\` is not a report format` }
  }
  const extension = format === 'Html' ? 'html' : 'txt'
  const file = path.join(target.entity_id, 'report', `${target.run_id}.${extension}`)
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return { ok: false, message: `run ${target.run_id} has no ${extension} report` }
  }
  if (!stat.isFile()) {
    return { ok: false, message: `run ${target.run_id} has no ${extension} report` }
  }
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

/**
 * Registers one picked folder (§11.5, with this form's divergence: the pick
 * is the folder, and nothing beneath it is searched).
 *
 * A folder registers only if its manifest is usable at the moment it is
 * picked; an unusable one is refused with the reason. A folder already in the
 * Explorer is a no-op, and says so rather than reporting a registration that
 * did not happen.
 */
export function add_folder(engine: Engine, folder: string): AddFolderResult {
  try {
    // The entity id is the canonical path, which is what `register` keys by.
    const registration = engine.register(folder)
    return { ok: true, entity_id: registration.path, already: registration.already }
  } catch (error) {
    return { ok: false, cancelled: false, message: (error as Error).message }
  }
}

/**
 * Takes a folder out of the Explorer (§36: *remove from Explorer*, never
 * *delete folder*). Nothing on disk is touched — the manifest, the runs and
 * the reports stay exactly where they are, so adding the folder again brings
 * its whole history back.
 */
export function remove_folder(engine: Engine, entity_id: string): RemoveFolderResult {
  try {
    engine.unregister(entity_id)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}
