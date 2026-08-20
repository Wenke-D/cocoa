// The operations the renderer asks for. They answer rather than throw: a
// refusal is an outcome the user reads, so every case here checks the message
// as much as the outcome.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addFolder, cancel, readReport, removeFolder, startRun } from '../src/main/operations'
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

describe('startRun', () => {
  it('starts a job, splitting parameters the way the manifest declares them', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'solver-gpu')
    const coco = engine(dir)
    coco.register(job)

    const result = await startRun(coco, 'solver-gpu', { size: '256', gpu: '0' })
    expect(result).toEqual({ ok: true, runId: '0' })
    await settle(coco)

    const record = coco.runRecord(job, 0)
    expect(record.render).toEqual({ size: '256' })
    expect(record.launch).toEqual({ gpu: '0' })
    expect(record.origin).toEqual({ by: 'human' })
  })

  it('starts a bench by name', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'member')
    const bench = benchFolder(dir, 'sweep', ['member'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)

    const result = await startRun(coco, 'sweep', { mesh: 'fine' })
    expect(result.ok).toBe(true)
    await settle(coco)
    expect(coco.benchRuns(bench)).toHaveLength(1)
  })

  it('refuses an unknown name without throwing', async () => {
    const coco = engine(tempDir())
    expect(await startRun(coco, 'ghost', {})).toEqual({
      ok: false,
      message: 'no experiment named `ghost` is registered'
    })
  })

  it('passes the engine refusal through verbatim', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'picky')
    const coco = engine(dir)
    coco.register(job)

    const result = await startRun(coco, 'picky', { size: '', gpu: '0' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('size')
    // A refused start burns nothing.
    expect(fs.existsSync(path.join(job, 'runs'))).toBe(false)
  })
})

describe('cancel', () => {
  it('accepts a cancel and leaves the run CANCELLING, not CANCELLED', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'stoppable')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.pollJob(job)

    expect(await cancel(coco, { kind: 'jobRun', jobId: job, runId: String(runId) })).toEqual({
      ok: true
    })
    // Never labelled CANCELLED before the cluster confirms it (§16.3).
    expect(coco.runRecord(job, runId).status).toBe('CANCELLING')

    write(job, 'poll-state', 'CANCELLED')
    await coco.pollJob(job)
    expect(coco.runRecord(job, runId).status).toBe('CANCELLED')
  })

  it('reports a refused cancel and leaves the status alone', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'stubborn')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.pollJob(job)
    writeScript(job, 'cancel.sh', "echo 'already gone' >&2\nexit 9\n")

    const result = await cancel(coco, { kind: 'jobRun', jobId: job, runId: String(runId) })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('already gone')
    expect(coco.runRecord(job, runId).status).toBe('RUNNING')
  })

  it('refuses to cancel a run that has already ended', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'done')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'COMPLETED')
    await coco.pollJob(job)
    await coco.reportRun(job, runId, 'auto')

    const result = await cancel(coco, { kind: 'jobRun', jobId: job, runId: String(runId) })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('cannot be cancelled')
  })

  it('cancels every still-active member of a bench', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'member')
    const bench = benchFolder(dir, 'sweep', ['member', 'member'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.startBench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.pollJob(job)

    expect(
      await cancel(coco, { kind: 'benchRun', benchId: bench, runId: String(start.runId) })
    ).toEqual({ ok: true })
    for (const member of start.members) {
      expect(coco.runRecord(job, member.run_id).status).toBe('CANCELLING')
    }
    expect(coco.benchStatus(bench, start.runId).status).toBe('CANCELLING')
  })

  // The Rust adapter drops the per-member results here; a cancel that half
  // worked should not read as done.
  it('reports a bench whose members refused, naming one of them', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'member')
    const bench = benchFolder(dir, 'sweep', ['member', 'member'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.startBench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'RUNNING')
    await coco.pollJob(job)
    writeScript(job, 'cancel.sh', "echo 'scancel: invalid job id' >&2\nexit 1\n")

    const result = await cancel(coco, {
      kind: 'benchRun',
      benchId: bench,
      runId: String(start.runId)
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('`member`')
    expect(result.ok === false && result.message).toContain('scancel: invalid job id')
    expect(result.ok === false && result.message).toContain('1 more')
  })

  // Members that already ended keep their results; the bench asks only what
  // is still the cluster's to stop.
  it('leaves finished members alone', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'member')
    const bench = benchFolder(dir, 'sweep', ['member'])
    const coco = engine(dir)
    coco.register(job)
    coco.register(bench)
    const start = await coco.startBench(bench, { mesh: 'fine' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'COMPLETED')
    await coco.pollJob(job)
    await coco.reportRun(job, start.members[0].run_id, 'auto')

    expect(
      await cancel(coco, { kind: 'benchRun', benchId: bench, runId: String(start.runId) })
    ).toEqual({ ok: true })
    expect(coco.runRecord(job, start.members[0].run_id).status).toBe('SUCCEEDED')
  })

  it('answers rather than throws for a run that is not there', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'empty-history')
    const coco = engine(dir)
    coco.register(job)

    const result = await cancel(coco, { kind: 'jobRun', jobId: job, runId: '99' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('not found')
  })
})

describe('readReport', () => {
  /** A job with a run that has reported. */
  async function reported(name: string): Promise<[string, ReturnType<typeof engine>, number]> {
    const dir = tempDir()
    const job = jobFolder(dir, name)
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)
    write(job, 'poll-state', 'COMPLETED')
    await coco.pollJob(job)
    await coco.reportRun(job, runId, 'auto')
    return [job, coco, runId]
  }

  it('reads a plain-text report', async () => {
    const [job, coco, runId] = await reported('reporter')
    const result = readReport(coco, { entityId: job, runId: String(runId) })
    expect(result).toEqual({ ok: true, format: 'PlainText', text: `report for run ${runId}\n` })
  })

  // The world builder prefers .txt when a run wrote both; the viewer must be
  // handed the format the page announced, or it offers something else.
  it('prefers plain text over HTML, as the world builder does', async () => {
    const [job, coco, runId] = await reported('two-formats')
    fs.writeFileSync(path.join(job, 'report', `${runId}.html`), '<p>hi</p>')
    const result = readReport(coco, { entityId: job, runId: String(runId) })
    expect(result.ok === true && result.format).toBe('PlainText')
  })

  it('reads an HTML report when that is all there is', async () => {
    const [job, coco, runId] = await reported('html-only')
    fs.rmSync(path.join(job, 'report', `${runId}.txt`))
    fs.writeFileSync(path.join(job, 'report', `${runId}.html`), '<h1>Report</h1>')
    const result = readReport(coco, { entityId: job, runId: String(runId) })
    expect(result).toEqual({ ok: true, format: 'Html', text: '<h1>Report</h1>' })
  })

  it('says so when a run has no report', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'unreported')
    const coco = engine(dir)
    coco.register(job)
    const result = readReport(coco, { entityId: job, runId: '0' })
    expect(result).toEqual({ ok: false, message: 'run 0 has no report' })
  })

  // The renderer names the folder, so the folder is checked: a report is only
  // ever read out of a registered experiment, and only by run id.
  it('refuses a folder that is not registered', () => {
    const coco = engine(tempDir())
    const result = readReport(coco, { entityId: '/etc', runId: '0' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('no experiment is registered')
  })

  it('refuses a run id that is not a run id', async () => {
    const [job, coco] = await reported('picky-id')
    const result = readReport(coco, { entityId: job, runId: '../../../etc/passwd' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('is not a run id')
  })
})

describe('addFolder', () => {
  it('registers the folder that was picked', () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'picked')
    const coco = engine(dir)

    expect(addFolder(coco, job)).toEqual({ ok: true, entityId: job, already: false })
    expect(coco.entities().map((entity) => entity.path)).toEqual([job])
  })

  // One pick registers one folder: nothing beneath it is searched, which is
  // where this diverges from §11.5.
  it('does not look inside the picked folder', () => {
    const dir = tempDir()
    jobFolder(dir, 'nested-a')
    jobFolder(dir, 'nested-b')
    const coco = engine(dir)

    const result = addFolder(coco, dir)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('no coco.toml')
    expect(coco.entities()).toEqual([])
  })

  it('treats a folder already in the Explorer as a no-op, not a duplicate', () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'twice')
    const coco = engine(dir)
    addFolder(coco, job)

    expect(addFolder(coco, job)).toEqual({ ok: true, entityId: job, already: true })
    expect(coco.entities()).toHaveLength(1)
  })

  it('refuses a manifest that is unusable at the moment it is picked', () => {
    const dir = tempDir()
    const folder = path.join(dir, 'broken')
    fs.mkdirSync(folder)
    write(folder, 'coco.toml', 'kind = "pipeline"\nname = "x"\n')
    const coco = engine(dir)

    const result = addFolder(coco, folder)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('kind')
    expect(coco.entities()).toEqual([])
  })

  it('refuses a folder whose name is already taken', () => {
    const dir = tempDir()
    const first = jobFolder(dir, 'same-name')
    const second = jobFolder(dir, 'elsewhere')
    const manifest = path.join(second, 'coco.toml')
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('elsewhere', 'same-name'))
    const coco = engine(dir)
    addFolder(coco, first)

    const result = addFolder(coco, second)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('already registered')
    expect(coco.entities()).toHaveLength(1)
  })

  it('refuses a path that is not a folder', () => {
    const dir = tempDir()
    const coco = engine(dir)
    const result = addFolder(coco, path.join(dir, 'nowhere'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.cancelled).toBe(false)
  })
})

describe('removeFolder', () => {
  it('takes the folder out of the Explorer and leaves the disk alone', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'goodbye')
    const coco = engine(dir)
    coco.register(job)
    const runId = await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    expect(removeFolder(coco, job)).toEqual({ ok: true })
    expect(coco.entities()).toEqual([])
    // §36: removed from the Explorer, not deleted from disk.
    expect(fs.existsSync(path.join(job, 'coco.toml'))).toBe(true)
    expect(fs.existsSync(path.join(job, 'runs', String(runId), 'run.json'))).toBe(true)
  })

  it('brings the history back when the folder is added again', async () => {
    const dir = tempDir()
    const job = jobFolder(dir, 'returning')
    const coco = engine(dir)
    coco.register(job)
    await coco.startJob(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(coco)

    removeFolder(coco, job)
    expect(coco.jobRuns(job)).toEqual([])

    addFolder(coco, job)
    expect(coco.jobRuns(job)).toHaveLength(1)
  })

  it('answers rather than throws for a folder that is not registered', () => {
    const dir = tempDir()
    const coco = engine(dir)
    const result = removeFolder(coco, path.join(dir, 'never-added'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('not found')
  })
})
