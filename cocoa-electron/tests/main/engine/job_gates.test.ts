import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../support/engine'
import { write } from '../../support/files'
import { job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'
import { deploys } from '../../support/fixtures'

afterEach(cleanup_temp_dirs)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('one job is checked and deployed by one start at a time', () => {
  it('holds a second start until the first one’s deploy lands, then checks afresh', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    write(job, 'check-state', 'STALE')
    write(job, 'deploy-hold', '')

    const first = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    let second_id: number | null = null
    const second = cocoa.start_job(job, { size: '2' }, { gpu: '0' }, 'agent').then((id) => {
      second_id = id
      return id
    })
    await sleep(200)
    expect(second_id).toBeNull()

    fs.rmSync(path.join(job, 'deploy-hold'))
    expect(await settle(cocoa)).toEqual([])
    const id = await second
    expect(await settle(cocoa)).toEqual([])

    // The deploy left the job current, so the second start launched as is.
    expect(deploys(job)).toBe(1)
    expect(cocoa.job(job).runs.record(first).deploy?.check).toBe('STALE')
    expect(cocoa.job(job).runs.record(id).deploy).toEqual({ check: 'CURRENT' })
    expect(cocoa.job(job).runs.record(id).submission_id).toBe(`sub-${id}`)
  })
})
