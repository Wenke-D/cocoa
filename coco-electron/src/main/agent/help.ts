// The socket's self-description, served from the socket itself.

import type { AgentResponse } from './answer'
import { json } from './answer'

/**
 * What this socket is and everything it answers. The surface it describes is
 * `app.ts`'s route table — change one, change the other.
 */
export function help(): AgentResponse {
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
          'submission id and status advance in /jobs/{name} as the scripts answer.'
      }
    ]
  })
}
