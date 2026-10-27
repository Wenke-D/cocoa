import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { exists, write, write_script } from '../../../support/files'
import { campaign_folder, job_folder } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('cancelling a campaign run', () => {
  // The window hides Cancel on such a run; a caller with no button — the
  // agent socket — must hear the refusal, not an `ok` for nothing asked.
  it('refuses a run whose members have all finished, asking no member to stop', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'sweep', ['member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, start.members[0].run_id, 'auto')
    write_script(job, 'cancel.sh', 'touch cancel-ran\n')

    const status = cocoa.campaign_status(campaign, start.run_id).status
    expect(await failure(cocoa.cancel_campaign(campaign, start.run_id))).toBe(
      `campaign run ${start.run_id} (${status}) cannot be cancelled`
    )
    expect(exists(job, 'cancel-ran')).toBe(false)
  })
})
