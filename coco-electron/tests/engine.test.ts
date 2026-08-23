// End-to-end engine tests: real folders, real executable scripts, the whole
// convention.
//
// Memory is the truth, and coco's own files are coco's alone, so run records
// are read once when a folder is first seen and never re-scanned — the tests
// say so: an outside change to a record shows up in a reopened engine, not a
// running one. Manifests stay the user's files and are re-read every
// reconcile pass.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { load_store } from '../src/main/engine/store'
import {
  bench_folder,
  cleanup_temp_dirs,
  engine,
  exists,
  hand_edit,
  is_file,
  job_folder,
  plan_lines,
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

/** The message of a thrown call; fails loudly if it returns. */
function throws(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected a failure, but the call returned')
}

describe('job lifecycle', () => {
  it('runs a job from start through poll to report', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver-gpu')
    const coco = engine(dir)
    coco.register(job)

    const run_id = await coco.start_job(job, { size: '256' }, { gpu: '0' }, 'human')
    expect(await settle(coco)).toEqual([])

    let record = coco.job(job).runs.record(run_id)
    expect(record.status).toBe('STARTING')
    expect(record.submission_id).toBe(`sub-${run_id}`)
    expect(is_file(job, 'runs', String(run_id), 'job.sbatch')).toBe(true)
    expect(read_text(job, 'runs', String(run_id), 'job.sbatch')).toContain('--nodes=256')

    write(job, 'poll-state', 'RUNNING')
    const report = await coco.poll_job(job)
    expect(report.changed).toEqual([[run_id, 'RUNNING']])
    expect(coco.job(job).runs.record(run_id).status).toBe('RUNNING')

    write(job, 'poll-state', 'COMPLETED')
    await coco.poll_job(job)
    expect(coco.job(job).runs.record(run_id).status).toBe('COMPLETED')

    await coco.report_run(job, run_id, 'auto')
    record = coco.job(job).runs.record(run_id)
    expect(record.status).toBe('SUCCEEDED')
    expect(is_file(job, 'report', `${run_id}.txt`)).toBe(true)

    // A succeeded run cannot be cancelled.
    expect(await failure(coco.cancel_run(job, run_id))).toContain('cannot be cancelled')
  })

  // A start means "launched" (§7.1): the run exists from the moment the
  // script is spawned, and a script that then fails moves that run to ERROR
  // rather than un-happening it.
  it('lands a failed launch in ERROR and keeps the run id spent', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'broken-launch')
    write_script(job, 'launch.sh', "echo 'cluster refused' >&2\nexit 1\n")
    const coco = engine(dir)
    coco.register(job)

    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    expect(run_id).toBe(0)

    const errors = await settle(coco)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('cluster refused')

    const record = coco.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('cluster refused')

    // The failed id is consumed: the next start gets id 1, never 0.
    write_script(job, 'launch.sh', "echo 'COCO_RETURN: ok-1'\n")
    expect(await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    await settle(coco)
  })

  // The close never waits, but an answer that already arrived is still
  // collected on the way out (§10): the submission id is recorded and the
  // next open catches up on the run like any other.
  it('collects an already-landed answer when coco closes', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'close-me')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    // The script gets a moment to exit before the close — the wait is the
    // test's, standing in for a user who saw the run land; the close itself
    // waits for nothing.
    await new Promise((resolve) => setTimeout(resolve, 500))
    coco.abandon_launches()

    const record = coco.job(job).runs.record(run_id)
    expect(record.status).toBe('STARTING')
    expect(record.submission_id).toBe(`sub-${run_id}`)
  })

  // A script that has not answered by the close is killed and its run moved
  // to ERROR now, honestly — not waited on, not left for the reopen sweep
  // to guess about.
  it('abandons an unanswered launch at close as ERROR', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'hung')
    write_script(job, 'launch.sh', "sleep 30\necho 'COCO_RETURN: late'\n")
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    coco.abandon_launches()

    const record = coco.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('no longer be tracked')
  })

  // A record still "launching" in a coco that holds no script for it is a
  // previous coco's leftover (§10): the stdout that carried its submission id
  // died with that process, so refresh moves it to ERROR rather than leaving
  // a run that can never advance.
  it('sweeps a launch orphaned by a crash to ERROR on refresh', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'interrupted')
    // A slow script stands in for a coco that died mid-launch: a second
    // engine opens the same store while the first still holds the script.
    write_script(job, 'launch.sh', "sleep 5\necho 'COCO_RETURN: late'\n")
    const crashed = engine(dir)
    crashed.register(job)
    const run_id = await crashed.start_job(job, { size: '1' }, { gpu: '0' }, 'human')

    const reopened = engine(dir)
    await reopened.refresh()
    const record = reopened.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('closed')

    crashed.abandon_launches()
  })

  // A script that cannot be started at all — no interpreter, no file — is a
  // folder problem the submitter can fix now, so it refuses the start itself
  // and no run is recorded.
  it('refuses a start whose launch script cannot spawn', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'unspawnable')
    fs.rmSync(path.join(job, 'launch.sh'))
    const coco = engine(dir)
    coco.register(job)

    await failure(coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human'))
    expect(exists(job, 'runs', '0', 'run.json')).toBe(false)
  })
})

describe('run ids', () => {
  // A run id is one past the highest that experiment already has, read from
  // the records rather than from a counter. The counter this replaced could
  // disagree with the folder, and did.
  it('is per experiment, so two experiments both start at 0', async () => {
    const dir = temp_dir()
    const first = job_folder(dir, 'first')
    const second = job_folder(dir, 'second')
    const coco = engine(dir)
    coco.register(first)
    coco.register(second)

    expect(await coco.start_job(first, { size: '1' }, { gpu: '0' }, 'human')).toBe(0)
    expect(await coco.start_job(first, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    expect(await coco.start_job(second, { size: '1' }, { gpu: '0' }, 'human')).toBe(0)
    await settle(coco)
  })

  // The folder is portable (doc/coco.md): carry it to another machine and its
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

    const coco = engine(dir)
    coco.register(job)
    expect(await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    await settle(coco)

    const kept = JSON.parse(read_text(arrived, 'run.json')) as { submission_id: string }
    expect(kept.submission_id).toBe('FROM-THE-OTHER-MACHINE')
  })
})

describe('polling', () => {
  it('sets UNREACHABLE and still fails loudly when poll breaks', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'quiet')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    write_script(job, 'poll.sh', "echo 'squeue broke' >&2\nexit 3\n")
    expect(await failure(coco.poll_job(job))).toContain('squeue broke')

    const record = coco.job(job).runs.record(run_id)
    expect(record.status).toBe('UNREACHABLE')
    expect(record.reason).toContain('poll script failed')

    // A bare UNREACHABLE line leaves the run where it is.
    write_script(job, 'poll.sh', "echo 'COCO_RETURN: UNREACHABLE never mind'\n")
    await coco.poll_job(job)
    expect(coco.job(job).runs.record(run_id).status).toBe('UNREACHABLE')

    // The next good poll overwrites UNREACHABLE.
    write_script(job, 'poll.sh', "echo 'COCO_RETURN: RUNNING'\n")
    const report = await coco.poll_job(job)
    expect(report.changed).toEqual([[run_id, 'RUNNING']])
    expect(coco.job(job).runs.record(run_id).status).toBe('RUNNING')
  })

  it('ignores an unknown poll status with a warning', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'weird')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    write_script(job, 'poll.sh', "echo 'COCO_RETURN: HYPERDRIVE'\n")
    const report = await coco.poll_job(job)
    expect(report.changed).toEqual([])
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]).toContain('HYPERDRIVE')
    expect(coco.job(job).runs.record(run_id).status).toBe('STARTING')
  })
})

describe('cancel', () => {
  it('keeps the status when cancel fails and moves to CANCELLING when it works', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'cancel-me')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.poll_job(job)

    write_script(job, 'cancel.sh', "echo 'already gone' >&2\nexit 9\n")
    expect(await failure(coco.cancel_run(job, run_id))).toContain('already gone')
    expect(coco.job(job).runs.record(run_id).status).toBe('RUNNING')

    write_script(job, 'cancel.sh', 'exit 0\n')
    await coco.cancel_run(job, run_id)
    expect(coco.job(job).runs.record(run_id).status).toBe('CANCELLING')
  })
})

describe('registration', () => {
  // The entity is one the user knows and has run, so a manifest that breaks
  // later stays listed carrying the error (§11.5). Memory is the truth here,
  // so the edit lands at the next reconcile — the refresh tick's job.
  it('keeps an entity whose manifest breaks later, carrying the error', async () => {
    const dir = temp_dir()
    const folder = job_folder(dir, 'solver')
    const coco = engine(dir)
    coco.register(folder)

    write(folder, 'coco.toml', 'kind = "pipeline"\nname = "solver"\n')
    coco.reconcile()

    const jobs = coco.jobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].manifest_error).not.toBeNull()

    expect(await failure(coco.start_job(folder, {}, {}, 'human'))).toContain('kind')
  })

  // The store remembers which side a folder registered on, so a manifest
  // found broken at the next open still lands there, carrying the error.
  it('opens a job whose manifest broke while coco was closed, as a job', () => {
    const dir = temp_dir()
    const folder = job_folder(dir, 'solver')
    engine(dir).register(folder)
    write(folder, 'coco.toml', 'kind = "pipeline"\nname = "solver"\n')

    const reopened = engine(dir)
    expect(reopened.jobs().map((job) => job.path)).toEqual([folder])
    expect(reopened.benches()).toEqual([])
    expect(reopened.job(folder).manifest).toBeNull()
    expect(reopened.job(folder).manifest_error?.message).toContain('kind')
  })

  // A manifest that now declares the other kind moves the folder across,
  // and the store follows: the manifest decides, the store only remembers.
  it('moves a folder to the other side when its manifest changes kind', () => {
    const dir = temp_dir()
    const folder = job_folder(dir, 'was-a-job')
    const coco = engine(dir)
    coco.register(folder)

    const bench_manifest = path.join(bench_folder(dir, 'now-a-bench', []), 'coco.toml')
    fs.copyFileSync(bench_manifest, path.join(folder, 'coco.toml'))
    coco.reconcile()

    expect(coco.jobs()).toEqual([])
    expect(coco.benches().map((bench) => bench.path)).toEqual([folder])
    expect(coco.bench(folder).manifest?.name).toBe('now-a-bench')
    expect(load_store(path.join(dir, 'store.json'))).toEqual({ jobs: [], benches: [folder] })
  })

  // The other side of that rule: a manifest already broken when the folder is
  // picked never registers at all (§11.5).
  it('refuses a folder whose manifest is already broken', () => {
    const dir = temp_dir()
    const folder = path.join(dir, 'broken')
    fs.mkdirSync(folder, { recursive: true })
    write(folder, 'coco.toml', 'kind = "pipeline"\nname = "x"\n')

    const coco = engine(dir)
    expect(throws(() => coco.register(folder))).toContain('kind')
    expect(coco.jobs()).toEqual([])
  })

  it('refuses a second entity with a name already registered', () => {
    const dir = temp_dir()
    const first = job_folder(dir, 'same-name')
    // A different folder claiming the same name: what a copied experiment
    // looks like before anyone renames it.
    const second = job_folder(dir, 'elsewhere')
    const manifest = path.join(second, 'coco.toml')
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('elsewhere', 'same-name'))

    const coco = engine(dir)
    coco.register(first)
    expect(throws(() => coco.register(second))).toContain('already registered')
  })

  it('registers a folder once and unregisters it with its runs', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'come-and-go')
    const coco = engine(dir)
    coco.register(job)
    coco.register(job)
    expect(coco.jobs()).toHaveLength(1)

    await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    expect(coco.job(job).runs.all()).toHaveLength(1)

    coco.unregister(job)
    expect(coco.jobs()).toEqual([])
    expect(throws(() => coco.job(job))).toContain('not found')
    expect(throws(() => coco.unregister(job))).toContain('not found')
  })
})

describe('benches', () => {
  it('records members and launch failures across a fan-out', async () => {
    const dir = temp_dir()
    const good = job_folder(dir, 'good-job')
    const bad = job_folder(dir, 'bad-job')
    // A dispatch failure is a member that never spawned (§8.2). A script that
    // spawns and then fails is a member in ERROR, covered elsewhere.
    fs.rmSync(path.join(bad, 'launch.sh'))
    const bench = bench_folder(dir, 'sweep', ['good-job', 'bad-job'])

    const coco = engine(dir)
    coco.register(good)
    coco.register(bad)
    coco.register(bench)

    const start = await coco.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)
    expect(start.members).toHaveLength(1)
    expect(start.launch_failures).toHaveLength(1)
    expect(start.launch_failures[0].job).toBe('bad-job')

    // A dispatched run records which bench run and which call dispatched it.
    const member = coco.job(good).runs.record(start.members[0].run_id)
    expect(member.origin).toEqual({
      by: 'bench',
      run_id: start.run_id,
      name: 'sweep',
      call: 1
    })

    // The bench never became what the plan asked for: ERROR, eventually.
    write(good, 'poll-state', 'COMPLETED')
    await coco.poll_job(good)
    await coco.report_run(good, start.members[0].run_id, 'auto')
    const status = coco.bench_status(bench, start.run_id)
    expect(status.status).toBe('ERROR')
    expect(status.succeeded).toBe(1)
  })

  it('refuses a bench report unless every member succeeded', async () => {
    const dir = temp_dir()
    const good = job_folder(dir, 'ok-job')
    const bench = bench_folder(dir, 'nightly', ['ok-job'])
    const coco = engine(dir)
    coco.register(good)
    coco.register(bench)
    const start = await coco.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)

    write(good, 'poll-state', 'FAILED no convergence')
    await coco.poll_job(good)
    const status = coco.bench_status(bench, start.run_id)
    expect(status.status).toBe('FAILED')
    expect(status.failed).toBe(1)

    expect(await failure(coco.bench_report(bench, start.run_id))).toContain('no bench report')
    expect(exists(bench, 'report', `${start.run_id}.txt`)).toBe(false)
  })

  it('reports when every member succeeded', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'sweep-job')
    const bench = bench_folder(dir, 'nightly', ['sweep-job'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)

    expect(coco.bench_status(bench, start.run_id).status).toBe('STARTING')

    write(job, 'poll-state', 'COMPLETED')
    await coco.poll_job(job)
    await coco.report_run(job, start.members[0].run_id, 'auto')
    expect(coco.bench_status(bench, start.run_id).status).toBe('ANALYZING')

    await coco.bench_report(bench, start.run_id)
    expect(coco.bench_status(bench, start.run_id).status).toBe('SUCCEEDED')
    expect(is_file(bench, 'runs', String(start.run_id), 'members.json')).toBe(true)
    expect(is_file(bench, 'report', `${start.run_id}.txt`)).toBe(true)
  })

  // A plan is generated, so its mistakes arrive in batches. Every call is
  // checked and every bad one is named, rather than the user fixing one,
  // starting again, and meeting the next (§8.1).
  it('names every bad plan call at once', async () => {
    const dir = temp_dir()
    const good = job_folder(dir, 'good-job')
    const bench = bench_folder(dir, 'sweep', ['good-job'])
    plan_lines(bench, [
      '{"job": "ghost", "params": {}}',
      '{"job": "good-job", "params": {"size": "1", "gpu": "0"}}',
      '{"job": "phantom", "params": {}}',
      '{"job": "good-job", "params": {"size": "1"}}'
    ])
    const coco = engine(dir)
    coco.register(good)
    coco.register(bench)

    const message = await failure(coco.start_bench(bench, { mesh: 'fine' }, 'human'))

    // Three of the four calls are bad, and all three are named — including
    // the last, which an abort-on-first check would never have reached.
    expect(message).toContain('3 of 4')
    expect(message).toContain('call 1')
    expect(message).toContain('call 3')
    expect(message).toContain('call 4')
    expect(message).not.toContain('call 2')
    expect(coco.bench(bench).runs.all()).toEqual([])
  })

  it('dispatches nothing when the plan is invalid', async () => {
    const dir = temp_dir()
    const bench = bench_folder(dir, 'broken-plan', [])
    plan_lines(bench, ['{"job": "ghost", "params": {}}'])
    const coco = engine(dir)
    coco.register(bench)

    const message = await failure(coco.start_bench(bench, { mesh: 'fine' }, 'human'))
    expect(message).toContain('not a registered job')
    expect(coco.bench(bench).runs.all()).toEqual([])
  })
})

describe('reports', () => {
  it('heals a failed auto report when asked again by hand', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'flaky-report')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'COMPLETED')
    await coco.poll_job(job)

    write(job, 'report-state', 'fail')
    expect(await failure(coco.report_run(job, run_id, 'auto'))).toContain('exploded')
    const record = coco.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('exploded')

    fs.rmSync(path.join(job, 'report-state'))
    await coco.report_run(job, run_id, 'manual')
    expect(coco.job(job).runs.record(run_id).status).toBe('SUCCEEDED')
    expect(is_file(job, 'report', `${run_id}.txt`)).toBe(true)
  })
})

describe('records are read once, at first sight', () => {
  it('fails only the corrupt run, not the history around it', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'mixed-history')
    const coco = engine(dir)
    coco.register(job)
    await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await coco.start_job(job, { size: '2' }, { gpu: '1' }, 'human')
    await settle(coco)

    hand_edit(record_path(job, 0), '{ not json')
    const reopened = engine(dir)

    const views = reopened.job(job).runs.all()
    expect(views.map((view) => view.run_id)).toEqual([1, 0])
    expect(views[1].record).toBeNull()
    expect(views[1].record_error?.message).toContain('does not parse')
    expect(views[0].record?.run_id).toBe(1)
  })

  // coco's own files are coco's alone: an outside edit to a run.json is not
  // watched for. A running engine keeps its memory; the next open reads the
  // disk once and sees whatever is there then.
  it('ignores an outside edit until the next open', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'edited-by-hand')
    const coco = engine(dir)
    coco.register(job)
    const run_id = await coco.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    const record = { ...coco.job(job).runs.record(run_id), status: 'CANCELLED' as const }
    hand_edit(record_path(job, run_id), JSON.stringify(record, null, 2))
    coco.reconcile()
    expect(coco.job(job).runs.record(run_id).status).toBe('STARTING')

    const reopened = engine(dir)
    expect(reopened.job(job).runs.record(run_id).status).toBe('CANCELLED')
  })
})

describe('parameters', () => {
  // Every declared parameter must be supplied by hand (§2.1). The start form
  // sends one entry per declared name whether or not the user typed in it, so
  // a present-but-blank value must be refused exactly like a missing one —
  // otherwise a job launches with no arguments at all.
  it('refuses blank parameter values', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver-gpu')
    const coco = engine(dir)
    coco.register(job)

    // Every field left empty, which is what an untouched start form sends.
    expect(await failure(coco.start_job(job, { size: '' }, { gpu: '' }, 'human'))).toContain('size')

    // One field filled, the other blank or whitespace.
    expect(await failure(coco.start_job(job, { size: '256' }, { gpu: '  ' }, 'human'))).toContain(
      'gpu'
    )

    // Nothing was launched, and no run id was burned on a refused start.
    expect(exists(job, 'runs')).toBe(false)

    // The same start with real values goes through.
    await coco.start_job(job, { size: '256' }, { gpu: '0' }, 'human')
    await settle(coco)
  })

  // Every shape, end to end (§2.1, §6): a list reaches the launch script as
  // the `--name value` pair repeated, and the template with its shape kept,
  // so `{% for %}` can walk it. A yes/no is an enum of the words and its
  // value a string — so a template branches on `== "true"`, never the bare
  // name, which is a non-empty string and always true.
  it('carries every shape to the script as pairs and to the template as itself', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'shapes')
    write(
      job,
      'coco.toml',
      fs
        .readFileSync(path.join(job, 'coco.toml'), 'utf8')
        .replace(
          '[[launch.params]]\nname        = "gpu"\ntype        = "string"\ndescription = "Which GPU to pin to"\n',
          '[[launch.params]]\nname = "gpu"\ntype = "enum"\nvalues = ["0", "1"]\ndescription = "x"\n' +
            '[[launch.params]]\nname = "profile"\ntype = "enum"\nvalues = ["true", "false"]\ndescription = "x"\n' +
            '[[launch.params]]\nname = "tags"\ntype = "string"\nlist = true\ndescription = "x"\n'
        )
        .replace(
          '[[render.params]]\nname        = "size"\ntype        = "string"\ndescription = "Nodes to request"\n',
          '[[render.params]]\nname = "size"\ntype = "string"\ndescription = "x"\n' +
            '[[render.params]]\nname = "fast"\ntype = "enum"\nvalues = ["true", "false"]\ndescription = "x"\n' +
            '[[render.params]]\nname = "backends"\ntype = "enum"\nvalues = ["cuda", "hip"]\nlist = true\ndescription = "x"\n'
        )
    )
    write(
      job,
      'job.sbatch.tmpl',
      '#SBATCH --nodes={{ size }}\n{% if fast == "true" %}--fast{% endif %}\n{% for b in backends %}--{{ b }} {% endfor %}\n'
    )
    write_script(job, 'launch.sh', 'printf \'%s\\n\' "$@" > argv\necho "COCO_RETURN: sub"\n')
    const coco = engine(dir)
    coco.register(job)

    const run_id = await coco.start_job(
      job,
      { size: '2', fast: 'true', backends: ['hip', 'cuda'] },
      { gpu: '1', profile: 'false', tags: ['a', 'b'] },
      'human'
    )
    await settle(coco)

    const argv = fs.readFileSync(path.join(job, 'argv'), 'utf8').trimEnd().split('\n')
    expect(argv).toEqual([
      '--script',
      `runs/${run_id}/job.sbatch`,
      '--run',
      String(run_id),
      '--gpu',
      '1',
      '--profile',
      'false',
      '--tags',
      'a',
      '--tags',
      'b'
    ])
    expect(fs.readFileSync(path.join(job, 'runs', String(run_id), 'job.sbatch'), 'utf8')).toBe(
      '#SBATCH --nodes=2\n--fast\n--hip --cuda \n'
    )
    // The record keeps the shapes too: what a Start over would send again.
    expect(coco.job(job).runs.record(run_id).launch).toEqual({
      gpu: '1',
      profile: 'false',
      tags: ['a', 'b']
    })

    // A wrong shape is refused with every fault named, nothing launched.
    const message = await failure(
      coco.start_job(
        job,
        { size: '2', fast: true, backends: [] },
        { gpu: '2', profile: 'false', tags: 'a' },
        'human'
      )
    )
    expect(message).toContain('`fast` must be one of `true`, `false`')
    expect(message).toContain('`backends` must list at least one value')
  })
})
