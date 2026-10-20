// Memory is the truth, and cocoa's own files are cocoa's alone, so run records
// are read once when a folder is first seen and never re-scanned — the tests
// say so: an outside change to a record shows up in a reopened engine, not a
// running one. Manifests stay the user's files and are re-read every
// reconcile pass.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../support/engine'
import { hand_edit, read_text } from '../../support/files'
import { job_folder } from '../../support/fixtures'
import { record_path } from '../../support/run_paths'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('run ids', () => {
  // A run id is one past the highest that experiment already has, read from
  // the records rather than from a counter, which could disagree with the
  // folder.
  it('is per experiment, so two experiments both start at 0', async () => {
    const dir = temp_dir()
    const first = job_folder(dir, 'first')
    const second = job_folder(dir, 'second')
    const cocoa = engine(dir)
    cocoa.register(first)
    cocoa.register(second)

    expect(await cocoa.start_job(first, { size: '1' }, { gpu: '0' }, 'human')).toBe(0)
    expect(await cocoa.start_job(first, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    expect(await cocoa.start_job(second, { size: '1' }, { gpu: '0' }, 'human')).toBe(0)
    await settle(cocoa)
  })

  // The folder is portable (doc/manual/overview.md): carry it to another machine and its
  // history comes with it. A stored counter knew nothing about the runs that
  // arrived, handed out an id one of them already had, and the start wrote
  // over that run's record.
  it('does not reuse an id a carried-over folder arrived with', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'imported')
    const arrived = path.join(job, 'runs', '0')
    fs.mkdirSync(arrived, { recursive: true })
    fs.writeFileSync(
      path.join(arrived, 'run.json'),
      JSON.stringify({
        run_id: 0,
        submission_id: 'FROM-THE-OTHER-MACHINE',
        render: {},
        launch: {},
        status: 'SUCCEEDED',
        history: [],
        origin: { by: 'human' }
      })
    )

    const cocoa = engine(dir)
    cocoa.register(job)
    expect(await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    await settle(cocoa)

    const kept = JSON.parse(read_text(arrived, 'run.json')) as { submission_id: string }
    expect(kept.submission_id).toBe('FROM-THE-OTHER-MACHINE')
  })
})

describe('records are read once, at first sight', () => {
  it('fails only the corrupt run, not the history around it', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'mixed-history')
    const cocoa = engine(dir)
    cocoa.register(job)
    await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await cocoa.start_job(job, { size: '2' }, { gpu: '1' }, 'human')
    await settle(cocoa)

    hand_edit(record_path(job, 0), '{ not json')
    const reopened = engine(dir)

    const views = reopened.job(job).runs.all()
    expect(views.map((view) => view.run_id)).toEqual([1, 0])
    expect(views[1].record).toBeNull()
    expect(views[1].record_error?.message).toContain('does not parse')
    expect(views[0].record?.run_id).toBe(1)
  })

  // cocoa's own files are cocoa's alone: an outside edit to a run.json is not
  // watched for. A running engine keeps its memory; the next open reads the
  // disk once and sees whatever is there then.
  it('ignores an outside edit until the next open', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'edited-by-hand')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    const record = { ...cocoa.job(job).runs.record(run_id), status: 'CANCELLED' as const }
    hand_edit(record_path(job, run_id), JSON.stringify(record, null, 2))
    cocoa.reconcile()
    expect(cocoa.job(job).runs.record(run_id).status).toBe('STARTING')

    const reopened = engine(dir)
    expect(reopened.job(job).runs.record(run_id).status).toBe('CANCELLED')
  })
})
