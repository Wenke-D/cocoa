// The agent interface (§43), driven the way an agent drives it: HTTP over the
// unix socket, while the window is open. A start asked for here is the same
// start a click makes — same engine, same queue, same screen — and the run
// shows up in the window stamped `agent`.
//
// The last act runs the `coco-mcp-server` binary against this socket,
// unchanged, which is the whole point of keeping the paths and shapes. It is
// its own crate (`coco-mcp/`) because it speaks only this protocol and so
// drives either implementation; build it with `cargo build` in there.

import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MCP_BIN = path.join(REPO_ROOT, 'coco-mcp/target/debug/coco-mcp-server')

function call(socket_path, method, route_path, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      // `socketPath` is Node's option name, not ours.
      {
        socketPath: socket_path,
        path: route_path,
        method,
        headers: { 'Content-Type': 'application/json' }
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (text += chunk))
        response.on('end', () => resolve({ status: response.statusCode, text }))
      }
    )
    request.on('error', reject)
    if (body !== undefined) request.write(body)
    request.end()
  })
}

/** Drives the MCP binary over stdio the way an MCP client would. */
async function mcp(socket_path, messages) {
  const child = spawn(MCP_BIN, {
    env: { ...process.env, COCO_SOCKET_PATH: socket_path },
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const replies = []
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      if (line !== '') replies.push(JSON.parse(line))
      at = buffer.indexOf('\n')
    }
  })
  for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`)
  const wanted = messages.filter((message) => message.id !== undefined).length
  const deadline = Date.now() + 10_000
  while (replies.length < wanted && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.stdin.end()
  child.kill()
  return replies
}

export async function run({ page, shot, log, wait_text, socket_path }) {
  await wait_text('solver-gpu', 20_000)

  const help = await call(socket_path, 'GET', '/help')
  log('GET /help →', help.status, `${JSON.parse(help.text).endpoints.length} endpoints`)
  if (help.status !== 200) throw new Error('the socket did not answer /help')

  const jobs = await call(socket_path, 'GET', '/jobs')
  const names = JSON.parse(jobs.text).map((job) => job.name)
  log('GET /jobs →', jobs.status, names.join(', '))
  if (!names.includes('solver-gpu')) throw new Error(`/jobs is missing solver-gpu: ${jobs.text}`)

  const detail = await call(socket_path, 'GET', '/jobs/solver-gpu')
  log('GET /jobs/solver-gpu →', detail.status, 'parameters', JSON.parse(detail.text).parameters)

  // A start over the socket, while the window watches.
  const started = await call(
    socket_path,
    'POST',
    '/experiments/solver-gpu/runs',
    JSON.stringify({ parameters: { nodes: '8', gpu: '1' } })
  )
  log('POST /experiments/solver-gpu/runs →', started.status, started.text)
  if (started.status !== 201) throw new Error(`the start was refused: ${started.text}`)
  const run_id = JSON.parse(started.text).run_id

  // The window is the same workbench: the run appears in it, stamped agent.
  await page.locator('aside').getByText('solver-gpu').click()
  await wait_text('agent', 20_000)
  const history = (await page.locator('table').innerText()).replace(/\n/g, ' | ')
  log('history table:', history)
  if (!history.includes('agent')) {
    throw new Error(`the run does not read as the agent's: ${history}`)
  }
  await shot('agent-run-in-the-window')

  // And it is in /world, which is what an agent reads back.
  const world = JSON.parse((await call(socket_path, 'GET', '/world')).text)
  // Runs are indexed by the experiment they belong to and then by id: an id
  // is only unique inside its own experiment.
  const folder = world.entities.find((entity) => entity.name === 'solver-gpu').id
  const run = world.job_runs[folder][run_id]
  log('world says run', run_id, 'is', run.status, 'origin', JSON.stringify(run.origin))
  if (run.origin !== 'Agent') throw new Error(`origin is ${JSON.stringify(run.origin)}`)

  // Finally: the Rust MCP binary, unchanged, against this socket.
  const replies = await mcp(socket_path, [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocol_version: '2025-06-18',
        client_info: { name: 'drive', version: '0' },
        capabilities: {}
      }
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'coco_list_jobs', arguments: {} }
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'coco_start',
        arguments: { experiment: 'solver-gpu', parameters: { nodes: '2', gpu: '0' } }
      }
    }
  ])
  const by_id = new Map(replies.map((reply) => [reply.id, reply]))
  log('mcp initialize →', by_id.get(1)?.result?.serverInfo?.name)
  const tools = by_id.get(2)?.result?.tools?.map((tool) => tool.name) ?? []
  log('mcp tools/list →', tools.join(', '))
  if (!tools.includes('coco_start')) throw new Error('the MCP binary listed no coco_start')
  const listed = by_id.get(3)?.result?.content?.[0]?.text ?? ''
  const listed_jobs = JSON.parse(listed).map((job) => job.name)
  if (!listed_jobs.includes('solver-gpu')) throw new Error(`coco_list_jobs answered ${listed}`)
  const mcp_start = by_id.get(4)?.result
  const start_text = mcp_start?.content?.[0]?.text ?? ''
  log('mcp coco_start →', JSON.stringify(start_text))
  if (mcp_start?.isError !== false)
    throw new Error(`coco_start failed: ${JSON.stringify(mcp_start)}`)
  // Parsed, not merely searched: a reply the client could not frame properly
  // still *contains* the run id, surrounded by chunk sizes.
  const mcp_run_id = JSON.parse(start_text).run_id
  if (typeof mcp_run_id !== 'string') throw new Error(`coco_start answered ${start_text}`)

  await wait_text('Running', 25_000)
  await shot('after-mcp-start')
  log('the Rust MCP binary drove coco-electron unchanged')
}
