// The agent interface (§43) as its tests reach it: the routes, exercised the only way they exist —
// over a real Unix socket with a real HTTP client. Routing, decoding and the
// body cap are Express's; what these tests pin down is cocoa's surface.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { World } from '@shared/world'
import { empty_world } from '@shared/world'
import type { AgentDeps } from '../../src/main/agent/answer'
import { serve } from '../../src/main/agent/serve'

export const FOLDER = '/exp/solver-gpu'

export const CAMPAIGN_FOLDER = '/exp/nightly'

export function world(): World {
  const base = empty_world()
  base.entities = [
    {
      id: FOLDER,
      kind: 'Job',
      name: 'solver-gpu',
      description: null,
      path: FOLDER,
      manifest: 'Valid',
      parameters: [
        { name: 'nodes', type: 'string', values: null, list: false, description: 'the nodes' },
        { name: 'gpu', type: 'string', values: null, list: false, description: 'the gpu' }
      ]
    },
    {
      id: CAMPAIGN_FOLDER,
      kind: 'Campaign',
      name: 'nightly',
      description: null,
      path: CAMPAIGN_FOLDER,
      manifest: 'Valid',
      parameters: [
        { name: 'sweep', type: 'string', values: null, list: false, description: 'the sweep' }
      ]
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
        params: { nodes: '4' },
        status: 'Running',
        query_health: 'Healthy',
        last_successful_query: '2026-08-20T10:00:03.000+02:00',
        report: 'Missing',
        report_error: null,
        report_rerunnable: false,
        deploy: null,
        error: null
      },
      '1': {
        id: '1',
        job_id: FOLDER,
        origin: 'Agent',
        started_at: '2026-08-20T11:00:00.000+02:00',
        ended_at: '2026-08-20T11:05:00.000+02:00',
        parameters: '--nodes 8',
        params: { nodes: '8' },
        status: 'Succeeded',
        query_health: 'Healthy',
        last_successful_query: '2026-08-20T11:05:00.000+02:00',
        report: { Available: { files: [{ format: 'PlainText', text_bytes: 120 }] } },
        report_error: null,
        report_rerunnable: false,
        deploy: null,
        error: null
      }
    }
  }
  base.campaign_runs = {
    [CAMPAIGN_FOLDER]: {
      '2': {
        id: '2',
        campaign_id: CAMPAIGN_FOLDER,
        by: 'Agent',
        started_at: '2026-08-20T12:00:00.000+02:00',
        ended_at: null,
        parameters: '--sweep full',
        params: { sweep: 'full' },
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
  base.runs_by_campaign = { [CAMPAIGN_FOLDER]: ['2'] }
  return base
}

export function deps(
  start?: AgentDeps['start'],
  rerun?: AgentDeps['rerun_report'],
  register?: AgentDeps['register']
): AgentDeps {
  return {
    current_world: world,
    start: start ?? (async () => ({ ok: true, run_id: '7' })),
    rerun_report: rerun ?? (() => ({ ok: true })),
    register: register ?? ((folder) => ({ ok: true, entity_id: folder, already: false }))
  }
}

/** One HTTP request against a Unix socket, the way any client makes it. */
export function request(
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

/** One request against a freshly served instance, torn down after. */
export async function ask(
  method: string,
  url: string,
  body = '',
  start?: AgentDeps['start'],
  rerun?: AgentDeps['rerun_report'],
  register?: AgentDeps['register']
) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cocoa-ask-')))
  const server = await serve(path.join(dir, 'cocoa.sock'), deps(start, rerun, register))
  try {
    const answer = await request(
      path.join(dir, 'cocoa.sock'),
      method,
      url,
      body === '' ? undefined : body
    )
    return { status: answer.status, json: JSON.parse(answer.text) as Record<string, never> }
  } finally {
    await server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
