import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { write, write_script } from '../../../support/files'
import { job_folder } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('cancel', () => {
  it('keeps the status when cancel fails and moves to CANCELLING when it works', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'cancel-me')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)

    write_script(job, 'cancel.sh', "echo 'already gone' >&2\nexit 9\n")
    expect(await failure(cocoa.cancel_run(job, run_id))).toContain('already gone')
    expect(cocoa.job(job).runs.record(run_id).status).toBe('RUNNING')

    write_script(job, 'cancel.sh', 'exit 0\n')
    await cocoa.cancel_run(job, run_id)
    expect(cocoa.job(job).runs.record(run_id).status).toBe('CANCELLING')
  })
})
