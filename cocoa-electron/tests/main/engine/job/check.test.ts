// A start's check and deploy (convention §7.5, §7.6): `CURRENT` launches,
// `STALE` deploys first, `CONFLICT` refuses — and one job is checked and
// deployed by one start at a time. Driven through the job fixture's
// `check-state`, `deploy-hold` and `deploy-state` files.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunRecord } from '../../../../src/main/engine/record'
import { engine, settle } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { exists, write, write_script } from '../../../support/files'
import { job_folder } from '../../../support/fixtures'
import { record_path } from '../../../support/run_paths'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'
import { deploys } from '../../../support/fixtures'

afterEach(cleanup_temp_dirs)

describe('a start checks its job first', () => {
  it('launches a CURRENT job at once, deploying nothing', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)

    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    expect(await settle(cocoa)).toEqual([])

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('STARTING')
    expect(record.submission_id).toBe(`sub-${run_id}`)
    expect(record.deploy).toEqual({ check: 'CURRENT' })
    expect(deploys(job)).toBe(0)
  })

  it('deploys a STALE job, holding the run DEPLOYING, then launches it', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    write(job, 'check-state', 'STALE solver.cfg changed')
    write(job, 'deploy-hold', '')

    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    // On disk at once, before the deploy is done: a start means the run exists.
    const on_disk = JSON.parse(fs.readFileSync(record_path(job, run_id), 'utf8')) as RunRecord
    expect(on_disk.status).toBe('DEPLOYING')
    expect(on_disk.deploy).toEqual({ check: 'STALE', reason: 'solver.cfg changed' })
    expect(on_disk.submission_id).toBe('')

    // A tick while the deploy runs neither launches it nor takes it for a
    // previous session's leftover.
    await cocoa.refresh()
    expect(cocoa.job(job).runs.record(run_id).status).toBe('DEPLOYING')

    fs.rmSync(path.join(job, 'deploy-hold'))
    expect(await settle(cocoa)).toEqual([])

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.history.map((change) => change.status)).toEqual(['DEPLOYING', 'STARTING'])
    expect(record.submission_id).toBe(`sub-${run_id}`)
    expect(record.deploy?.at).toBeDefined()
    expect(record.deploy?.error).toBeUndefined()
    expect(deploys(job)).toBe(1)
  })

  it('refuses a CONFLICT with the check’s reason, leaving nothing behind', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    write(job, 'check-state', 'CONFLICT solver binary in use by run 3')

    const message = await failure(cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human'))
    expect(message).toBe(
      '`solver` cannot start now: deploying it would conflict — solver binary in use by run 3'
    )
    expect(cocoa.job(job).runs.all()).toEqual([])
    expect(exists(job, 'runs', '0')).toBe(false)
    expect(deploys(job)).toBe(0)
  })

  it('refuses a start whose check cannot say, naming the script', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    const start = (): Promise<number> => cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    write_script(job, 'check.sh', 'echo "cluster down" >&2\nexit 3\n')
    expect(await failure(start())).toBe('`./check.sh` exited 3: cluster down')

    write_script(job, 'check.sh', 'echo "just logging"\n')
    expect(await failure(start())).toBe(
      '`./check.sh` answered nothing; a check answers exactly one line'
    )

    write_script(job, 'check.sh', 'echo "COCOA_RETURN: CURRENT"\necho "COCOA_RETURN: STALE"\n')
    expect(await failure(start())).toBe(
      '`./check.sh` answered 2 lines; a check answers exactly one line'
    )

    write_script(job, 'check.sh', 'echo "COCOA_RETURN: FRESH"\n')
    expect(await failure(start())).toBe(
      '`./check.sh` answered `FRESH`; a check answers CURRENT, STALE or CONFLICT'
    )

    expect(cocoa.job(job).runs.all()).toEqual([])
  })

  it('refuses a bad value before running the check at all', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    write_script(job, 'check.sh', 'echo ran >> check-ran\necho "COCOA_RETURN: CURRENT"\n')

    await failure(cocoa.start_job(job, { size: ' ' }, { gpu: '0' }, 'human'))
    expect(exists(job, 'check-ran')).toBe(false)
  })
})
