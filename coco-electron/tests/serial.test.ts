// One turn at a time on the engine. The unit is small; the bug it prevents
// is not — a poll finishing after a cancel used to write the pre-cancel
// status back over CANCELLING.

import { afterEach, describe, expect, it } from 'vitest'
import { serialize } from '../src/main/serial'
import {
  cleanup_temp_dirs,
  engine,
  job_folder,
  settle,
  temp_dir,
  write,
  write_script
} from './support'
import { cancel } from '../src/main/operations'

afterEach(cleanup_temp_dirs)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('serialize', () => {
  it('never lets two turns overlap', async () => {
    const on_engine = serialize()
    const log: string[] = []
    const gate = deferred<void>()

    const first = on_engine(async () => {
      log.push('first in')
      await gate.promise
      log.push('first out')
    })
    const second = on_engine(async () => {
      log.push('second in')
    })

    // The second turn has not started while the first is still awaiting.
    await Promise.resolve()
    expect(log).toEqual(['first in'])

    gate.resolve()
    await Promise.all([first, second])
    expect(log).toEqual(['first in', 'first out', 'second in'])
  })

  it('keeps the order it was asked in', async () => {
    const on_engine = serialize()
    const done: number[] = []
    await Promise.all(
      [30, 20, 10, 0].map((delay, index) =>
        on_engine(async () => {
          await new Promise((resolve) => setTimeout(resolve, delay))
          done.push(index)
        })
      )
    )
    expect(done).toEqual([0, 1, 2, 3])
  })

  it('carries a failure to its own caller and keeps the queue running', async () => {
    const on_engine = serialize()
    const failing = on_engine(async () => {
      throw new Error('script exploded')
    })
    const after = on_engine(async () => 'still here')

    await expect(failing).rejects.toThrow('script exploded')
    expect(await after).toBe('still here')
  })
})

// The regression this exists for, end to end over the real engine.
//
// A poll is a process and takes its time — the bundled mock's is `python3`,
// tens of milliseconds of interpreter start before it says anything. A cancel
// asked meanwhile finishes first, and the poll's answer, formed before the
// cancellation existed, used to land on top of it: the run read `RUNNING`
// again and the user's cancel had visibly done nothing.
describe('a cancel during a refresh', () => {
  it('survives the poll that was already in flight', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'racy')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.poll_job(job)
    // A poll that takes as long as a real one does.
    write_script(job, 'poll.sh', `sleep 0.5\necho "COCO_RETURN: sub-${run_id} RUNNING"\n`)

    const on_engine = serialize()
    const [, result] = await Promise.all([
      on_engine(() => coco.refresh()),
      on_engine(() => cancel(coco, { kind: 'job_run', job_id: job, run_id: String(run_id) }))
    ])

    expect(result).toEqual({ ok: true })
    expect(coco.run_record(job, run_id).status).toBe('CANCELLING')
  })
})
