import { describe, expect, it } from 'vitest'
import { CAMPAIGN_FOLDER, FOLDER, ask } from '../../support/agent'

// A folder registered over the socket takes the Explorer's `+` path (§43.4).
describe('registering a folder', () => {
  it('registers by absolute path and answers with the name, kind and where to follow', async () => {
    let asked: string | null = null
    const { status, json } = await ask(
      'POST',
      '/experiments',
      JSON.stringify({ path: FOLDER }),
      undefined,
      undefined,
      (folder) => {
        asked = folder
        return { ok: true, entity_id: FOLDER, already: false }
      }
    )
    expect(status).toBe(201)
    expect(json).toEqual({
      name: 'solver-gpu',
      kind: 'job',
      folder: FOLDER,
      already: false,
      follow: '/jobs/solver-gpu'
    })
    expect(asked).toBe(FOLDER)
  })

  it('names a campaign as one, and answers 200 for a folder already there', async () => {
    const { status, json } = await ask(
      'POST',
      '/experiments',
      JSON.stringify({ path: CAMPAIGN_FOLDER }),
      undefined,
      undefined,
      () => ({ ok: true, entity_id: CAMPAIGN_FOLDER, already: true })
    )
    expect(status).toBe(200)
    expect(json).toMatchObject({ kind: 'campaign', already: true, follow: '/campaigns/nightly' })
  })

  it('refuses a missing, relative or unparseable path before the workbench is asked', async () => {
    let asked = false
    const register = (): { ok: true; entity_id: string; already: boolean } => {
      asked = true
      return { ok: true, entity_id: FOLDER, already: false }
    }
    for (const body of ['', '{}', '{"path": 3}', '{"path": "jobs/solver"}', '{oops']) {
      const { status } = await ask('POST', '/experiments', body, undefined, undefined, register)
      expect(status).toBe(400)
    }
    expect(asked).toBe(false)
  })

  it("passes the workbench's refusal through as a 400", async () => {
    const { status, json } = await ask(
      'POST',
      '/experiments',
      JSON.stringify({ path: '/abs/elsewhere' }),
      undefined,
      undefined,
      () => ({
        ok: false,
        cancelled: false,
        message: 'an entity named `solver-gpu` is already registered'
      })
    )
    expect(status).toBe(400)
    expect(json.error).toBe('an entity named `solver-gpu` is already registered')
  })

  it('answers only POST, and names the route in its help', async () => {
    expect((await ask('GET', '/experiments')).status).toBe(405)
    const { json } = await ask('GET', '/help')
    const paths = (json as unknown as { endpoints: { path: string; method: string }[] }).endpoints
    expect(paths).toContainEqual(expect.objectContaining({ method: 'POST', path: '/experiments' }))
  })
})
