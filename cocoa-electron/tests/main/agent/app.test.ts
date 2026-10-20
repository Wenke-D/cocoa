import { describe, expect, it } from 'vitest'
import { ask } from '../../support/agent'

describe('routes', () => {
  it('refuses an endpoint it does not have', async () => {
    expect((await ask('GET', '/nope')).status).toBe(404)
    expect((await ask('DELETE', '/jobs')).status).toBe(405)
  })

  // A percent-escaped name is the name — an experiment is a folder, and a
  // folder name may hold a space — and a query string is not part of the
  // route.
  it('decodes the name and ignores the query', async () => {
    const { status, json } = await ask('GET', '/jobs/my%20sweep?verbose=1')
    expect(status).toBe(404)
    expect(json.error).toBe('No such job: my sweep')
  })
})
