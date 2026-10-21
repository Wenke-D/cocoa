import { describe, expect, it } from 'vitest'
import { CAMPAIGN_FOLDER, FOLDER, ask } from '../../support/agent'

describe('reads', () => {
  it('lists jobs with their tallies', async () => {
    const { json } = await ask('GET', '/jobs')
    expect(json).toEqual([
      {
        name: 'solver-gpu',
        folder: FOLDER,
        manifest: 'Valid',
        parameters: [
          { name: 'nodes', type: 'string', values: null, list: false, description: 'the nodes' },
          { name: 'gpu', type: 'string', values: null, list: false, description: 'the gpu' }
        ],
        runs: 2,
        active: 1
      }
    ])
  })

  it('lists campaigns separately', async () => {
    const { json } = await ask('GET', '/campaigns')
    expect(json).toHaveLength(1)
    expect(json[0]).toMatchObject({ name: 'nightly', runs: 1, active: 1 })
  })

  // Every caller is on this machine, so a detail answers with locations.
  it('gives a job its runs and where to read them', async () => {
    const { json } = await ask('GET', '/jobs/solver-gpu')
    const detail = json as unknown as {
      kind: string
      runs: { id: string; location: { run_dir: string; record: string; report: string | null } }[]
    }
    expect(detail.kind).toBe('job')
    expect(detail.runs.map((run) => run.id)).toEqual(['0', '1'])
    expect(detail.runs[0].location).toEqual({
      run_dir: `${FOLDER}/runs/0`,
      record: `${FOLDER}/runs/0/run.json`,
      report: null,
      attachments: null
    })
    expect(detail.runs[1].location.report).toBe(`${FOLDER}/report/1.txt`)
    // What a report re-run is followed by (§43.4).
    expect(detail.runs[1]).toMatchObject({ report_running: false, report_error: null })
  })

  it('gives a campaign its calls and its members file', async () => {
    const { json } = await ask('GET', '/campaigns/nightly')
    const detail = json as unknown as {
      runs: {
        calls: { call: number; job: string; run_id: string }[]
        location: { members: string }
      }[]
    }
    expect(detail.runs[0].calls).toEqual([
      { call: 0, job: 'solver-gpu', parameters: '--nodes 4', run_id: '0' }
    ])
    expect(detail.runs[0].location.members).toBe(`${CAMPAIGN_FOLDER}/runs/2/members.json`)
  })

  // A name that exists as the other kind deserves a pointer, not a flat no.
  it('points at the other kind rather than refusing flatly', async () => {
    const { status, json } = await ask('GET', '/jobs/nightly')
    expect(status).toBe(404)
    expect(json.error).toBe('nightly is not a job; ask /campaigns/nightly')
  })

  it('says plainly when there is no such thing', async () => {
    const { status, json } = await ask('GET', '/jobs/ghost')
    expect(status).toBe(404)
    expect(json.error).toBe('No such job: ghost')
  })
})
