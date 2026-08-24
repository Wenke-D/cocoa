// The `COCOA_RETURN:` contract and the invocation shape, including the async
// spawn/harvest seam.

import { describe, expect, it } from 'vitest'
import {
  cocoa_return_lines,
  invocation_ok,
  invocation_output,
  run,
  spawn
} from '../src/main/engine/invoke'
import { cleanup_temp_dirs, temp_dir, write_script } from './support'
import { afterEach } from 'vitest'

afterEach(cleanup_temp_dirs)

describe('cocoa_return_lines', () => {
  it('extracts contract lines only', () => {
    expect(
      cocoa_return_lines('submitting...\nCOCOA_RETURN: 5001\nlog line\nCOCOA_RETURN:  5002 extra\n')
    ).toEqual(['5001', '5002 extra'])
  })

  it('ignores the prefix without its space', () => {
    expect(cocoa_return_lines('COCOA_RETURN:5001\n')).toEqual([])
  })
})

describe('invocation', () => {
  it('is ok only when the script exited 0 in time', () => {
    expect(invocation_ok({ exit: 0, timed_out: false, stdout: '', stderr: '' })).toBe(true)
    expect(invocation_ok({ exit: 1, timed_out: false, stdout: '', stderr: '' })).toBe(false)
    expect(invocation_ok({ exit: 0, timed_out: true, stdout: '', stderr: '' })).toBe(false)
    expect(invocation_ok({ exit: null, timed_out: false, stdout: '', stderr: '' })).toBe(false)
  })

  it('joins the two streams for the error text', () => {
    expect(invocation_output({ exit: 1, timed_out: false, stdout: 'out\n', stderr: 'err\n' })).toBe(
      'out\nerr'
    )
    expect(invocation_output({ exit: 1, timed_out: false, stdout: '', stderr: 'err\n' })).toBe(
      'err'
    )
    expect(invocation_output({ exit: 1, timed_out: false, stdout: 'out\n', stderr: '' })).toBe(
      'out'
    )
    expect(invocation_output({ exit: 0, timed_out: false, stdout: '', stderr: '' })).toBe('')
  })

  it('runs a script in the folder and captures both streams', async () => {
    const dir = temp_dir()
    write_script(dir, 'say.sh', 'echo out\necho err >&2\nexit 0\n')
    const invocation = await run(dir, ['./say.sh'], 5_000)
    expect(invocation_ok(invocation)).toBe(true)
    expect(invocation.stdout.trim()).toBe('out')
    expect(invocation.stderr.trim()).toBe('err')
  })

  it('kills a script that outstays the timeout', async () => {
    const dir = temp_dir()
    write_script(dir, 'slow.sh', 'sleep 30\n')
    const invocation = await run(dir, ['./slow.sh'], 100)
    expect(invocation.timed_out).toBe(true)
    expect(invocation.exit).toBeNull()
    expect(invocation_ok(invocation)).toBe(false)
  })

  // The harvest seam: a spawned script is collected without waiting, which is
  // how the refresh tick picks launches up one by one.
  it('answers try_finish without waiting, then with the result', async () => {
    const dir = temp_dir()
    write_script(dir, 'quick.sh', "echo 'COCOA_RETURN: sub-1'\n")
    const running = await spawn(dir, ['./quick.sh'], 5_000)
    expect(running.try_finish()).toBeNull()
    const invocation = await running.wait()
    expect(running.try_finish()).toEqual(invocation)
    expect(cocoa_return_lines(invocation.stdout)).toEqual(['sub-1'])
  })

  it('refuses to spawn a script that is not there', async () => {
    const dir = temp_dir()
    await expect(spawn(dir, ['./absent.sh'], 5_000)).rejects.toThrow()
  })
})
