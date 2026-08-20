// The World the renderer reads, built from a real engine over real folders.
// Port of the world-building half of src/adapter/engine.rs: same JSON shape,
// so a wrong field here is a wrong screen there.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWorld } from '../src/main/engine/world'
import {
  benchFolder,
  cleanupTempDirs,
  engine,
  jobFolder,
  settle,
  tempDir,
  write,
  writeScript
} from './support'

afterEach(cleanupTempDirs)

describe('buildWorld', () => {
  it('describes a job, its parameters and its run', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'solver-gpu')
    const coco = engine(dir)
    coco.register(job)
    await coco.startJob(job, { size: '256' }, { gpu: '0' }, 'human')
    await settle(coco)

    const world = buildWorld(coco, '2026-08-19T10:00:00.000+02:00')
    expect(world.last_refresh).toBe('2026-08-19T10:00:00.000+02:00')
    expect(world.entities).toHaveLength(1)
    expect(world.entities[0]).toMatchObject({
      id: job,
      kind: 'Job',
      name: 'solver-gpu',
      manifest: 'Valid',
      parameter_names: ['size', 'gpu'],
      last_used: { gpu: '0', size: '256' }
    })

    expect(Object.keys(world.job_runs)).toEqual(['0'])
    expect(world.job_runs['0']).toMatchObject({
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
    const dir = tempDir()
    const job = jobFolder(dir, 'history')
    const coco = engine(dir)
    coco.register(job)
    for (const size of ['1', '2', '3']) {
      await coco.startJob(job, { size }, { gpu: '0' }, 'human')
    }
    await settle(coco)

    expect(buildWorld(coco, null).runs_by_job[job]).toEqual(['0', '1', '2'])
  })

  it('reports an available report with its size', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'reported')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'COMPLETED')
    await coco.pollJob(job)
    await coco.reportRun(job, runId, 'auto')

    const run = buildWorld(coco, null).job_runs[String(runId)]
    expect(run.status).toBe('Succeeded')
    expect(run.ended_at).not.toBeNull()
    expect(run.report).toEqual({
      Available: {
        format: 'PlainText',
        text_bytes: fs.statSync(path.join(job, 'report', `${runId}.txt`)).size
      }
    })
  })

  // An unreachable cluster is a gap in knowledge, not a change of state: the
  // run keeps showing what it was last known to be, and the query health
  // carries the reason (§9).
  it('shows the last known status when the cluster is unreachable', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'flaky')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.pollJob(job)

    writeScript(job, 'poll.sh', "echo 'squeue: connection timed out' >&2\nexit 3\n")
    await coco.pollJob(job).catch(() => undefined)

    const run = buildWorld(coco, null).job_runs[String(runId)]
    expect(run.status).toBe('Running')
    expect(run.query_health).toEqual({
      Unavailable: { message: expect.stringContaining('poll script failed') }
    })
  })

  it('keeps a broken folder visible, carrying its manifest error', () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'was-fine')
    const coco = engine(dir)
    coco.register(job)
    write(job, 'coco.toml', 'kind = "pipeline"\nname = "was-fine"\n')
    coco.reconcile()

    const world = buildWorld(coco, null)
    expect(world.entities).toHaveLength(1)
    expect(world.entities[0].name).toBe('was-fine')
    expect(world.entities[0].manifest).toMatchObject({
      Invalid: { message: expect.stringContaining('kind') }
    })
    expect(world.entities[0].parameter_names).toEqual([])
  })

  it('describes a bench run, its plan and the runs it dispatched', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'member-job')
    const bench = benchFolder(dir, 'sweep', ['member-job', 'member-job'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.startBench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)

    const world = buildWorld(coco, null)
    const run = world.bench_runs[String(start.runId)]
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
    expect(world.runs_by_bench).toEqual({ [bench]: [String(start.runId)] })

    // The same run, two addresses (§2.3.1): a member knows the bench run and
    // the call that dispatched it.
    expect(world.job_runs[String(start.members[1].run_id)].origin).toEqual({
      Bench: {
        name: 'sweep',
        bench_id: bench,
        bench_run_id: String(start.runId),
        call: 2
      }
    })
  })
})
