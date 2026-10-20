// Cancelling a job's run (convention §7.4).

import type { Engine } from '../engine'
import { EngineError } from '../errors'
import * as invoke from '../invoke'
import type { Invocation } from '../invoke'
import { apply_status, now_stamp } from '../record'
import { is_cancellable } from '../status'
import type { Job } from './job'

/** Why a `DEPLOYING` run is not cancelled: it has not been submitted (§7.6). */
export const WAITING_ON_DEPLOY =
  'is waiting on its job’s deploy; there is no submission to cancel until it launches'

/** Cancels one run through the job's `cancel` script (§7.4). */
export async function cancel_run(engine: Engine, job: Job, run_id: number): Promise<void> {
  const manifest = job.usable_manifest()
  const record = job.runs.record(run_id)
  if (record.status === 'DEPLOYING') {
    throw EngineError.validation(`run ${run_id} ${WAITING_ON_DEPLOY}`)
  }
  if (!is_cancellable(record.status)) {
    throw EngineError.validation(`run ${run_id} (${record.status}) cannot be cancelled`)
  }
  if (record.submission_id === '') {
    throw EngineError.validation(
      `run ${run_id} is still launching; there is no submission to cancel yet`
    )
  }
  const argv = [...manifest.cancel.words, '--submission', record.submission_id]
  let invocation: Invocation
  try {
    invocation = await invoke.run(job.path, argv, engine.config.cancel_timeout)
  } catch (cause) {
    throw EngineError.io(job.path, cause)
  }
  if (invoke.invocation_ok(invocation)) {
    // The run may have moved while the cancel script ran — ended on its
    // own, or another cancel got there first. The cluster has been told
    // either way; only a run still cancellable takes the CANCELLING mark.
    if (is_cancellable(record.status)) {
      apply_status(record, 'CANCELLING', now_stamp())
      job.runs.write(record)
    }
    return
  }
  throw EngineError.invocation(
    manifest.cancel.display,
    invocation.exit,
    invocation.timed_out,
    invoke.invocation_output(invocation)
  )
}
