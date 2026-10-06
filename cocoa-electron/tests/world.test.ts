// The World the renderer reads, built from a real engine over real folders:
// a wrong field here is a wrong screen there.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { build_world } from '../src/main/engine/world'
import {
  campaign_folder,
  cleanup_temp_dirs,
  engine,
  job_folder,
  settle,
  temp_dir,
  write,
  write_script
} from './support'

afterEach(cleanup_temp_dirs)

describe('build_world', () => {
  it('describes a job, its parameters and its run', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver-gpu')
    const cocoa = engine(dir)
    cocoa.register(job)
    await cocoa.start_job(job, { size: '256' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    const world = build_world(cocoa, '2026-08-19T10:00:00.000+02:00')
    expect(world.last_refresh).toBe('2026-08-19T10:00:00.000+02:00')
    expect(world.entities).toHaveLength(1)
    expect(world.entities[0]).toMatchObject({
      id: job,
      kind: 'Job',
      name: 'solver-gpu',
      description: 'Test fixture: a job whose scripts answer from state files',
      manifest: 'Valid',
      parameters: [
        {
          name: 'size',
          type: 'string',
          values: null,
          list: false,
          description: 'Nodes to request'
        },
        {
          name: 'gpu',
          type: 'string',
          values: null,
          list: false,
          description: 'Which GPU to pin to'
        }
      ]
    })

    expect(Object.keys(world.job_runs[job])).toEqual(['0'])
    expect(world.job_runs[job]['0']).toMatchObject({
      id: '0',
      job_id: job,
      origin: 'Human',
      ended_at: null,
      parameters: '--gpu 0 --size 256',
      status: 'Starting',
      query_health: 'Healthy',
      report: 'Missing',
      error: null
    })
    expect(world.runs_by_job).toEqual({ [job]: ['0'] })
  })

  it('indexes a job history oldest first', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'history')
    const cocoa = engine(dir)
    cocoa.register(job)
    for (const size of ['1', '2', '3']) {
      await cocoa.start_job(job, { size }, { gpu: '0' }, 'human')
    }
    await settle(cocoa)

    expect(build_world(cocoa, null).runs_by_job[job]).toEqual(['0', '1', '2'])
  })

  it('reports an available report with its size', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'reported')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, run_id, 'auto')

    const run = build_world(cocoa, null).job_runs[job][String(run_id)]
    expect(run.status).toBe('Succeeded')
    expect(run.ended_at).not.toBeNull()
    const text_bytes = fs.statSync(path.join(job, 'report', `${run_id}.txt`)).size
    expect(run.report).toEqual({ Available: { files: [{ format: 'PlainText', text_bytes }] } })

    // An HTML report beside it is a second file to open, after the text (§20)
    fs.writeFileSync(path.join(job, 'report', `${run_id}.html`), '<p>hi</p>')
    const both = build_world(cocoa, null).job_runs[job][String(run_id)]
    expect(both.report).toEqual({
      Available: {
        files: [
          { format: 'PlainText', text_bytes },
          { format: 'Html', text_bytes: 9 }
        ]
      }
    })
  })

  // A failed run's report is shown exactly as a succeeded run's, beside the
  // status it never changes (§7.3.1): in flight, landed, or failed.
  it("shows a failed run's report as it goes, and its error", async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'failing')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'FAILED diverged')
    await cocoa.poll_job(job)

    let run = build_world(cocoa, null).job_runs[job][String(run_id)]
    expect(run).toMatchObject({ status: 'Failed', report: 'Generating', report_error: null })
    expect(run.ended_at).not.toBeNull()

    await cocoa.report_run(job, run_id, 'auto')
    run = build_world(cocoa, null).job_runs[job][String(run_id)]
    const text_bytes = fs.statSync(path.join(job, 'report', `${run_id}.txt`)).size
    expect(run).toMatchObject({
      status: 'Failed',
      report: { Available: { files: [{ format: 'PlainText', text_bytes }] } },
      report_error: null,
      error: null
    })

    write(job, 'report-state', 'fail')
    fs.rmSync(path.join(job, 'report', `${run_id}.txt`))
    await cocoa.report_run(job, run_id, 'manual').catch(() => undefined)
    run = build_world(cocoa, null).job_runs[job][String(run_id)]
    expect(run).toMatchObject({ status: 'Failed', report: 'Missing', error: null })
    expect(run.report_error).toContain('exploded')
  })

  // An unreachable cluster is a gap in knowledge, not a change of state: the
  // run keeps showing what it was last known to be, and the query health
  // carries the reason (§9).
  it('shows the last known status when the cluster is unreachable', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'flaky')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)

    write_script(job, 'poll.sh', "echo 'squeue: connection timed out' >&2\nexit 3\n")
    await cocoa.poll_job(job).catch(() => undefined)

    const run = build_world(cocoa, null).job_runs[job][String(run_id)]
    expect(run.status).toBe('Running')
    expect(run.query_health).toEqual({
      Unavailable: { message: expect.stringContaining('poll script failed') as string }
    })
  })

  it('keeps a broken folder visible, carrying its manifest error', () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'was-fine')
    const cocoa = engine(dir)
    cocoa.register(job)
    write(job, 'cocoa.toml', 'kind = "pipeline"\nname = "was-fine"\n')
    cocoa.reconcile()

    const world = build_world(cocoa, null)
    expect(world.entities).toHaveLength(1)
    expect(world.entities[0].kind).toBe('Job')
    expect(world.entities[0].name).toBe('was-fine')
    expect(world.entities[0].description).toBeNull()
    expect(world.entities[0].manifest).toMatchObject({
      Invalid: { message: expect.stringContaining('kind') as string }
    })
    expect(world.entities[0].parameters).toEqual([])
  })

  it('describes a campaign run, its plan and the runs it dispatched', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const campaign = campaign_folder(dir, 'sweep', ['member-job', 'member-job'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)

    const world = build_world(cocoa, null)
    const run = world.campaign_runs[campaign][String(start.run_id)]
    expect(run).toMatchObject({
      campaign_id: campaign,
      by: 'Human',
      parameters: '--mesh fine',
      status: 'Starting',
      report: 'Missing'
    })
    expect(run.plan.steps).toEqual([
      {
        index: 0,
        job_id: job,
        parameters: '--gpu 0 --size 256',
        run_id: String(start.members[0].run_id)
      },
      {
        index: 1,
        job_id: job,
        parameters: '--gpu 0 --size 256',
        run_id: String(start.members[1].run_id)
      }
    ])
    expect(world.runs_by_campaign).toEqual({ [campaign]: [String(start.run_id)] })

    // The same run, two addresses (§2.3.1): a member knows the campaign run and
    // the call that dispatched it.
    expect(world.job_runs[job][String(start.members[1].run_id)].origin).toEqual({
      Campaign: {
        name: 'sweep',
        campaign_id: campaign,
        campaign_run_id: String(start.run_id),
        call: 2
      }
    })
  })

  // A campaign has no history of its own (§9.1): it ends when its last member
  // does, and until then its clock runs.
  it("dates a campaign run's end by its last member's", async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const campaign = campaign_folder(dir, 'sweep', ['member-job', 'member-job'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    expect(
      build_world(cocoa, null).campaign_runs[campaign][String(start.run_id)].ended_at
    ).toBeNull()

    write(job, 'poll-state', 'FAILED no convergence')
    await cocoa.poll_job(job)

    const world = build_world(cocoa, null)
    const ends = start.members.map((member) => world.job_runs[job][String(member.run_id)].ended_at)
    expect(ends.every((at) => at !== null)).toBe(true)
    const latest = ends.reduce((a, b) =>
      Date.parse(b as string) > Date.parse(a as string) ? b : a
    )
    expect(world.campaign_runs[campaign][String(start.run_id)]).toMatchObject({
      status: 'Failed',
      ended_at: latest
    })
  })

  // End to end, a campaign that succeeds ends when its own report lands — not
  // when its last member did (§8.2).
  it('ends at its own report when it has one', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const campaign = campaign_folder(dir, 'sweep', ['member-job'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)

    write(job, 'poll-state', 'COMPLETED')
    // One tick reports the member, the next reports the campaign over it.
    await cocoa.refresh()
    await cocoa.refresh()

    const record = cocoa.campaign(campaign).runs.record(start.run_id)
    expect(record.report?.at).toBeDefined()
    const run = build_world(cocoa, null).campaign_runs[campaign][String(start.run_id)]
    expect(run.status).toBe('Succeeded')
    expect(run.ended_at).toBe(record.report?.at)
  })
})
