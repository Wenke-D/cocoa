// A start's check and deploy (convention §7.5, §7.6): `CURRENT` launches,
// `STALE` deploys first, `CONFLICT` refuses — and one job is checked and
// deployed by one start at a time. Driven through the job fixture's
// `check-state`, `deploy-hold` and `deploy-state` files.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunRecord } from '../src/main/engine/record'
import {
  bench_folder,
  cleanup_temp_dirs,
  engine,
  exists,
  job_folder,
  read_text,
  record_path,
  settle,
  temp_dir,
  write,
  write_script
} from './support'

afterEach(cleanup_temp_dirs)

/** The message of a rejected promise; fails loudly if it resolves. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected a failure, but the operation succeeded')
}

/** How many times the fixture's deploy has run. */
function deploys(job: string): number {
  return exists(job, 'deploys') ? read_text(job, 'deploys').trim().split('\n').length : 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

  it('refuses to cancel a run that is waiting on its deploy', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    write(job, 'check-state', 'STALE')
    write(job, 'deploy-hold', '')

    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    expect(await failure(cocoa.cancel_run(job, run_id))).toBe(
      `run ${run_id} is waiting on its job’s deploy; there is no submission to cancel until it launches`
    )
    fs.rmSync(path.join(job, 'deploy-hold'))
    await settle(cocoa)
  })
})

describe('a bench start', () => {
  it('checks each job once and deploys a stale one once for all its members', async () => {
    const dir = temp_dir()
    const solver = job_folder(dir, 'solver')
    const other = job_folder(dir, 'other')
    const bench = bench_folder(dir, 'sweep', ['solver', 'other', 'solver'])
    const cocoa = engine(dir)
    for (const folder of [solver, other, bench]) {
      cocoa.register(folder)
    }
    write(solver, 'check-state', 'STALE')
    write(solver, 'deploy-hold', '')
    write_script(other, 'check.sh', 'echo ran >> check-ran\necho "COCOA_RETURN: CURRENT"\n')

    const start = await cocoa.start_bench(bench, { mesh: 'fine' }, 'human')
    expect(start.launch_failures).toEqual([])
    // Plan order is kept, whichever job was dispatched first.
    expect(start.members.map((member) => member.job)).toEqual(['solver', 'other', 'solver'])
    const [a, b, c] = start.members
    expect(cocoa.job(solver).runs.record(a.run_id).status).toBe('DEPLOYING')
    expect(cocoa.job(solver).runs.record(c.run_id).status).toBe('DEPLOYING')
    expect(cocoa.job(other).runs.record(b.run_id).deploy).toEqual({ check: 'CURRENT' })
    expect(read_text(other, 'check-ran').trim().split('\n')).toHaveLength(1)

    fs.rmSync(path.join(solver, 'deploy-hold'))
    expect(await settle(cocoa)).toEqual([])
    expect(deploys(solver)).toBe(1)
    for (const member of [a, c]) {
      const record = cocoa.job(solver).runs.record(member.run_id)
      expect(record.submission_id).toBe(`sub-${member.run_id}`)
      expect(record.origin).toMatchObject({ by: 'bench', run_id: start.run_id })
    }
  })

  it('reads STARTING while its members wait on a deploy', async () => {
    const dir = temp_dir()
    const solver = job_folder(dir, 'solver')
    const bench = bench_folder(dir, 'sweep', ['solver', 'solver'])
    const cocoa = engine(dir)
    cocoa.register(solver)
    cocoa.register(bench)
    write(solver, 'check-state', 'STALE')
    write(solver, 'deploy-hold', '')

    const start = await cocoa.start_bench(bench, { mesh: 'fine' }, 'human')
    expect(cocoa.bench_status(bench, start.run_id).status).toBe('STARTING')

    // A cancel cannot pass over members that will launch later in silence.
    const cancels = await cocoa.cancel_bench(bench, start.run_id)
    expect(cancels.map((cancel) => cancel.ok)).toEqual([false, false])

    fs.rmSync(path.join(solver, 'deploy-hold'))
    await settle(cocoa)
  })

  it('refuses the whole bench when any job’s check refuses, naming every one', async () => {
    const dir = temp_dir()
    const solver = job_folder(dir, 'solver')
    const other = job_folder(dir, 'other')
    const third = job_folder(dir, 'third')
    const bench = bench_folder(dir, 'sweep', ['solver', 'other', 'third'])
    const cocoa = engine(dir)
    for (const folder of [solver, other, third, bench]) {
      cocoa.register(folder)
    }
    write(solver, 'check-state', 'CONFLICT run 4 is reading the binary')
    write(other, 'check-state', 'STALE')
    write_script(third, 'check.sh', 'exit 2\n')

    const message = await failure(cocoa.start_bench(bench, { mesh: 'fine' }, 'human'))
    expect(message).toContain('the bench cannot start, nothing was dispatched')
    expect(message).toContain('job `solver`: `solver` cannot start now')
    expect(message).toContain('run 4 is reading the binary')
    expect(message).toContain('job `third`: `./check.sh` exited 2')
    expect(message).not.toContain('`other`')

    for (const folder of [solver, other, third]) {
      expect(cocoa.job(folder).runs.all()).toEqual([])
    }
    expect(cocoa.bench(bench).runs.all()).toEqual([])
    expect(deploys(other)).toBe(0)

    // The refusal let every gate go: each job starts again at once.
    write(solver, 'check-state', 'CURRENT')
    await cocoa.start_job(solver, { size: '1' }, { gpu: '0' }, 'human')
    await cocoa.start_job(other, { size: '1' }, { gpu: '0' }, 'human')
    expect(await settle(cocoa)).toEqual([])
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
