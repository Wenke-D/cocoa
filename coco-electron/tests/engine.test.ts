// End-to-end engine tests: real folders, real executable scripts, the whole
// convention. Ported from the Rust suite (`tests/coco_engine.rs`) so the two
// engines answer the same scenarios the same way.
//
// Where the TypeScript engine deliberately differs — memory is the truth, so
// an outside edit lands at the next reconcile rather than at the next read —
// the test says so and reconciles explicitly, which is what the 3s refresh
// tick does in the app.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  benchFolder,
  cleanupTempDirs,
  engine,
  exists,
  handEdit,
  isFile,
  jobFolder,
  planLines,
  readText,
  recordPath,
  settle,
  tempDir,
  write,
  writeScript
} from './support'

afterEach(cleanupTempDirs)

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
    const dir = tempDir()
    const job = jobFolder(dir, 'solver-gpu')
    const coco = engine(dir)
    coco.register(job)

    const runId = await coco.startJob(job, { size: '256' }, { gpu: '0' }, 'human')
    expect(await settle(coco)).toEqual([])

    let record = coco.runRecord(job, runId)
    expect(record.status).toBe('STARTING')
    expect(record.submission_id).toBe(`sub-${runId}`)
    expect(isFile(job, 'runs', String(runId), 'job.sbatch')).toBe(true)
    expect(readText(job, 'runs', String(runId), 'job.sbatch')).toContain('--nodes=256')

    write(job, 'poll-state', 'RUNNING')
    const report = await coco.pollJob(job)
    expect(report.changed).toEqual([[runId, 'RUNNING']])
    expect(coco.runRecord(job, runId).status).toBe('RUNNING')

    write(job, 'poll-state', 'COMPLETED')
    await coco.pollJob(job)
    expect(coco.runRecord(job, runId).status).toBe('COMPLETED')

    await coco.reportRun(job, runId, 'auto')
    record = coco.runRecord(job, runId)
    expect(record.status).toBe('SUCCEEDED')
    expect(isFile(job, 'report', `${runId}.txt`)).toBe(true)

    // A succeeded run cannot be cancelled.
    expect(await failure(coco.cancelRun(job, runId))).toContain('cannot be cancelled')
  })

  // A start means "launched" (§7.1): the run exists from the moment the
  // script is spawned, and a script that then fails moves that run to ERROR
  // rather than un-happening it.
  it('lands a failed launch in ERROR and keeps the run id spent', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'broken-launch')
    writeScript(job, 'launch.sh', "echo 'cluster refused' >&2\nexit 1\n")
    const coco = engine(dir)
    coco.register(job)

    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    expect(runId).toBe(0)

    const errors = await settle(coco)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('cluster refused')

    const record = coco.runRecord(job, runId)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('cluster refused')

    // The failed id is consumed: the next start gets id 1, never 0.
    writeScript(job, 'launch.sh', "echo 'COCO_RETURN: ok-1'\n")
    expect(await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    await settle(coco)
  })

  // Closing coco right after a start is normal (§10): the launch script gets
  // its moment to land, so the submission id is recorded and the next open
  // catches up on the run instead of finding an orphan.
  it('records the submission when coco closes right after a start', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'close-me')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')

    await coco.shutdownLaunches(5_000)

    const record = coco.runRecord(job, runId)
    expect(record.status).toBe('STARTING')
    expect(record.submission_id).toBe(`sub-${runId}`)
  })

  // A script still running past the shutdown grace is killed and its run
  // moved to ERROR now, honestly, rather than left for the reopen sweep to
  // guess about.
  it('abandons a launch hung past the shutdown grace as ERROR', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'hung')
    writeScript(job, 'launch.sh', "sleep 30\necho 'COCO_RETURN: late'\n")
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')

    await coco.shutdownLaunches(50)

    const record = coco.runRecord(job, runId)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('abandoned')
  })

  // A record still "launching" in a coco that holds no script for it is a
  // previous coco's leftover (§10): the stdout that carried its submission id
  // died with that process, so refresh moves it to ERROR rather than leaving
  // a run that can never advance.
  it('sweeps a launch orphaned by a crash to ERROR on refresh', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'interrupted')
    // A slow script stands in for a coco that died mid-launch: a second
    // engine opens the same store while the first still holds the script.
    writeScript(job, 'launch.sh', "sleep 5\necho 'COCO_RETURN: late'\n")
    const crashed = engine(dir)
    crashed.register(job)
    const runId = await crashed.startJob(job, { size: '1' }, { gpu: '0' }, 'human')

    const reopened = engine(dir)
    await reopened.refresh()
    const record = reopened.runRecord(job, runId)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('closed')

    await crashed.shutdownLaunches(0)
  })

  // A script that cannot be started at all — no interpreter, no file — is a
  // folder problem the submitter can fix now, so it refuses the start itself
  // and no run is recorded.
  it('refuses a start whose launch script cannot spawn', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'unspawnable')
    fs.rmSync(path.join(job, 'launch.sh'))
    const coco = engine(dir)
    coco.register(job)

    await failure(coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human'))
    expect(exists(job, 'runs', '0', 'run.json')).toBe(false)
  })
})

describe('run ids', () => {
  // A run id is one past the highest that experiment already has, read from
  // the records rather than from a counter. The counter this replaced could
  // disagree with the folder, and did.
  it('is per experiment, so two experiments both start at 0', async () => {
    const dir = tempDir()
    const first = jobFolder(dir, 'first')
    const second = jobFolder(dir, 'second')
    const coco = engine(dir)
    coco.register(first)
    coco.register(second)

    expect(await coco.startJob(first, { size: '1' }, { gpu: '0' }, 'human')).toBe(0)
    expect(await coco.startJob(first, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    expect(await coco.startJob(second, { size: '1' }, { gpu: '0' }, 'human')).toBe(0)
    await settle(coco)
  })

  // The folder is portable (doc/coco.md): carry it to another machine and its
  // history comes with it. A stored counter knew nothing about the runs that
  // arrived, handed out an id one of them already had, and the start wrote
  // over that run's record.
  it('does not reuse an id a carried-over folder arrived with', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'imported')
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
    expect(await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    await settle(coco)

    const kept = JSON.parse(readText(arrived, 'run.json')) as { submission_id: string }
    expect(kept.submission_id).toBe('FROM-THE-OTHER-MACHINE')
  })
})

describe('polling', () => {
  it('sets UNREACHABLE and still fails loudly when poll breaks', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'quiet')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    writeScript(job, 'poll.sh', "echo 'squeue broke' >&2\nexit 3\n")
    expect(await failure(coco.pollJob(job))).toContain('squeue broke')

    const record = coco.runRecord(job, runId)
    expect(record.status).toBe('UNREACHABLE')
    expect(record.reason).toContain('poll script failed')

    // A bare UNREACHABLE line leaves the run where it is.
    writeScript(job, 'poll.sh', "subs='' ; echo 'COCO_RETURN: UNREACHABLE never mind'\n")
    await coco.pollJob(job)
    expect(coco.runRecord(job, runId).status).toBe('UNREACHABLE')

    // The next good poll overwrites UNREACHABLE.
    writeScript(job, 'poll.sh', "echo 'COCO_RETURN: sub-0 RUNNING'\n")
    const report = await coco.pollJob(job)
    expect(report.changed).toEqual([[runId, 'RUNNING']])
    expect(coco.runRecord(job, runId).status).toBe('RUNNING')
  })

  it('ignores an unknown poll status with a warning', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'weird')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    writeScript(job, 'poll.sh', "echo 'COCO_RETURN: sub-0 HYPERDRIVE'\n")
    const report = await coco.pollJob(job)
    expect(report.changed).toEqual([])
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]).toContain('HYPERDRIVE')
    expect(coco.runRecord(job, runId).status).toBe('STARTING')
  })
})

describe('cancel', () => {
  it('keeps the status when cancel fails and moves to CANCELLING when it works', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'cancel-me')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.pollJob(job)

    writeScript(job, 'cancel.sh', "echo 'already gone' >&2\nexit 9\n")
    expect(await failure(coco.cancelRun(job, runId))).toContain('already gone')
    expect(coco.runRecord(job, runId).status).toBe('RUNNING')

    writeScript(job, 'cancel.sh', 'exit 0\n')
    await coco.cancelRun(job, runId)
    expect(coco.runRecord(job, runId).status).toBe('CANCELLING')
  })
})

describe('registration', () => {
  // The entity is one the user knows and has run, so a manifest that breaks
  // later stays listed carrying the error (§11.5). Memory is the truth here,
  // so the edit lands at the next reconcile — the refresh tick's job.
  it('keeps an entity whose manifest breaks later, carrying the error', async () => {
    const dir = tempDir()
    const folder = jobFolder(dir, 'solver')
    const coco = engine(dir)
    coco.register(folder)

    write(folder, 'coco.toml', 'kind = "pipeline"\nname = "solver"\n')
    coco.reconcile()

    const views = coco.entities()
    expect(views).toHaveLength(1)
    expect(views[0].manifestError).not.toBeNull()

    expect(await failure(coco.startJob(folder, {}, {}, 'human'))).toContain('kind')
  })

  // The other side of that rule: a manifest already broken when the folder is
  // picked never registers at all (§11.5).
  it('refuses a folder whose manifest is already broken', () => {
    const dir = tempDir()
    const folder = path.join(dir, 'broken')
    fs.mkdirSync(folder, { recursive: true })
    write(folder, 'coco.toml', 'kind = "pipeline"\nname = "x"\n')

    const coco = engine(dir)
    expect(throws(() => coco.register(folder))).toContain('kind')
    expect(coco.entities()).toEqual([])
  })

  it('refuses a second entity with a name already registered', () => {
    const dir = tempDir()
    const first = jobFolder(dir, 'same-name')
    // A different folder claiming the same name: what a copied experiment
    // looks like before anyone renames it.
    const second = jobFolder(dir, 'elsewhere')
    const manifest = path.join(second, 'coco.toml')
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('elsewhere', 'same-name'))

    const coco = engine(dir)
    coco.register(first)
    expect(throws(() => coco.register(second))).toContain('already registered')
  })

  it('registers a folder once and unregisters it with its runs', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'come-and-go')
    const coco = engine(dir)
    coco.register(job)
    coco.register(job)
    expect(coco.entities()).toHaveLength(1)

    await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    expect(coco.jobRuns(job)).toHaveLength(1)

    coco.unregister(job)
    expect(coco.entities()).toEqual([])
    expect(coco.jobRuns(job)).toEqual([])
    expect(throws(() => coco.unregister(job))).toContain('not found')
  })
})

describe('benches', () => {
  it('records members and launch failures across a fan-out', async () => {
    const dir = tempDir()
    const good = jobFolder(dir, 'good-job')
    const bad = jobFolder(dir, 'bad-job')
    // A dispatch failure is a member that never spawned (§8.2). A script that
    // spawns and then fails is a member in ERROR, covered elsewhere.
    fs.rmSync(path.join(bad, 'launch.sh'))
    const bench = benchFolder(dir, 'sweep', ['good-job', 'bad-job'])

    const coco = engine(dir)
    coco.register(good)
    coco.register(bad)
    coco.register(bench)

    const start = await coco.startBench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)
    expect(start.members).toHaveLength(1)
    expect(start.launchFailures).toHaveLength(1)
    expect(start.launchFailures[0].job).toBe('bad-job')

    // A dispatched run records which bench run and which call dispatched it.
    const member = coco.runRecord(good, start.members[0].run_id)
    expect(member.origin).toEqual({
      by: 'bench',
      run_id: start.runId,
      name: 'sweep',
      call: 1
    })

    // The bench never became what the plan asked for: ERROR, eventually.
    write(good, 'poll-state', 'COMPLETED')
    await coco.pollJob(good)
    await coco.reportRun(good, start.members[0].run_id, 'auto')
    const status = coco.benchStatus(bench, start.runId)
    expect(status.status).toBe('ERROR')
    expect(status.succeeded).toBe(1)
  })

  it('refuses a bench report unless every member succeeded', async () => {
    const dir = tempDir()
    const good = jobFolder(dir, 'ok-job')
    const bench = benchFolder(dir, 'nightly', ['ok-job'])
    const coco = engine(dir)
    coco.register(good)
    coco.register(bench)
    const start = await coco.startBench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)

    write(good, 'poll-state', 'FAILED no convergence')
    await coco.pollJob(good)
    const status = coco.benchStatus(bench, start.runId)
    expect(status.status).toBe('FAILED')
    expect(status.failed).toBe(1)

    expect(await failure(coco.benchReport(bench, start.runId))).toContain('no bench report')
    expect(exists(bench, 'report', `${start.runId}.txt`)).toBe(false)
  })

  it('reports when every member succeeded', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'sweep-job')
    const bench = benchFolder(dir, 'nightly', ['sweep-job'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.startBench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)

    expect(coco.benchStatus(bench, start.runId).status).toBe('STARTING')

    write(job, 'poll-state', 'COMPLETED')
    await coco.pollJob(job)
    await coco.reportRun(job, start.members[0].run_id, 'auto')
    expect(coco.benchStatus(bench, start.runId).status).toBe('ANALYZING')

    await coco.benchReport(bench, start.runId)
    expect(coco.benchStatus(bench, start.runId).status).toBe('SUCCEEDED')
    expect(isFile(bench, 'runs', String(start.runId), 'members.json')).toBe(true)
    expect(isFile(bench, 'report', `${start.runId}.txt`)).toBe(true)
  })

  // A plan is generated, so its mistakes arrive in batches. Every call is
  // checked and every bad one is named, rather than the user fixing one,
  // starting again, and meeting the next (§8.1).
  it('names every bad plan call at once', async () => {
    const dir = tempDir()
    const good = jobFolder(dir, 'good-job')
    const bench = benchFolder(dir, 'sweep', ['good-job'])
    planLines(bench, [
      '{"job": "ghost", "params": {}}',
      '{"job": "good-job", "params": {"size": "1", "gpu": "0"}}',
      '{"job": "phantom", "params": {}}',
      '{"job": "good-job", "params": {"size": "1"}}'
    ])
    const coco = engine(dir)
    coco.register(good)
    coco.register(bench)

    const message = await failure(coco.startBench(bench, { mesh: 'fine' }, 'human'))

    // Three of the four calls are bad, and all three are named — including
    // the last, which an abort-on-first check would never have reached.
    expect(message).toContain('3 of 4')
    expect(message).toContain('call 1')
    expect(message).toContain('call 3')
    expect(message).toContain('call 4')
    expect(message).not.toContain('call 2')
    expect(coco.benchRuns(bench)).toEqual([])
  })

  it('dispatches nothing when the plan is invalid', async () => {
    const dir = tempDir()
    const bench = benchFolder(dir, 'broken-plan', [])
    planLines(bench, ['{"job": "ghost", "params": {}}'])
    const coco = engine(dir)
    coco.register(bench)

    const message = await failure(coco.startBench(bench, { mesh: 'fine' }, 'human'))
    expect(message).toContain('not a registered job')
    expect(coco.benchRuns(bench)).toEqual([])
  })
})

describe('reports', () => {
  it('heals a failed auto report when asked again by hand', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'flaky-report')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'COMPLETED')
    await coco.pollJob(job)

    write(job, 'report-state', 'fail')
    expect(await failure(coco.reportRun(job, runId, 'auto'))).toContain('exploded')
    const record = coco.runRecord(job, runId)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('exploded')

    fs.rmSync(path.join(job, 'report-state'))
    await coco.reportRun(job, runId, 'manual')
    expect(coco.runRecord(job, runId).status).toBe('SUCCEEDED')
    expect(isFile(job, 'report', `${runId}.txt`)).toBe(true)
  })
})

describe('reconcile (memory is the truth)', () => {
  it('fails only the corrupt run, not the history around it', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'mixed-history')
    const coco = engine(dir)
    coco.register(job)
    await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await coco.startJob(job, { size: '2' }, { gpu: '1' }, 'human')
    await settle(coco)

    handEdit(recordPath(job, 0), '{ not json')
    coco.reconcile()

    const views = coco.jobRuns(job)
    expect(views.map((view) => view.runId)).toEqual([1, 0])
    expect(views[1].record).toBeNull()
    expect(views[1].recordError?.message).toContain('does not parse')
    expect(views[0].record?.run_id).toBe(1)
  })

  it('pulls a hand-edited run.json back into memory', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'edited-by-hand')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    const record = { ...coco.runRecord(job, runId), status: 'CANCELLED' as const }
    handEdit(recordPath(job, runId), JSON.stringify(record, null, 2))
    coco.reconcile()

    expect(coco.runRecord(job, runId).status).toBe('CANCELLED')
  })

  it('drops a run whose folder was deleted', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'deleted-run')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    fs.rmSync(path.join(job, 'runs', String(runId)), { recursive: true })
    coco.reconcile()

    expect(coco.jobRuns(job)).toEqual([])
  })
})

describe('parameters', () => {
  // Every declared parameter must be supplied by hand (§2.1). The start form
  // sends one entry per declared name whether or not the user typed in it, so
  // a present-but-blank value must be refused exactly like a missing one —
  // otherwise a job launches with no arguments at all.
  it('refuses blank parameter values', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'solver-gpu')
    const coco = engine(dir)
    coco.register(job)

    // Every field left empty, which is what an untouched start form sends.
    expect(await failure(coco.startJob(job, { size: '' }, { gpu: '' }, 'human'))).toContain('size')

    // One field filled, the other blank or whitespace.
    expect(await failure(coco.startJob(job, { size: '256' }, { gpu: '  ' }, 'human'))).toContain(
      'gpu'
    )

    // Nothing was launched, and no run id was burned on a refused start.
    expect(exists(job, 'runs')).toBe(false)

    // The same start with real values goes through.
    await coco.startJob(job, { size: '256' }, { gpu: '0' }, 'human')
    await settle(coco)
  })
})
