// One turn at a time on the engine. The unit is small; the bug it prevents
// is not — a poll finishing after a cancel used to write the pre-cancel
// status back over CANCELLING.

import { afterEach, describe, expect, it } from 'vitest'
import { serialize } from '../src/main/serial'
import { cleanupTempDirs, engine, jobFolder, settle, tempDir, write, writeScript } from './support'
import { cancel } from '../src/main/operations'

afterEach(cleanupTempDirs)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('serialize', () => {
  it('never lets two turns overlap', async () => {
    const onEngine = serialize()
    const log: string[] = []
    const gate = deferred<void>()

    const first = onEngine(async () => {
      log.push('first in')
      await gate.promise
      log.push('first out')
    })
    const second = onEngine(async () => {
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
    const onEngine = serialize()
    const done: number[] = []
    await Promise.all(
      [30, 20, 10, 0].map((delay, index) =>
        onEngine(async () => {
          await new Promise((resolve) => setTimeout(resolve, delay))
          done.push(index)
        })
      )
    )
    expect(done).toEqual([0, 1, 2, 3])
  })

  it('carries a failure to its own caller and keeps the queue running', async () => {
    const onEngine = serialize()
    const failing = onEngine(async () => {
      throw new Error('script exploded')
    })
    const after = onEngine(async () => 'still here')

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
    const dir = tempDir()
    const job = jobFolder(dir, 'racy')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.pollJob(job)
    // A poll that takes as long as a real one does.
    writeScript(job, 'poll.sh', `sleep 0.5\necho "COCO_RETURN: sub-${runId} RUNNING"\n`)

    const onEngine = serialize()
    const [, result] = await Promise.all([
      onEngine(() => coco.refresh()),
      onEngine(() => cancel(coco, { kind: 'jobRun', jobId: job, runId: String(runId) }))
    ])

    expect(result).toEqual({ ok: true })
    expect(coco.runRecord(job, runId).status).toBe('CANCELLING')
  })
})
