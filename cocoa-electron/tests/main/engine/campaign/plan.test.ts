import { afterEach, describe, expect, it } from 'vitest'
import { engine } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { campaign_folder, job_folder, plan_lines } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('campaigns', () => {
  // A plan is generated, so its mistakes arrive in batches. Every call is
  // checked and every bad one is named, rather than the user fixing one,
  // starting again, and meeting the next (§8.1).
  it('names every bad plan call at once', async () => {
    const dir = temp_dir()
    const good = job_folder(dir, 'good-job')
    const campaign = campaign_folder(dir, 'sweep', ['good-job'])
    plan_lines(campaign, [
      '{"job": "ghost", "params": {}}',
      '{"job": "good-job", "params": {"size": "1", "gpu": "0"}}',
      '{"job": "phantom", "params": {}}',
      '{"job": "good-job", "params": {"size": "1"}}'
    ])
    const cocoa = engine(dir)
    cocoa.register(good)
    cocoa.register(campaign)

    const message = await failure(cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human'))

    // Three of the four calls are bad, and all three are named — including
    // the last, which an abort-on-first check would never have reached.
    expect(message).toContain('3 of 4')
    expect(message).toContain('call 1')
    expect(message).toContain('call 3')
    expect(message).toContain('call 4')
    expect(message).not.toContain('call 2')
    expect(cocoa.campaign(campaign).runs.all()).toEqual([])
  })
})
