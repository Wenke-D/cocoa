import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { empty, some } from '@shared/maybe'
import type { AgentServer } from '../../../src/main/agent/serve'
import { serve, socket_path } from '../../../src/main/agent/serve'
import { deps, request, world } from '../../support/agent'

describe('paths', () => {
  it('puts the socket where cocoa_mcp_server looks for it', () => {
    const previous = process.env['COCOA_SOCKET_PATH']
    delete process.env['COCOA_SOCKET_PATH']
    expect(socket_path(empty())).toBe(
      path.join(process.env['HOME'] ?? '', '.local/share/cocoa/cocoa.sock')
    )
    process.env['COCOA_SOCKET_PATH'] = '/tmp/elsewhere.sock'
    expect(socket_path(some('dev'))).toBe('/tmp/elsewhere.sock')
    if (previous === undefined) {
      delete process.env['COCOA_SOCKET_PATH']
    } else {
      process.env['COCOA_SOCKET_PATH'] = previous
    }
  })

  // The socket follows the profile as the single-instance lock does: a
  // second profile running beside the default one answers on its own.
  it('gives a named profile a socket of its own', () => {
    const previous = process.env['COCOA_SOCKET_PATH']
    delete process.env['COCOA_SOCKET_PATH']
    expect(socket_path(some('dev'))).toBe(
      path.join(process.env['HOME'] ?? '', '.local/share/cocoa/cocoa-dev.sock')
    )
    if (previous === undefined) {
      delete process.env['COCOA_SOCKET_PATH']
    } else {
      process.env['COCOA_SOCKET_PATH'] = previous
    }
  })
})

// The routes above are a function; this is the socket a `curl --unix-socket`
// or `cocoa_mcp_server` actually reaches.
describe('the socket', () => {
  const open: AgentServer[] = []
  const dirs: string[] = []

  afterEach(async () => {
    for (const server of open.splice(0)) {
      await server.close()
    }
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  function socket_file(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cocoa-sock-')))
    dirs.push(dir)
    return path.join(dir, 'cocoa.sock')
  }

  it('answers HTTP over a unix socket', async () => {
    const file = socket_file()
    open.push(await serve(file, deps()))

    const answer = await request(file, 'GET', '/jobs')
    expect(answer.status).toBe(200)
    expect(answer.type).toBe('application/json; charset=utf-8')
    const jobs = JSON.parse(answer.text) as { name: string }[]
    expect(jobs[0].name).toBe('solver-gpu')
  })

  it('starts a run over the wire', async () => {
    const file = socket_file()
    let started = false
    open.push(
      await serve(file, {
        current_world: world,
        start: async () => {
          started = true
          return { ok: true, run_id: '9' }
        },
        rerun_report: () => ({ ok: true }),
        register: () => ({ ok: false, cancelled: false, message: 'unused' }),
        cancel: async () => ({ ok: false, message: 'unused' })
      })
    )

    const answer = await request(
      file,
      'POST',
      '/experiments/solver-gpu/runs',
      JSON.stringify({ parameters: { nodes: '4' } })
    )
    expect(answer.status).toBe(201)
    expect(JSON.parse(answer.text)).toEqual({ run_id: '9' })
    expect(started).toBe(true)
  })

  it('refuses a body far too large to be a start', async () => {
    const file = socket_file()
    open.push(await serve(file, deps()))

    const answer = await request(
      file,
      'POST',
      '/experiments/solver-gpu/runs',
      JSON.stringify({ parameters: { nodes: 'x'.repeat(70_000) } })
    )
    expect(answer.status).toBe(413)
  })

  // A file already at the path is deleted without a probe: nothing alive can
  // own it — one cocoa per build (the single-instance lock), one path per
  // build (`socket_path`). So the last bind wins, even over a listener.
  it('takes the path over from whatever held it', async () => {
    const file = socket_file()
    open.push(await serve(file, deps()))

    let second_answered = false
    open.push(
      await serve(file, {
        current_world: () => {
          second_answered = true
          return world()
        },
        start: async () => ({ ok: true, run_id: '7' }),
        rerun_report: () => ({ ok: true }),
        register: () => ({ ok: false, cancelled: false, message: 'unused' }),
        cancel: async () => ({ ok: false, message: 'unused' })
      })
    )

    expect((await request(file, 'GET', '/jobs')).status).toBe(200)
    expect(second_answered).toBe(true)
  })

  // A crash leaves the file behind with nothing listening; a Unix socket
  // cannot listen where a file sits, so the leftover must go.
  it('replaces a socket file nothing is listening on', async () => {
    const file = socket_file()
    fs.writeFileSync(file, '')
    open.push(await serve(file, deps()))
    expect((await request(file, 'GET', '/help')).status).toBe(200)
  })

  it('removes the socket file when it stops', async () => {
    const file = socket_file()
    const server = await serve(file, deps())
    expect(fs.existsSync(file)).toBe(true)
    await server.close()
    expect(fs.existsSync(file)).toBe(false)
  })
})
