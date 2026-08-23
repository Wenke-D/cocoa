// The World the renderer reads, built from a real engine over real folders:
// a wrong field here is a wrong screen there.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { build_world } from '../src/main/engine/world'
import {
  bench_folder,
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
    const coco = engine(dir)
    coco.register(job)
    await coco.start_job(job, { size: '256' }, { gpu: '0' }, 'human')
    await settle(coco)

    const world = build_world(coco, '2026-08-19T10:00:00.000+02:00')
    expect(world.last_refresh).toBe('2026-08-19T10:00:00.000+02:00')
    expect(world.entities).toHaveLength(1)
    expect(world.entities[0]).toMatchObject({
      id: job,
      kind: 'Job',
      name: 'solver-gpu',
      manifest: 'Valid',
      parameter_names: ['size', 'gpu']
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
    const coco = engine(dir)
    coco.register(job)
    for (const size of ['1', '2', '3']) {
      await coco.start_job(job, { size }, { gpu: '0' }, 'human')
    }
    await settle(coco)

    expect(build_world(coco, null).runs_by_job[job]).toEqual(['0', '1', '2'])
  })

  it('reports an available report with its size', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'reported')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'COMPLETED')
    await coco.poll_job(job)
    await coco.report_run(job, run_id, 'auto')

    const run = build_world(coco, null).job_runs[job][String(run_id)]
    expect(run.status).toBe('Succeeded')
    expect(run.ended_at).not.toBeNull()
    expect(run.report).toEqual({
      Available: {
        format: 'PlainText',
        text_bytes: fs.statSync(path.join(job, 'report', `${run_id}.txt`)).size
      }
    })
  })

  // An unreachable cluster is a gap in knowledge, not a change of state: the
  // run keeps showing what it was last known to be, and the query health
  // carries the reason (§9).
  it('shows the last known status when the cluster is unreachable', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'flaky')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.poll_job(job)

    write_script(job, 'poll.sh', "echo 'squeue: connection timed out' >&2\nexit 3\n")
    await coco.poll_job(job).catch(() => undefined)

    const run = build_world(coco, null).job_runs[job][String(run_id)]
    expect(run.status).toBe('Running')
    expect(run.query_health).toEqual({
      Unavailable: { message: expect.stringContaining('poll script failed') as string }
    })
  })

  it('keeps a broken folder visible, carrying its manifest error', () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'was-fine')
    const coco = engine(dir)
    coco.register(job)
    write(job, 'coco.toml', 'kind = "pipeline"\nname = "was-fine"\n')
    coco.reconcile()

    const world = build_world(coco, null)
    expect(world.entities).toHaveLength(1)
    expect(world.entities[0].kind).toBe('Job')
    expect(world.entities[0].name).toBe('was-fine')
    expect(world.entities[0].manifest).toMatchObject({
      Invalid: { message: expect.stringContaining('kind') as string }
    })
    expect(world.entities[0].parameter_names).toEqual([])
  })

  it('describes a bench run, its plan and the runs it dispatched', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const bench = bench_folder(dir, 'sweep', ['member-job', 'member-job'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)

    const world = build_world(coco, null)
    const run = world.bench_runs[bench][String(start.run_id)]
    expect(run).toMatchObject({
      bench_id: bench,
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
    expect(world.runs_by_bench).toEqual({ [bench]: [String(start.run_id)] })

    // The same run, two addresses (§2.3.1): a member knows the bench run and
    // the call that dispatched it.
    expect(world.job_runs[job][String(start.members[1].run_id)].origin).toEqual({
      Bench: {
        name: 'sweep',
        bench_id: bench,
        bench_run_id: String(start.run_id),
        call: 2
      }
    })
  })

  // A bench has no history of its own (§9.1): it ends when its last member
  // does, and until then its clock runs.
  it("dates a bench run's end by its last member's", async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const bench = bench_folder(dir, 'sweep', ['member-job', 'member-job'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)
    expect(build_world(coco, null).bench_runs[bench][String(start.run_id)].ended_at).toBeNull()

    write(job, 'poll-state', 'FAILED no convergence')
    await coco.poll_job(job)

    const world = build_world(coco, null)
    const ends = start.members.map((member) => world.job_runs[job][String(member.run_id)].ended_at)
    expect(ends.every((at) => at !== null)).toBe(true)
    const latest = ends.reduce((a, b) =>
      Date.parse(b as string) > Date.parse(a as string) ? b : a
    )
    expect(world.bench_runs[bench][String(start.run_id)]).toMatchObject({
      status: 'Failed',
      ended_at: latest
    })
  })

  // End to end, a bench that succeeds ends when its own report lands — not
  // when its last member did (§8.2).
  it('ends at its own report when it has one', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const bench = bench_folder(dir, 'sweep', ['member-job'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)

    write(job, 'poll-state', 'COMPLETED')
    // One tick reports the member, the next reports the bench over it.
    await coco.refresh()
    await coco.refresh()

    const record = coco.bench(bench).runs.record(start.run_id)
    expect(record.report?.at).toBeDefined()
    const run = build_world(coco, null).bench_runs[bench][String(start.run_id)]
    expect(run.status).toBe('Succeeded')
    expect(run.ended_at).toBe(record.report?.at)
  })
})
