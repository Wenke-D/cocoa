// There is no queue on the engine: operations interleave at every `await`,
// and each write that follows one guards itself. These are the races the
// old serializer used to forbid — kept as proof the guards hold.

import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanup_temp_dirs,
  engine,
  job_folder,
  settle,
  temp_dir,
  write,
  write_script
} from './support'
import { cancel } from '../src/main/bridge/operations'

afterEach(cleanup_temp_dirs)

// A poll is a process and takes its time. A cancel asked meanwhile finishes
// first, and the poll's answer — formed before the cancellation existed —
// must not land on top of it: `poll_job`'s history-length guard drops it.
describe('a cancel during a refresh', () => {
  it('survives the poll that was already in flight', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'racy')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)
    // A poll that takes as long as a real one does.
    write_script(job, 'poll.sh', 'sleep 0.5\necho "COCOA_RETURN: RUNNING"\n')

    const [, result] = await Promise.all([
      cocoa.refresh(),
      cancel(cocoa, { kind: 'job_run', job_id: job, run_id: String(run_id) })
    ])

    expect(result).toEqual({ ok: true })
    expect(cocoa.job(job).runs.record(run_id).status).toBe('CANCELLING')
  })
})

// Two starts at once must not share a run id: the record is reserved in the
// same synchronous stretch that picked the id, before the spawn's `await`.
describe('two starts at once', () => {
  it('hands out distinct run ids', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'busy')
    const cocoa = engine(dir)
    cocoa.register(job)

    const [first, second] = await Promise.all([
      cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human'),
      cocoa.start_job(job, { size: '2' }, { gpu: '1' }, 'human')
    ])
    await settle(cocoa)

    expect(first).not.toBe(second)
    expect(cocoa.job(job).runs.record(first).submission_id).toBe(`sub-${first}`)
    expect(cocoa.job(job).runs.record(second).submission_id).toBe(`sub-${second}`)
  })
})
