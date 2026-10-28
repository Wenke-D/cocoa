import { describe, expect, it } from 'vitest'
import type { LockReportTarget } from '@shared/protocol'
import { CAMPAIGN_FOLDER, FOLDER, ask } from '../../support/agent'

/** One lock request, with the workbench's answer `answer` and what it was asked. */
async function lock(url: string, body: string, answer = { ok: true as const }) {
  let asked: LockReportTarget | null = null
  const reply = await ask(
    'POST',
    url,
    body,
    undefined,
    undefined,
    undefined,
    undefined,
    (target) => {
      asked = target
      return answer
    }
  )
  return { ...reply, asked: asked as LockReportTarget | null }
}

// A lock is the report row's button over the socket (convention §7.3.3).
describe('locking a report', () => {
  it('locks and unlocks a job run’s report, answering the state it is now in', async () => {
    const locked = await lock('/experiments/solver-gpu/runs/1/report/lock', '{"locked": true}')
    expect(locked.status).toBe(200)
    expect(locked.json).toEqual({ run_id: '1', report_locked: true })
    expect(locked.asked).toEqual({ entity_id: FOLDER, run_id: '1', locked: true })

    const unlocked = await lock('/experiments/solver-gpu/runs/1/report/lock', '{"locked": false}')
    expect(unlocked.json).toEqual({ run_id: '1', report_locked: false })
    expect(unlocked.asked).toEqual({ entity_id: FOLDER, run_id: '1', locked: false })
  })

  it('locks a campaign run’s report', async () => {
    const { status, asked } = await lock(
      '/experiments/nightly/runs/2/report/lock',
      '{"locked": true}'
    )
    expect(status).toBe(200)
    expect(asked).toEqual({ entity_id: CAMPAIGN_FOLDER, run_id: '2', locked: true })
  })

  it('needs {"locked": true|false}, and asks nothing without it', async () => {
    for (const body of ['', '{}', '{"locked": "yes"}', 'not json']) {
      const { status, asked } = await lock('/experiments/solver-gpu/runs/1/report/lock', body)
      expect(status).toBe(400)
      expect(asked).toBeNull()
    }
  })

  it("is a 404 for an unknown experiment or run, and passes the workbench's refusal through", async () => {
    const ghost = await lock('/experiments/ghost/runs/0/report/lock', '{"locked": true}')
    expect(ghost.status).toBe(404)
    const missing = await lock('/experiments/solver-gpu/runs/41/report/lock', '{"locked": true}')
    expect(missing.status).toBe(404)
    expect(missing.json.error).toBe('No such run: solver-gpu run 41')

    const refused = await ask(
      'POST',
      '/experiments/solver-gpu/runs/0/report/lock',
      '{"locked": true}',
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({ ok: false, message: 'run 0 has no report to lock' })
    )
    expect(refused.status).toBe(400)
    expect(refused.json.error).toBe('run 0 has no report to lock')
  })

  it('answers only POST, and is named in the help', async () => {
    expect((await ask('GET', '/experiments/solver-gpu/runs/1/report/lock')).status).toBe(405)
    const { json } = await ask('GET', '/help')
    const paths = (json as unknown as { endpoints: { path: string }[] }).endpoints.map(
      (e) => e.path
    )
    expect(paths).toContain('/experiments/{name}/runs/{run_id}/report/lock')
  })
})
