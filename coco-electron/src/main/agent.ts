// The seam an agent drives coco through (specification §43) — the port of
// `src/agent/`.
//
// An agent asks coco to do things; it never runs an experiment's scripts
// itself. Everything it can ask for arrives here and takes exactly the path a
// click takes: the same `operations.ts`, the same engine queue, the same
// screen update. There is no second way into the engine to keep in step with
// the first — the difference between a click and a call is one word, the
// trigger stamped on the run.
//
// The wire is HTTP/1.1 over a Unix socket, because that is what the Rust coco
// speaks and the bundled `coco_mcp_server` binary talks to. Node serves both
// natively, so this is a transport adapter over `operations.ts`, not a second
// implementation. `curl --unix-socket` debugs it either way.

import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import type { BenchRun, Entity, JobRun, ReportState, StartResult, World } from '@shared/world'
import { bench_run, job_run } from '@shared/world'
import type { Maybe } from './types'

/**
 * The most a request body may be. A start's parameters are a handful of short
 * strings; anything at this size is a mistake or an attack, and reading it
 * into memory to find out is the mistake's accomplice.
 */
const MAX_BODY = 64 * 1024

/**
 * How long a caller waits for the engine's queue before being told coco is not
 * answering. Generous: a start runs the experiment's own launch script, which
 * talks to a cluster.
 */
const REPLY_TIMEOUT_MS = 30_000

/** What the socket needs from the rest of the process, and nothing more. */
export interface AgentDeps {
  /** The world the window is rendering from, as it last saw it. */
  world(): World
  /** Starts an experiment by name, stamped as the agent's (§43). */
  start(name: string, parameters: Record<string, string>): Promise<StartResult>
}

export interface AgentRequest {
  method: string
  /** The raw request target; the query is stripped and escapes resolved here. */
  url: string
  body: string
}

export interface AgentResponse {
  status: number
  body: string
}

function json(status: number, value: unknown): AgentResponse {
  return { status, body: JSON.stringify(value) }
}

/** A failure, in the one shape every failing reply takes. */
function failure(status: number, message: string): AgentResponse {
  return json(status, { error: message })
}

/**
 * The routable part of a request target: query string dropped, percent-escapes
 * resolved. Experiment names are folder names, and a folder name may hold a
 * space.
 */
export function path_of(target: string): string {
  const without_query = target.split(/[?#]/)[0] ?? target
  try {
    return decodeURIComponent(without_query)
  } catch {
    // A malformed escape is not a reason to drop the request; it simply is
    // not a path that names anything.
    return without_query
  }
}

/** The path split on `/`, empty segments dropped. */
export function segments(target: string): string[] {
  return path_of(target)
    .split('/')
    .filter((part) => part !== '')
}

/**
 * Which failure this was, as far as the wire is concerned. The engine's errors
 * are sentences meant for a person, so this reads them rather than inventing a
 * parallel set of codes. Anything unrecognised is a `400`: the request was
 * refused, and the caller is the one who can act.
 */
function status_for(message: string): number {
  if (message.startsWith('No such entity')) {
    return 404
  }
  if (message.includes('did not answer in time')) {
    return 503
  }
  return 400
}

/** The routes. Kept in one place so the whole surface is readable at once. */
export async function route(request: AgentRequest, deps: AgentDeps): Promise<AgentResponse> {
  const parts = segments(request.url)
  const method = request.method.toUpperCase()

  if (method === 'GET') {
    if (match(parts, ['help'])) {
      return help()
    }
    // Everything the workbench renders from, as the workbench last saw it.
    // The same JSON `--dump-state` prints, and for the same reason: a symptom
    // becomes a fact you can grep.
    if (match(parts, ['world'])) {
      return json(200, deps.world())
    }
    if (match(parts, ['jobs'])) {
      return list_entities(deps.world(), 'Job')
    }
    if (match(parts, ['benches'])) {
      return list_entities(deps.world(), 'Bench')
    }
    if (parts.length === 2 && parts[0] === 'jobs') {
      return job_detail(deps.world(), parts[1])
    }
    if (parts.length === 2 && parts[0] === 'benches') {
      return bench_detail(deps.world(), parts[1])
    }
    return failure(404, 'no such endpoint')
  }

  if (method === 'POST') {
    if (parts.length === 3 && parts[0] === 'experiments' && parts[2] === 'runs') {
      return start_run(parts[1], request.body, deps)
    }
    return failure(404, 'no such endpoint')
  }

  return failure(405, 'unsupported method')
}

function match(parts: string[], expected: string[]): boolean {
  return parts.length === expected.length && parts.every((part, at) => part === expected[at])
}

async function start_run(name: string, body: string, deps: AgentDeps): Promise<AgentResponse> {
  let parameters: Record<string, string> = {}
  if (body.trim() !== '') {
    try {
      const parsed = JSON.parse(body) as { parameters?: Record<string, string> }
      parameters = parsed.parameters ?? {}
    } catch (error) {
      return failure(400, (error as Error).message)
    }
  }

  // The name is answered for here so the refusal reads the same as the Rust
  // interface's, which is what decides the status code.
  const known = deps.world().entities.some((entity) => entity.name === name)
  if (!known) {
    return failure(404, `No such entity: ${name}`)
  }

  const result = await with_timeout(deps.start(name, parameters))
  // The workbench's own failure text, unchanged: an agent reading it should
  // see what a person would have been shown.
  if (!result.ok) {
    return failure(status_for(result.message), result.message)
  }
  return json(201, { run_id: result.run_id })
}

/**
 * What keeps a caller from hanging forever if the engine is wedged. In the
 * normal case a start is one queue turn away.
 */
async function with_timeout(work: Promise<StartResult>): Promise<StartResult> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<StartResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, message: 'coco did not answer in time' }),
      REPLY_TIMEOUT_MS
    )
  })
  try {
    return await Promise.race([work, expiry])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

// ---------------------------------------------------------------------------
// The read routes. Every caller is on this machine, so detail responses carry
// file *locations* rather than file contents.

function run_ids_of(world: World, entity: Entity): string[] {
  const index = entity.kind === 'Job' ? world.runs_by_job : world.runs_by_bench
  return index[entity.id] ?? []
}

function is_active_status(status: string): boolean {
  return !['Succeeded', 'Failed', 'Cancelled', 'Error'].includes(status)
}

function list_entities(world: World, kind: 'Job' | 'Bench'): AgentResponse {
  const items = world.entities
    .filter((entity) => entity.kind === kind)
    .map((entity) => {
      const ids = run_ids_of(world, entity)
      const active = ids.filter((id) => {
        const run = kind === 'Job' ? job_run(world, entity.id, id) : bench_run(world, entity.id, id)
        return run !== undefined && is_active_status(run.status)
      }).length
      return {
        name: entity.name,
        folder: entity.id,
        manifest: entity.manifest,
        parameters: entity.parameter_names,
        runs: ids.length,
        active
      }
    })
  return json(200, items)
}

/** Where the report file is, when there is one to read. */
function report_location(folder: string, run_id: string, report: ReportState): Maybe<string> {
  if (typeof report === 'object' && 'Available' in report) {
    const extension = report.Available.format === 'Html' ? 'html' : 'txt'
    return path.join(folder, 'report', `${run_id}.${extension}`)
  }
  return null
}

function find_entity(world: World, name: string, kind: 'Job' | 'Bench'): Entity | undefined {
  return world.entities.find((entity) => entity.name === name && entity.kind === kind)
}

/** A name that exists as the other kind deserves a pointer, not a flat no. */
function no_such_entity(world: World, name: string, asked: 'Job' | 'Bench'): AgentResponse {
  const [this_, other] = asked === 'Job' ? ['job', 'benches'] : ['bench', 'jobs']
  if (world.entities.some((entity) => entity.name === name)) {
    return failure(404, `${name} is not a ${this_}; ask /${other}/${name}`)
  }
  return failure(404, `No such ${this_}: ${name}`)
}

function job_detail(world: World, name: string): AgentResponse {
  const entity = find_entity(world, name, 'Job')
  if (entity === undefined) {
    return no_such_entity(world, name, 'Job')
  }
  const folder = entity.id

  const runs = run_ids_of(world, entity)
    .map((id) => job_run(world, folder, id))
    .filter((run): run is JobRun => run !== undefined)
    .map((run) => {
      const run_dir = path.join(folder, 'runs', run.id)
      return {
        id: run.id,
        status: run.status,
        origin: run.origin,
        started_at: run.started_at,
        ended_at: run.ended_at,
        parameters: run.parameters,
        query_health: run.query_health,
        error: run.error,
        location: {
          run_dir: run_dir,
          record: path.join(run_dir, 'run.json'),
          report: report_location(folder, run.id, run.report)
        }
      }
    })

  return json(200, {
    name: entity.name,
    kind: 'job',
    folder,
    manifest: entity.manifest,
    parameters: entity.parameter_names,
    runs
  })
}

function bench_detail(world: World, name: string): AgentResponse {
  const entity = find_entity(world, name, 'Bench')
  if (entity === undefined) {
    return no_such_entity(world, name, 'Bench')
  }
  const folder = entity.id

  const name_of = (entity_id: string): string =>
    world.entities.find((candidate) => candidate.id === entity_id)?.name ?? entity_id

  const runs = run_ids_of(world, entity)
    .map((id) => bench_run(world, folder, id))
    .filter((run): run is BenchRun => run !== undefined)
    .map((run) => {
      const run_dir = path.join(folder, 'runs', run.id)
      return {
        id: run.id,
        status: run.status,
        by: run.by,
        started_at: run.started_at,
        ended_at: run.ended_at,
        parameters: run.parameters,
        query_health: run.query_health,
        error: run.error,
        calls: run.plan.steps.map((step) => ({
          call: step.index,
          job: name_of(step.job_id),
          parameters: step.parameters,
          // Follow it under /jobs/{job}: the member is an ordinary job run,
          // and its id only means anything beside that job's name — ids are
          // per experiment (§10.1).
          run_id: step.run_id
        })),
        location: {
          run_dir: run_dir,
          record: path.join(run_dir, 'run.json'),
          members: path.join(run_dir, 'members.json'),
          report: report_location(folder, run.id, run.report)
        }
      }
    })

  return json(200, {
    name: entity.name,
    kind: 'bench',
    folder,
    manifest: entity.manifest,
    parameters: entity.parameter_names,
    runs
  })
}

/**
 * What this socket is and everything it answers, served from the socket
 * itself. Lives next to `route` so the description and the routes cannot drift
 * apart unnoticed.
 */
function help(): AgentResponse {
  return json(200, {
    what:
      'coco is a local workbench for experiment folders. An experiment is a folder with a ' +
      'manifest and its own scripts (launch, poll, report, cancel); coco starts runs through ' +
      'those scripts, tracks each run’s status, and collects reports. This socket is the ' +
      'agent interface — the same engine the window drives, reached over HTTP/1.1 on a Unix ' +
      'socket.',
    how_to_reach_it:
      'curl --unix-socket ~/.local/share/coco/coco.sock http://localhost/<path> ' +
      '(COCO_SOCKET_PATH overrides the location), or the bundled `coco-mcp-server` binary, ' +
      'which serves these routes as MCP tools.',
    local_by_design:
      'Every caller is on this machine, so detail responses carry file *locations* — the ' +
      'experiment folder, a run’s directory and record, a report file — rather than file ' +
      'contents. Read them straight from disk.',
    endpoints: [
      { method: 'GET', path: '/help', answers: 'this document' },
      {
        method: 'GET',
        path: '/world',
        answers:
          'the whole snapshot the window renders from — the same JSON `coco --dump-state` prints'
      },
      {
        method: 'GET',
        path: '/jobs',
        answers: 'every Job: name, folder, declared parameters, run tallies'
      },
      { method: 'GET', path: '/benches', answers: 'every Bench, in the same shape' },
      {
        method: 'GET',
        path: '/jobs/{name}',
        answers:
          'one Job and its runs, oldest first, each run with the locations to read directly ' +
          '(run_dir, record, report)'
      },
      {
        method: 'GET',
        path: '/benches/{name}',
        answers:
          'one Bench and its runs, each with the calls it dispatched and its locations ' +
          '(run_dir, record, members, report)'
      },
      {
        method: 'POST',
        path: '/experiments/{name}/runs',
        body: { parameters: { '<declared name>': '<value>' } },
        answers:
          'starts the Job or Bench; 201 with {run_id}. Every declared parameter must be ' +
          'supplied — GET /jobs/{name} lists them. The run appears STARTING at once; its ' +
          'submission id and status advance in /world as the scripts answer.'
      }
    ]
  })
}

// ---------------------------------------------------------------------------
// The listener.

/**
 * Where the socket lives. One fixed path: an agent should not have to discover
 * a port or be told a number, and two coco windows over two stores is not a
 * case this prototype serves (§43).
 */
export function socket_path(): string {
  const override = process.env['COCO_SOCKET_PATH']
  if (override !== undefined && override !== '') {
    return override
  }
  const home = process.env['HOME']
  if (home !== undefined && home !== '') {
    return path.join(home, '.local/share/coco/coco.sock')
  }
  return 'coco.sock'
}

export interface AgentServer {
  close(): Promise<void>
}

/** Whether something is listening on a socket file that already exists. */
function is_live(socket_file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(socket_file)
    const settle = (live: boolean): void => {
      probe.destroy()
      resolve(live)
    }
    probe.once('connect', () => settle(true))
    probe.once('error', () => settle(false))
    probe.setTimeout(1_000, () => settle(false))
  })
}

/**
 * Binds the socket and serves it.
 *
 * A socket file left by a crash is replaced. One left by a *running* coco is
 * not: that window owns the store, and two owners is the situation this whole
 * design exists to avoid — so this throws, and the second window runs without
 * an interface rather than stealing the first's.
 */
export async function serve(socket_file: string, deps: AgentDeps): Promise<AgentServer> {
  fs.mkdirSync(path.dirname(socket_file), { recursive: true })

  if (fs.existsSync(socket_file)) {
    if (await is_live(socket_file)) {
      throw new Error(`another coco is already answering on ${socket_file}`)
    }
    // Nothing is listening: the file outlived the window that made it.
    fs.rmSync(socket_file, { force: true })
  }

  const server = http.createServer((incoming, outgoing) => {
    void handle(incoming, outgoing, deps)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket_file, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          // Dropping the file is part of stopping: the next launch should not
          // have to reason about whether what it found belongs to a live
          // window.
          fs.rmSync(socket_file, { force: true })
          resolve()
        })
        // A keep-alive connection would otherwise hold the close open.
        server.closeAllConnections?.()
      })
  }
}

async function handle(
  incoming: http.IncomingMessage,
  outgoing: http.ServerResponse,
  deps: AgentDeps
): Promise<void> {
  const answer = await read(incoming).then(
    (body) =>
      typeof body === 'string'
        ? route({ method: incoming.method ?? 'GET', url: incoming.url ?? '/', body }, deps)
        : body,
    (error: Error) => failure(400, error.message)
  )
  // `Content-Length`, never chunked: the bundled `coco-mcp-server` reads a
  // reply as "everything after the blank line" — the minimal HTTP a client on
  // a private socket is entitled to — so a chunked body would reach it with
  // the frame sizes still in it.
  const payload = Buffer.from(answer.body, 'utf8')
  outgoing.writeHead(answer.status, {
    'Content-Type': 'application/json',
    'Content-Length': payload.length
  })
  outgoing.end(payload)
  // A caller that was refused mid-body is told first and hung up on second:
  // destroying the socket before the reply is written is how a refusal turns
  // into "connection reset", which explains nothing.
  if (!incoming.complete) {
    incoming.destroy()
  }
}

/**
 * Reads the body, refusing one that is too large — on the declared length
 * first, before a byte of it is read.
 *
 * A refusal *resolves* as the 413; only a stream error rejects, with an Error.
 */
function read(incoming: http.IncomingMessage): Promise<string | AgentResponse> {
  return new Promise((resolve, reject) => {
    const declared = Number(incoming.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      incoming.resume()
      resolve(failure(413, 'request body is too large'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    incoming.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        // Stop reading, but leave the connection alive long enough to say why.
        incoming.pause()
        resolve(failure(413, 'request body is too large'))
        return
      }
      chunks.push(chunk)
    })
    incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    incoming.on('error', (error) => reject(error))
  })
}
