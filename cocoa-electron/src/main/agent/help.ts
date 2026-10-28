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
      'cocoa is a local workbench for experiment folders. An experiment is a folder with a ' +
      'manifest and its own scripts (check, deploy, launch, poll, report, cancel); cocoa ' +
      'starts runs through ' +
      'those scripts, tracks each run’s status, and collects reports. This socket is the ' +
      'agent interface — the same engine the window drives, reached over HTTP/1.1 on a Unix ' +
      'socket.',
    manual:
      'Read before working on experiments: https://github.com/Wenke-D/cocoa/blob/main/manual.ai.md ' +
      '(raw: https://raw.githubusercontent.com/Wenke-D/cocoa/main/manual.ai.md) — the rules an ' +
      'agent works by, how an experiment’s scripts are written, and what a report should say.',
    how_to_reach_it:
      'curl --unix-socket ~/.local/share/cocoa/cocoa.sock http://localhost/<path> ' +
      '(COCOA_SOCKET_PATH overrides the location), or the bundled `cocoa-mcp-server` binary, ' +
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
      { method: 'GET', path: '/campaigns', answers: 'every Campaign, in the same shape' },
      {
        method: 'GET',
        path: '/jobs/{name}',
        answers:
          'one Job and its runs, oldest first, each run with the locations to read directly ' +
          '(run_dir, record, report), whether its report is running (report_running) or ' +
          'locked (report_locked), and why its report script failed on a FAILED run ' +
          '(report_error)'
      },
      {
        method: 'GET',
        path: '/campaigns/{name}',
        answers:
          'one Campaign and its runs, each with the calls it dispatched, its locations ' +
          '(run_dir, record, members, report), and whether its report is running ' +
          '(report_running) or locked (report_locked)'
      },
      {
        method: 'POST',
        path: '/experiments/{name}/runs',
        body: { parameters: { '<declared name>': '<value>' } },
        answers:
          'starts the Job or Campaign; 201 with {run_id}. Every declared parameter must be ' +
          'supplied, shaped as declared — GET /jobs/{name} lists them with type, values and ' +
          'description: a string, or a list of strings for a list, each ' +
          'enum value one of its `values`. Every start runs the Job’s check first (a Campaign ' +
          'start checks each Job it calls, once): CURRENT launches at once and the run ' +
          'appears STARTING; STALE runs the Job’s deploy first and the run appears DEPLOYING ' +
          'until it is done (a failed deploy leaves it Error, with the output in error and ' +
          'deploy.error); CONFLICT refuses the start with a 400 carrying the check’s reason, ' +
          'and nothing is recorded — start again once what it names is over. A start made ' +
          'while that Job is checking or deploying waits for it. The submission id and ' +
          'status advance in /jobs/{name} as the scripts answer; each run’s deploy says ' +
          'what its check found.'
      },
      {
        method: 'POST',
        path: '/experiments',
        body: { path: '/absolute/path/to/the/folder' },
        answers:
          'registers the experiment folder at that absolute path, as the Explorer’s + does: ' +
          'its cocoa.toml decides whether it is a Job or a Campaign. 201 with {name, kind, ' +
          'folder, already, follow}; 200 and already: true when it was registered already. ' +
          '400 with the reason for a path that is not absolute or not a folder, a manifest ' +
          'that does not load, or a name another experiment already has.'
      },
      {
        method: 'POST',
        path: '/experiments/{name}/runs/{run_id}/report',
        answers:
          'regenerates a run’s report: runs its report script again, by hand, overwriting ' +
          'the report — for a Job run whose cluster outcome was COMPLETED (including one left ' +
          'at ERROR by its report) or FAILED, and for a Campaign run whose own report has run. ' +
          '202 with {run_id, report_running, location: {report}, follow} as soon as the ' +
          'report is due; it runs on cocoa’s next refresh, up to the report timeout. Follow ' +
          'the `follow` read until the run’s report_running is false: a COMPLETED-path Job ' +
          'run or a Campaign run then reads Succeeded, or Error with its error; a FAILED run ' +
          'stays Failed, with report_error when the script failed. 404 for an unknown ' +
          'experiment or run; 400 for a run that cannot be reported, one whose report is ' +
          'already running, or one whose report is locked.'
      },
      {
        method: 'POST',
        path: '/experiments/{name}/runs/{run_id}/report/lock',
        answers:
          'locks or unlocks a Job run’s or a Campaign run’s report, body {"locked": true} or ' +
          '{"locked": false}. A locked report is not regenerated and its run is not deleted ' +
          '— nor, for a Campaign member, its Campaign run — until it is unlocked; it is the ' +
          'user’s, so lock or unlock one only when they ask. 200 with {run_id, report_locked}; ' +
          'asking for the state it is already in changes nothing. 404 for an unknown ' +
          'experiment or run; 400 for a malformed body, a run with no report to lock, or one ' +
          'whose report is being generated.'
      },
      {
        method: 'POST',
        path: '/experiments/{name}/runs/{run_id}/cancel',
        answers:
          'cancels a Job or Campaign run through the Job’s own cancel script, as the window’s ' +
          'Cancel does — but with no confirmation: asking is deciding. A Campaign run cancels ' +
          'each of its still-active member runs; members that finished keep their results, and ' +
          'runs of the same Jobs started outside it are untouched. Cancelling one member run, ' +
          'under its own Job, leaves the Campaign run and its other members running. 202 with ' +
          '{run_id, follow} once the cancel script has accepted: the run reads Cancelling until ' +
          'a poll confirms it Cancelled — follow GET /jobs/{name} or /campaigns/{name}. 404 for ' +
          'an unknown experiment or run; 400 with the reason for a run that has already ended, ' +
          'is still deploying or launching, is already Cancelling, or whose cancel script ' +
          'failed (the run keeps its status) — for a Campaign, naming the member that did not ' +
          'stop.'
      }
    ]
  })
}
