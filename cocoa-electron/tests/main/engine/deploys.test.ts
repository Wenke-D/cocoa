import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../support/engine'
import { write } from '../../support/files'
import { job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('a deploy that fails', () => {
  it('moves the run to ERROR with the script’s output, and raises it', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    write(job, 'check-state', 'STALE')
    write(job, 'deploy-state', 'fail')

    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    expect(await settle(cocoa)).toEqual(['`./deploy.sh` exited 1: deploy broke'])

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.submission_id).toBe('')
    expect(record.error).toBe('deploy failed: `./deploy.sh` exited 1: deploy broke')
    expect(record.deploy).toMatchObject({ check: 'STALE', error: 'deploy broke' })
    // Never launched, so there is no submission and nothing to poll.
    expect(cocoa.launches_in_flight()).toBe(0)
  })
})

describe('a deploy cocoa did not see through', () => {
  it('is an ERROR at the next session’s first tick, or at the close', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    write(job, 'check-state', 'STALE')
    write(job, 'deploy-hold', '')
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    // A second engine over the same store is the next session after a
    // crash: it holds no deploy, so nothing will ever launch the run.
    const next = engine(dir)
    await next.refresh()
    const record = next.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toBe(
      'cocoa closed while the deploy script was running; the run was never launched'
    )

    // And the session that is still holding the deploy, closing, says so on
    // the record itself — and lets the gate go.
    cocoa.abandon_launches()
    expect(cocoa.job(job).runs.record(run_id).status).toBe('ERROR')
    expect(cocoa.job(job).runs.record(run_id).error).toBe(
      'cocoa closed before the deploy finished; the run was never launched'
    )
    expect(cocoa.deploys.count()).toBe(0)
    fs.rmSync(path.join(job, 'deploy-hold'))
  })
})
