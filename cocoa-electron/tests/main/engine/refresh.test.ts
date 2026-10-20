import { afterEach, describe, expect, it } from 'vitest'
import { engine } from '../../support/engine'
import { write_script } from '../../support/files'
import { job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('refresh', () => {
  // A record still "launching" in a cocoa that holds no script for it is a
  // previous cocoa's leftover (§10): the stdout that carried its submission id
  // died with that process, so refresh moves it to ERROR rather than leaving
  // a run that can never advance.
  it('sweeps a launch orphaned by a crash to ERROR on refresh', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'interrupted')
    // A slow script stands in for a cocoa that died mid-launch: a second
    // engine opens the same store while the first still holds the script.
    write_script(job, 'launch.sh', "sleep 5\necho 'COCOA_RETURN: late'\n")
    const crashed = engine(dir)
    crashed.register(job)
    const run_id = await crashed.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    const reopened = engine(dir)
    await reopened.refresh()
    const record = reopened.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('closed')

    crashed.abandon_launches()
  })
})
