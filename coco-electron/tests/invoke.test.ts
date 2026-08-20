// The `COCO_RETURN:` contract and the invocation shape. The first two cases
// are ported from engine/invoke.rs's inline tests; the rest cover the async
// spawn/harvest seam this port introduces.

import { describe, expect, it } from 'vitest'
import {
  cocoReturnLines,
  invocationOk,
  invocationOutput,
  run,
  spawn
} from '../src/main/engine/invoke'
import { cleanupTempDirs, tempDir, writeScript } from './support'
import { afterEach } from 'vitest'

afterEach(cleanupTempDirs)

describe('cocoReturnLines', () => {
  it('extracts contract lines only', () => {
    expect(
      cocoReturnLines('submitting...\nCOCO_RETURN: 5001\nlog line\nCOCO_RETURN:  5002 extra\n')
    ).toEqual(['5001', '5002 extra'])
  })

  it('ignores the prefix without its space', () => {
    expect(cocoReturnLines('COCO_RETURN:5001\n')).toEqual([])
  })
})

describe('invocation', () => {
  it('is ok only when the script exited 0 in time', () => {
    expect(invocationOk({ exit: 0, timedOut: false, stdout: '', stderr: '' })).toBe(true)
    expect(invocationOk({ exit: 1, timedOut: false, stdout: '', stderr: '' })).toBe(false)
    expect(invocationOk({ exit: 0, timedOut: true, stdout: '', stderr: '' })).toBe(false)
    expect(invocationOk({ exit: null, timedOut: false, stdout: '', stderr: '' })).toBe(false)
  })

  it('joins the two streams for the error text', () => {
    expect(invocationOutput({ exit: 1, timedOut: false, stdout: 'out\n', stderr: 'err\n' })).toBe(
      'out\nerr'
    )
    expect(invocationOutput({ exit: 1, timedOut: false, stdout: '', stderr: 'err\n' })).toBe('err')
    expect(invocationOutput({ exit: 1, timedOut: false, stdout: 'out\n', stderr: '' })).toBe('out')
    expect(invocationOutput({ exit: 0, timedOut: false, stdout: '', stderr: '' })).toBe('')
  })

  it('runs a script in the folder and captures both streams', async () => {
    const dir = tempDir()
    writeScript(dir, 'say.sh', 'echo out\necho err >&2\nexit 0\n')
    const invocation = await run(dir, ['./say.sh'], 5_000)
    expect(invocationOk(invocation)).toBe(true)
    expect(invocation.stdout.trim()).toBe('out')
    expect(invocation.stderr.trim()).toBe('err')
  })

  it('kills a script that outstays the timeout', async () => {
    const dir = tempDir()
    writeScript(dir, 'slow.sh', 'sleep 30\n')
    const invocation = await run(dir, ['./slow.sh'], 100)
    expect(invocation.timedOut).toBe(true)
    expect(invocation.exit).toBeNull()
    expect(invocationOk(invocation)).toBe(false)
  })

  // The harvest seam: a spawned script is collected without waiting, which is
  // how the refresh tick picks launches up one by one.
  it('answers tryFinish without waiting, then with the result', async () => {
    const dir = tempDir()
    writeScript(dir, 'quick.sh', "echo 'COCO_RETURN: sub-1'\n")
    const running = await spawn(dir, ['./quick.sh'], 5_000)
    expect(running.tryFinish()).toBeNull()
    const invocation = await running.wait()
    expect(running.tryFinish()).toEqual(invocation)
    expect(cocoReturnLines(invocation.stdout)).toEqual(['sub-1'])
  })

  it('refuses to spawn a script that is not there', async () => {
    const dir = tempDir()
    await expect(spawn(dir, ['./absent.sh'], 5_000)).rejects.toThrow()
  })
})
