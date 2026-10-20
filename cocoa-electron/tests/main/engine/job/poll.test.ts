import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { write_script } from '../../../support/files'
import { job_folder } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('polling', () => {
  it('sets UNREACHABLE and still fails loudly when poll breaks', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'quiet')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write_script(job, 'poll.sh', "echo 'squeue broke' >&2\nexit 3\n")
    expect(await failure(cocoa.poll_job(job))).toContain('squeue broke')

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('UNREACHABLE')
    expect(record.reason).toContain('poll script failed')

    // A bare UNREACHABLE line leaves the run where it is.
    write_script(job, 'poll.sh', "echo 'COCOA_RETURN: UNREACHABLE never mind'\n")
    await cocoa.poll_job(job)
    expect(cocoa.job(job).runs.record(run_id).status).toBe('UNREACHABLE')

    // The next good poll overwrites UNREACHABLE.
    write_script(job, 'poll.sh', "echo 'COCOA_RETURN: RUNNING'\n")
    const report = await cocoa.poll_job(job)
    expect(report.changed).toEqual([[run_id, 'RUNNING']])
    expect(cocoa.job(job).runs.record(run_id).status).toBe('RUNNING')
  })

  it('ignores an unknown poll status with a warning', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'weird')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    write_script(job, 'poll.sh', "echo 'COCOA_RETURN: HYPERDRIVE'\n")
    const report = await cocoa.poll_job(job)
    expect(report.changed).toEqual([])
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]).toContain('HYPERDRIVE')
    expect(cocoa.job(job).runs.record(run_id).status).toBe('STARTING')
  })
})
