import { afterEach, describe, expect, it } from 'vitest'
import { engine } from '../../support/engine'
import { write_script } from '../../support/files'
import { job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('launches in flight', () => {
  // The close never waits, but an answer that already arrived is still
  // collected on the way out (§10): the submission id is recorded and the
  // next open catches up on the run like any other.
  it('collects an already-landed answer when cocoa closes', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'close-me')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    // The script gets a moment to exit before the close — the wait is the
    // test's, standing in for a user who saw the run land; the close itself
    // waits for nothing.
    await new Promise((resolve) => setTimeout(resolve, 500))
    cocoa.abandon_launches()

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('STARTING')
    expect(record.submission_id).toBe(`sub-${run_id}`)
  })

  // A script that has not answered by the close is killed and its run moved
  // to ERROR now, honestly — not waited on, not left for the reopen sweep
  // to guess about.
  it('abandons an unanswered launch at close as ERROR', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'hung')
    write_script(job, 'launch.sh', "sleep 30\necho 'COCOA_RETURN: late'\n")
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    cocoa.abandon_launches()

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('no longer be tracked')
  })
})
