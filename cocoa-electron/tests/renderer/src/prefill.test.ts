import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefill_start, start_again, take_prefill } from '../../../src/renderer/src/prefill.svelte'
import { app } from '../../../src/renderer/src/state.svelte'
import { entity, reset, send } from '../support/app'

afterEach(reset)

describe('a run started again', () => {
  const start_run = vi.fn<(name: string, params: Record<string, string>) => Promise<unknown>>()

  beforeEach(() => {
    start_run.mockReset()
    vi.stubGlobal('window', { cocoa: { start_run } })
    send({
      kind: 'entity-upserted',
      entity: {
        ...entity('solver'),
        parameters: [
          { name: 'nodes', type: 'string', values: null, list: false, description: 'the nodes' },
          { name: 'gpu', type: 'string', values: null, list: false, description: 'the gpu' }
        ]
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with exactly the parameters it had, and says which run that made', async () => {
    start_run.mockResolvedValue({ ok: true, run_id: '7' })
    await start_again('solver', { nodes: '4', gpu: '1' })
    expect(start_run).toHaveBeenCalledWith('solver', { nodes: '4', gpu: '1' })
    expect(app.notice?.text).toBe('Run 7 started.')
    expect(app.overlay).toBeNull()
  })

  it('puts a refusal in a modal, since it has to be read', async () => {
    start_run.mockResolvedValue({ ok: false, message: 'render parameters must match the manifest' })
    await start_again('solver', { nodes: '4' })
    expect(app.overlay).toEqual({
      kind: 'refused',
      title: 'Could not start',
      message: 'render parameters must match the manifest'
    })
  })

  it('fills the Start page with what the manifest still takes, and says the rest', () => {
    prefill_start('solver', '3', { nodes: '4', gpu: '1' })
    expect(app.route).toEqual({ page: 'start', entity_id: 'solver' })
    expect(take_prefill('solver')?.values).toEqual({ nodes: '4', gpu: '1' })
    expect(take_prefill('solver')).toBeNull()
    expect(app.notice?.text).toBe('Parameters of run 3 filled in.')

    prefill_start('solver', '3', { nodes: '4', size: '256' })
    expect(take_prefill('solver')?.values).toEqual({ nodes: '4' })
    expect(app.notice).toMatchObject({ level: 'error' })
    expect(app.notice?.text).toBe(
      'Filled what run 3 had; `gpu` is new and left empty; `size` is no longer taken.'
    )

    // A value that no longer fits its shape — here a string where the run had
    // a list — is dropped too, and said.
    prefill_start('solver', '3', { nodes: ['4', '8'], gpu: '1' })
    expect(take_prefill('solver')?.values).toEqual({ gpu: '1' })
    expect(app.notice?.text).toBe(
      'Filled what run 3 had; `nodes` no longer fits and is left empty.'
    )
  })

  it('hands a prefill only to the page it was meant for', () => {
    prefill_start('solver', '3', { nodes: '4', gpu: '1' })
    expect(take_prefill('elsewhere')).toBeNull()
    expect(take_prefill('solver')?.values).toEqual({ nodes: '4', gpu: '1' })
  })

  // A campaign call run again (§18.3): the run takes the call's place.
  it('carries the campaign call a run replaces, to the start and to the page', async () => {
    const replaces = { campaign_id: 'nightly', campaign_run_id: '2', run_id: '3' }
    start_run.mockResolvedValue({ ok: true, run_id: '9' })
    await start_again('solver', { nodes: '4', gpu: '1' }, replaces)
    expect(start_run).toHaveBeenCalledWith('solver', { nodes: '4', gpu: '1' }, replaces)
    expect(app.notice?.text).toBe('Run 9 started in place of run 3.')

    prefill_start('solver', '3', { nodes: '4', gpu: '1' }, replaces)
    expect(take_prefill('solver')).toEqual({
      entity_id: 'solver',
      values: { nodes: '4', gpu: '1' },
      replaces
    })
  })
})
