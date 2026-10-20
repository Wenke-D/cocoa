import { describe, expect, it } from 'vitest'
import { ask } from '../../support/agent'

describe('help', () => {
  it('explains itself', async () => {
    const { status, json } = await ask('GET', '/help')
    expect(status).toBe(200)
    expect(json).toHaveProperty('endpoints')
    const paths = (json as unknown as { endpoints: { path: string }[] }).endpoints.map(
      (e) => e.path
    )
    expect(paths).toContain('/jobs')
    expect(paths).toContain('/experiments/{name}/runs')
  })
})
