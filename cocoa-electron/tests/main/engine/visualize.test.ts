import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../../src/main/engine/engine'
import type { EngineError } from '../../../src/main/engine/errors'
import { build_world } from '../../../src/main/engine/world'
import { engine, settle } from '../../support/engine'
import { exists, read_text, write, write_script } from '../../support/files'
import { campaign_folder, job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

/**
 * Gives the folder a `[visualize]` script that writes its arguments to
 * `visualized`, then exits with whatever `visualize-exit` holds (0 without it).
 */
function with_visualize(folder: string): void {
  fs.appendFileSync(path.join(folder, 'cocoa.toml'), '\n[visualize]\ncommand = "./visualize.sh"\n')
  write_script(
    folder,
    'visualize.sh',
    [
      'echo "$@" > visualized',
      'code=$(cat visualize-exit 2>/dev/null || echo 0)',
      '[ "$code" = 0 ] || echo "no display to open" >&2',
      'exit "$code"',
      ''
    ].join('\n')
  )
}

async function completed_run(cocoa: Engine, job: string): Promise<number> {
  const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
  await settle(cocoa)
  write(job, 'poll-state', 'COMPLETED')
  await cocoa.poll_job(job)
  return run_id
}

async function visualized(folder: string): Promise<string> {
  await vi.waitFor(() => expect(exists(folder, 'visualized')).toBe(true))
  return read_text(folder, 'visualized').trim()
}

describe('visualize', () => {
  it('opens a reported run with its report and attachment directories, in the folder', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'viewed')
    with_visualize(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)

    expect(build_world(cocoa, null).job_runs[job][String(run_id)].visualizable).toBe(false)
    await cocoa.report_run(job, run_id, 'auto')
    expect(build_world(cocoa, null).job_runs[job][String(run_id)].visualizable).toBe(true)

    const failures: EngineError[] = []
    await cocoa.visualize(job, run_id, (error) => failures.push(error))
    expect(await visualized(job)).toBe(
      `--run ${run_id} --report-dir report --attachment-dir runs/${run_id}/report/attachment`
    )
    expect(failures).toEqual([])
  })

  it('refuses a run with no report, and an experiment with no visualize script', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'unviewed')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)
    await cocoa.report_run(job, run_id, 'auto')

    await expect(cocoa.visualize(job, run_id, () => {})).rejects.toThrow(
      '`unviewed` has no visualize script'
    )
    expect(build_world(cocoa, null).job_runs[job][String(run_id)].visualizable).toBe(false)

    const viewed = job_folder(dir, 'viewed')
    with_visualize(viewed)
    cocoa.register(viewed)
    const running = await cocoa.start_job(viewed, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    await expect(cocoa.visualize(viewed, running, () => {})).rejects.toThrow(
      `run ${running} has no report to visualize`
    )
    await expect(cocoa.visualize(viewed, 99, () => {})).rejects.toThrow('not found')
  })

  it('says when the viewer exits non-zero, with what it printed', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'broken-viewer')
    with_visualize(job)
    write(job, 'visualize-exit', '3')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)
    await cocoa.report_run(job, run_id, 'auto')

    const failure = await new Promise<EngineError>((resolve) => {
      void cocoa.visualize(job, run_id, resolve)
    })
    expect(failure.message).toBe('`./visualize.sh` exited 3: no display to open')
  })

  it('refuses a viewer that cannot be started at all', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'missing-viewer')
    with_visualize(job)
    fs.rmSync(path.join(job, 'visualize.sh'))
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)
    await cocoa.report_run(job, run_id, 'auto')

    await expect(cocoa.visualize(job, run_id, () => {})).rejects.toThrow('ENOENT')
  })

  it('opens a campaign run once its report has landed', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'nightly', ['member'])
    with_visualize(campaign)
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, start.members[0].run_id, 'auto')

    expect(
      build_world(cocoa, null).campaign_runs[campaign][String(start.run_id)].visualizable
    ).toBe(false)
    await cocoa.campaign_report(campaign, start.run_id)
    expect(
      build_world(cocoa, null).campaign_runs[campaign][String(start.run_id)].visualizable
    ).toBe(true)

    await cocoa.visualize(campaign, start.run_id, () => {})
    expect(await visualized(campaign)).toBe(
      `--run ${start.run_id} --report-dir report --attachment-dir runs/${start.run_id}/report/attachment`
    )
  })
})
