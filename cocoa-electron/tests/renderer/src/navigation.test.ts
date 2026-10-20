import { afterEach, describe, expect, it } from 'vitest'
import { go_to, select_view } from '../../../src/renderer/src/navigation'
import { app } from '../../../src/renderer/src/state.svelte'
import { entity, reset, send } from '../support/app'

afterEach(reset)

// The views the activity bar switches between, and the journal's links
// (§8.2, §11.1).
describe('the views', () => {
  it('opens a view from the activity bar, and collapses the sidebar on the open one', () => {
    select_view('events')
    expect([app.sidebar_view, app.sidebar_open]).toEqual(['events', true])
    select_view('events')
    expect([app.sidebar_view, app.sidebar_open]).toEqual(['events', false])
    select_view('runs')
    expect([app.sidebar_view, app.sidebar_open]).toEqual(['runs', true])
  })

  it('takes the page to what an entry is about, and says so when it is gone', () => {
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({
      kind: 'job-run-upserted',
      run: {
        id: '0',
        job_id: 'solver',
        origin: 'Human',
        started_at: '2026-08-22T22:00:00.000+02:00',
        ended_at: null,
        parameters: '',
        params: {},
        status: 'Running',
        query_health: 'Healthy',
        last_successful_query: '2026-08-22T22:00:03.000+02:00',
        report: 'Missing',
        report_error: null,
        report_rerunnable: false,
        deploy: null,
        error: null
      }
    })
    go_to({ kind: 'job_run', job_id: 'solver', run_id: '0' })
    expect(app.route).toEqual({ page: 'job_run', job_id: 'solver', run_id: '0' })

    go_to({ kind: 'job_run', job_id: 'solver', run_id: '9' })
    expect(app.route).toEqual({ page: 'job_run', job_id: 'solver', run_id: '0' })
    expect(app.notice?.text).toContain('no longer listed')
  })
})
