// The agent interface (§43): the routes, and the socket they are served on.
//
// The routes are exercised directly — they are a function of a world and a
// start — and then once over a real Unix socket with a real HTTP client,
// because "it parses" and "curl can reach it" are different claims.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { World } from '@shared/world'
import { empty_world } from '@shared/world'
import type { AgentDeps, AgentServer } from '../src/main/agent'
import { route, segments, serve, socket_path } from '../src/main/agent'

const FOLDER = '/exp/solver-gpu'
const BENCH_FOLDER = '/exp/nightly'

function world(): World {
  const base = empty_world()
  base.entities = [
    {
      id: FOLDER,
      kind: 'Job',
      name: 'solver-gpu',
      path: FOLDER,
      manifest: 'Valid',
      parameter_names: ['nodes', 'gpu']
    },
    {
      id: BENCH_FOLDER,
      kind: 'Bench',
      name: 'nightly',
      path: BENCH_FOLDER,
      manifest: 'Valid',
      parameter_names: ['sweep']
    }
  ]
  base.job_runs = {
    [FOLDER]: {
      '0': {
        id: '0',
        job_id: FOLDER,
        origin: 'Human',
        started_at: '2026-08-20T10:00:00.000+02:00',
        ended_at: null,
        parameters: '--nodes 4',
        status: 'Running',
        query_health: 'Healthy',
        last_successful_query: '2026-08-20T10:00:03.000+02:00',
        report: 'Missing',
        error: null
      },
      '1': {
        id: '1',
        job_id: FOLDER,
        origin: 'Agent',
        started_at: '2026-08-20T11:00:00.000+02:00',
        ended_at: '2026-08-20T11:05:00.000+02:00',
        parameters: '--nodes 8',
        status: 'Succeeded',
        query_health: 'Healthy',
        last_successful_query: '2026-08-20T11:05:00.000+02:00',
        report: { Available: { format: 'PlainText', text_bytes: 120 } },
        error: null
      }
    }
  }
  base.bench_runs = {
    [BENCH_FOLDER]: {
      '2': {
        id: '2',
        bench_id: BENCH_FOLDER,
        by: 'Agent',
        started_at: '2026-08-20T12:00:00.000+02:00',
        ended_at: null,
        parameters: '--sweep full',
        plan: { steps: [{ index: 0, job_id: FOLDER, parameters: '--nodes 4', run_id: '0' }] },
        status: 'Running',
        query_health: 'Healthy',
        last_successful_query: '2026-08-20T12:00:03.000+02:00',
        report: 'Unavailable',
        error: null
      }
    }
  }
  base.runs_by_job = { [FOLDER]: ['0', '1'] }
  base.runs_by_bench = { [BENCH_FOLDER]: ['2'] }
  return base
}

function deps(start?: AgentDeps['start']): AgentDeps {
  return {
    world,
    start: start ?? (async () => ({ ok: true, run_id: '7' }))
  }
}

async function ask(method: string, url: string, body = '', start?: AgentDeps['start']) {
  const response = await route({ method, url, body }, deps(start))
  return { status: response.status, json: JSON.parse(response.body) as Record<string, never> }
}

describe('paths', () => {
  it('reads a target as its segments', () => {
    expect(segments('/experiments/solver-gpu/runs')).toEqual(['experiments', 'solver-gpu', 'runs'])
  })

  // A query string is not part of the route, and a percent-escaped name is
  // the name: an experiment is a folder, and a folder name may hold a space.
  it('drops the query and decodes the path', () => {
    expect(segments('/experiments/my%20sweep?verbose=1')).toEqual(['experiments', 'my sweep'])
  })

  it('puts the socket where the Rust coco puts it', () => {
    const previous = process.env['COCO_SOCKET_PATH']
    delete process.env['COCO_SOCKET_PATH']
    expect(socket_path()).toBe(path.join(process.env['HOME'] ?? '', '.local/share/coco/coco.sock'))
    process.env['COCO_SOCKET_PATH'] = '/tmp/elsewhere.sock'
    expect(socket_path()).toBe('/tmp/elsewhere.sock')
    if (previous === undefined) {
      delete process.env['COCO_SOCKET_PATH']
    } else {
      process.env['COCO_SOCKET_PATH'] = previous
    }
  })
})

describe('reads', () => {
  it('explains itself', async () => {
    const { status, json } = await ask('GET', '/help')
    expect(status).toBe(200)
    expect(json).toHaveProperty('endpoints')
    const paths = (json as unknown as { endpoints: { path: string }[] }).endpoints.map(
      (e) => e.path
    )
    expect(paths).toContain('/world')
    expect(paths).toContain('/experiments/{name}/runs')
  })

  it('serves the whole world', async () => {
    const { status, json } = await ask('GET', '/world')
    expect(status).toBe(200)
    expect(json).toEqual(JSON.parse(JSON.stringify(world())))
  })

  it('lists jobs with their tallies', async () => {
    const { json } = await ask('GET', '/jobs')
    expect(json).toEqual([
      {
        name: 'solver-gpu',
        folder: FOLDER,
        manifest: 'Valid',
        parameters: ['nodes', 'gpu'],
        runs: 2,
        active: 1
      }
    ])
  })

  it('lists benches separately', async () => {
    const { json } = await ask('GET', '/benches')
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
      report: null
    })
    expect(detail.runs[1].location.report).toBe(`${FOLDER}/report/1.txt`)
  })

  it('gives a bench its calls and its members file', async () => {
    const { json } = await ask('GET', '/benches/nightly')
    const detail = json as unknown as {
      runs: {
        calls: { call: number; job: string; run_id: string }[]
        location: { members: string }
      }[]
    }
    expect(detail.runs[0].calls).toEqual([
      { call: 0, job: 'solver-gpu', parameters: '--nodes 4', run_id: '0' }
    ])
    expect(detail.runs[0].location.members).toBe(`${BENCH_FOLDER}/runs/2/members.json`)
  })

  // A name that exists as the other kind deserves a pointer, not a flat no.
  it('points at the other kind rather than refusing flatly', async () => {
    const { status, json } = await ask('GET', '/jobs/nightly')
    expect(status).toBe(404)
    expect(json.error).toBe('nightly is not a job; ask /benches/nightly')
  })

  it('says plainly when there is no such thing', async () => {
    const { status, json } = await ask('GET', '/jobs/ghost')
    expect(status).toBe(404)
    expect(json.error).toBe('No such job: ghost')
  })

  it('refuses an endpoint it does not have', async () => {
    expect((await ask('GET', '/nope')).status).toBe(404)
    expect((await ask('DELETE', '/world')).status).toBe(405)
  })
})

describe('starting a run', () => {
  it('starts by name and answers with the run id', async () => {
    let asked: [string, Record<string, string>] | null = null
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

  // The name is answered for before the engine is troubled, so the refusal
  // reads the same as the Rust interface's — which is what decides the code.
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

// The routes above are a function; this is the socket a `curl --unix-socket`
// or the Rust `coco_mcp_server` actually reaches.
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
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-sock-')))
    dirs.push(dir)
    return path.join(dir, 'coco.sock')
  }

  function request(
    socket: string,
    method: string,
    route_path: string,
    body?: string
  ): Promise<{
    status: number
    type: string | undefined
    length: string | undefined
    encoding: string | undefined
    text: string
  }> {
    return new Promise((resolve, reject) => {
      const call = http.request(
        {
          socketPath: socket,
          path: route_path,
          method,
          headers: { 'Content-Type': 'application/json' }
        },
        (response) => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => (text += chunk))
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              type: response.headers['content-type'],
              length: response.headers['content-length'],
              encoding: response.headers['transfer-encoding'],
              text
            })
          )
        }
      )
      call.on('error', reject)
      if (body !== undefined) {
        call.write(body)
      }
      call.end()
    })
  }

  it('answers HTTP over a unix socket', async () => {
    const file = socket_file()
    open.push(await serve(file, deps()))

    const answer = await request(file, 'GET', '/jobs')
    expect(answer.status).toBe(200)
    expect(answer.type).toBe('application/json')
    const jobs = JSON.parse(answer.text) as { name: string }[]
    expect(jobs[0].name).toBe('solver-gpu')
  })

  it('starts a run over the wire', async () => {
    const file = socket_file()
    let started = false
    open.push(
      await serve(file, {
        world,
        start: async () => {
          started = true
          return { ok: true, run_id: '9' }
        }
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

  // Two owners of one store is the situation the whole design exists to
  // avoid: a second coco must not take the first one's socket.
  it('will not steal a socket a live coco is answering on', async () => {
    const file = socket_file()
    open.push(await serve(file, deps()))
    await expect(serve(file, deps())).rejects.toThrow('already answering')
  })

  // A crash leaves the file behind with nothing listening; that one is free.
  it('replaces a socket file nothing is listening on', async () => {
    const file = socket_file()
    fs.writeFileSync(file, '')
    open.push(await serve(file, deps()))
    expect((await request(file, 'GET', '/help')).status).toBe(200)
  })

  // The bundled `coco-mcp-server` reads a reply as everything after the blank
  // line — it does not decode chunked framing — so a chunked body reaches it
  // with the frame sizes still in it. Found by driving the real binary.
  it('frames every reply with a Content-Length, never chunked', async () => {
    const file = socket_file()
    open.push(await serve(file, deps()))

    const answer = await request(file, 'GET', '/jobs')
    expect(answer.encoding).toBeUndefined()
    expect(answer.length).toBe(String(Buffer.byteLength(answer.text)))
  })

  it('removes the socket file when it stops', async () => {
    const file = socket_file()
    const server = await serve(file, deps())
    expect(fs.existsSync(file)).toBe(true)
    await server.close()
    expect(fs.existsSync(file)).toBe(false)
  })
})
