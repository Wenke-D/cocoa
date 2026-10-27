import { describe, expect, it } from 'vitest'
import type { CancelTarget } from '@shared/protocol'
import { CAMPAIGN_FOLDER, FOLDER, ask } from '../../support/agent'

/**
 * One cancel against a freshly served instance, and what the engine was asked.
 * The engine accepts, or refuses with `refusal` when one is given.
 */
async function cancel(url: string, refusal = '') {
  let asked: CancelTarget | null = null
  const reply = await ask('POST', url, '', undefined, undefined, undefined, async (target) => {
    asked = target
    return refusal === '' ? { ok: true } : { ok: false, message: refusal }
  })
  return { ...reply, asked }
}

// A cancel answers once the cancel script has accepted, not once the cluster
// confirms (§43.4): only a later poll can call the run cancelled.
describe('cancelling a run', () => {
  it("accepts a job run with 202 and where to follow it, aimed at the job's run", async () => {
    const { status, json, asked } = await cancel('/experiments/solver-gpu/runs/0/cancel')
    expect(status).toBe(202)
    expect(json).toEqual({ run_id: '0', follow: '/jobs/solver-gpu' })
    expect(asked).toEqual({ kind: 'job_run', job_id: FOLDER, run_id: '0' })
  })

  it('aims a campaign run at the campaign, which cancels its members', async () => {
    const { status, json, asked } = await cancel('/experiments/nightly/runs/2/cancel')
    expect(status).toBe(202)
    expect(json).toEqual({ run_id: '2', follow: '/campaigns/nightly' })
    expect(asked).toEqual({ kind: 'campaign_run', campaign_id: CAMPAIGN_FOLDER, run_id: '2' })
  })

  // Run ids are per experiment: the job's run 0 is not the campaign's.
  it('is a 404 for an unknown experiment or run, and asks nothing of the engine', async () => {
    const ghost = await cancel('/experiments/ghost/runs/0/cancel')
    expect(ghost.status).toBe(404)
    expect(ghost.json.error).toBe('No such entity: ghost')
    const missing = await cancel('/experiments/nightly/runs/0/cancel')
    expect(missing.status).toBe(404)
    expect(missing.json.error).toBe('No such run: nightly run 0')
    expect(missing.asked).toBeNull()
  })

  it("passes the workbench's refusal through as a 400", async () => {
    const refused = await cancel(
      '/experiments/solver-gpu/runs/1/cancel',
      'run 1 (SUCCEEDED) cannot be cancelled'
    )
    expect(refused.status).toBe(400)
    expect(refused.json.error).toBe('run 1 (SUCCEEDED) cannot be cancelled')
  })

  it('answers only POST', async () => {
    expect((await ask('GET', '/experiments/solver-gpu/runs/0/cancel')).status).toBe(405)
  })

  it('names the route in its help', async () => {
    const { json } = await ask('GET', '/help')
    const paths = (json as unknown as { endpoints: { path: string }[] }).endpoints.map(
      (e) => e.path
    )
    expect(paths).toContain('/experiments/{name}/runs/{run_id}/cancel')
  })
})
