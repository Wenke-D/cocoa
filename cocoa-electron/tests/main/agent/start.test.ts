import { describe, expect, it } from 'vitest'
import { ask } from '../../support/agent'

describe('starting a run', () => {
  it('starts by name and answers with the run id', async () => {
    let asked: [string, Record<string, unknown>] | null = null
    const { status, json } = await ask(
      'POST',
      '/experiments/solver-gpu/runs',
      JSON.stringify({ parameters: { nodes: '4', gpu: '1' } }),
      async (name, parameters) => {
        asked = [name, parameters]
        return { ok: true, run_id: '7' }
      }
    )
    expect(status).toBe(201)
    expect(json).toEqual({ run_id: '7' })
    expect(asked).toEqual(['solver-gpu', { nodes: '4', gpu: '1' }])
  })

  it('takes an empty body as no parameters', async () => {
    const { status } = await ask('POST', '/experiments/solver-gpu/runs')
    expect(status).toBe(201)
  })

  it('refuses a body that is not JSON', async () => {
    expect((await ask('POST', '/experiments/solver-gpu/runs', '{oops')).status).toBe(400)
  })

  // The name is answered for before the engine is troubled, so an unknown
  // experiment is a 404.
  it('is a 404 for an experiment that is not registered', async () => {
    const { status, json } = await ask('POST', '/experiments/ghost/runs')
    expect(status).toBe(404)
    expect(json.error).toBe('No such entity: ghost')
  })

  // The workbench's own refusal text, unchanged: an agent should see what a
  // person would have been shown.
  it("passes the workbench's refusal through as a 400", async () => {
    const { status, json } = await ask('POST', '/experiments/solver-gpu/runs', '', async () => ({
      ok: false,
      message: 'parameters must match the manifest exactly'
    }))
    expect(status).toBe(400)
    expect(json.error).toBe('parameters must match the manifest exactly')
  })
})
