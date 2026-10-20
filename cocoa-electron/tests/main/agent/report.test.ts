import { describe, expect, it } from 'vitest'
import type { RerunReportTarget } from '@shared/protocol'
import { FOLDER, ask } from '../../support/agent'

// A report re-run answers once the report is due, not done (§43.4): a script
// may run for the ten-minute report timeout.
describe('re-running a report', () => {
  it('accepts with 202, where the report will land, and where to follow it', async () => {
    let asked: RerunReportTarget | null = null
    const { status, json } = await ask(
      'POST',
      '/experiments/solver-gpu/runs/1/report',
      '',
      undefined,
      (target) => {
        asked = target
        return { ok: true }
      }
    )
    expect(status).toBe(202)
    expect(json).toEqual({
      run_id: '1',
      report_running: true,
      location: { report: `${FOLDER}/report/1.txt` },
      follow: '/jobs/solver-gpu'
    })
    expect(asked).toEqual({ job_id: FOLDER, run_id: '1' })
  })

  it('is a 404 for an unknown experiment or run', async () => {
    const ghost = await ask('POST', '/experiments/ghost/runs/0/report')
    expect(ghost.status).toBe(404)
    expect(ghost.json.error).toBe('No such entity: ghost')
    const missing = await ask('POST', '/experiments/solver-gpu/runs/41/report')
    expect(missing.status).toBe(404)
    expect(missing.json.error).toBe('No such run: solver-gpu run 41')
  })

  it("refuses a campaign, and passes the workbench's refusal through as a 400", async () => {
    const campaign = await ask('POST', '/experiments/nightly/runs/2/report')
    expect(campaign.status).toBe(400)
    expect(campaign.json.error).toContain('is a campaign')

    const refused = await ask(
      'POST',
      '/experiments/solver-gpu/runs/0/report',
      '',
      undefined,
      () => ({ ok: false, message: 'run 0 (RUNNING) cannot be reported' })
    )
    expect(refused.status).toBe(400)
    expect(refused.json.error).toBe('run 0 (RUNNING) cannot be reported')
  })

  it('answers only POST', async () => {
    expect((await ask('GET', '/experiments/solver-gpu/runs/1/report')).status).toBe(405)
  })

  it('names the route in its help', async () => {
    const { json } = await ask('GET', '/help')
    const paths = (json as unknown as { endpoints: { path: string }[] }).endpoints.map(
      (e) => e.path
    )
    expect(paths).toContain('/experiments/{name}/runs/{run_id}/report')
  })
})
