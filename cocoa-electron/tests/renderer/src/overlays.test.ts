import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navigate } from '../../../src/renderer/src/navigation'
import { request_delete, confirm_delete } from '../../../src/renderer/src/overlays.svelte'
import { app } from '../../../src/renderer/src/state.svelte'
import { entity, job_run, reset, send } from '../support/app'

afterEach(reset)

// The history's row menu (§22.6): a run's parameters, used again — at once,
// or as a draft on the Start page.
describe('deleting a run', () => {
  const delete_run = vi.fn<(target: unknown) => Promise<unknown>>()

  beforeEach(() => {
    delete_run.mockReset()
    vi.stubGlobal('window', { cocoa: { delete_run } })
    send({ kind: 'entity-upserted', entity: entity('solver') })
    send({ kind: 'job-run-upserted', run: job_run('3', 'solver') })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks first, deletes on confirm, and steps back from the deleted page', async () => {
    navigate({ page: 'job_run', job_id: 'solver', run_id: '3' })
    request_delete({ kind: 'job_run', job_id: 'solver', run_id: '3' })
    expect(app.overlay).toMatchObject({ kind: 'confirm_delete', busy: false })

    delete_run.mockResolvedValue({ ok: true })
    await confirm_delete()
    expect(delete_run).toHaveBeenCalledWith({ kind: 'job_run', job_id: 'solver', run_id: '3' })
    expect(app.overlay).toBeNull()
    expect(app.route).toEqual({ page: 'entity', entity_id: 'solver' })
    expect(app.notice?.text).toBe('Run 3 deleted.')
  })

  it('keeps the modal open with the reason when the engine refuses', async () => {
    navigate({ page: 'entity', entity_id: 'solver' })
    request_delete({ kind: 'job_run', job_id: 'solver', run_id: '3' })
    delete_run.mockResolvedValue({ ok: false, message: 'run 3 (RUNNING) is not finished' })
    await confirm_delete()
    expect(app.overlay).toMatchObject({
      kind: 'confirm_delete',
      busy: false,
      error: 'run 3 (RUNNING) is not finished'
    })
    // A page not looking at the run stays put on success, too.
    delete_run.mockResolvedValue({ ok: true })
    await confirm_delete()
    expect(app.route).toEqual({ page: 'entity', entity_id: 'solver' })
  })
})
