// The operations the renderer asks for. They answer rather than throw: a
// refusal is an outcome the user reads, so every case here checks the message
// as much as the outcome.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  add_folder,
  cancel,
  read_report,
  remove_folder,
  start_run,
  delete_run
} from '../src/main/bridge/operations'
import {
  bench_folder,
  cleanup_temp_dirs,
  engine,
  job_folder,
  settle,
  temp_dir,
  write,
  write_script
} from './support'

afterEach(cleanup_temp_dirs)

describe('start_run', () => {
  it('starts a job, splitting parameters the way the manifest declares them', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver-gpu')
    const cocoa = engine(dir)
    cocoa.register(job)

    const result = await start_run(cocoa, 'solver-gpu', { size: '256', gpu: '0' })
    expect(result).toEqual({ ok: true, run_id: '0' })
    await settle(cocoa)

    const record = cocoa.job(job).runs.record(0)
    expect(record.render).toEqual({ size: '256' })
    expect(record.launch).toEqual({ gpu: '0' })
    expect(record.origin).toEqual({ by: 'human' })
  })

  it('starts a bench by name', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const bench = bench_folder(dir, 'sweep', ['member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(bench)

    const result = await start_run(cocoa, 'sweep', { mesh: 'fine' })
    expect(result.ok).toBe(true)
    await settle(cocoa)
    expect(cocoa.bench(bench).runs.all()).toHaveLength(1)
  })

  it('refuses an unknown name without throwing', async () => {
    const cocoa = engine(temp_dir())
    expect(await start_run(cocoa, 'ghost', {})).toEqual({
      ok: false,
      message: 'no experiment named `ghost` is registered'
    })
  })

  it('passes the engine refusal through verbatim', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'picky')
    const cocoa = engine(dir)
    cocoa.register(job)

    const result = await start_run(cocoa, 'picky', { size: '', gpu: '0' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('size')
    // A refused start burns nothing.
    expect(fs.existsSync(path.join(job, 'runs'))).toBe(false)
  })
})

describe('delete', () => {
  it('answers a delete, and a refusal, never throwing', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)

    // Active: refused with the reason, answered.
    const refused = delete_run(cocoa, { kind: 'job_run', job_id: job, run_id: String(run_id) })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.message).toContain('cancel it first')
    }

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, run_id, 'auto')
    expect(delete_run(cocoa, { kind: 'job_run', job_id: job, run_id: String(run_id) })).toEqual({
      ok: true
    })

    // A run id that is not one, answered.
    expect(delete_run(cocoa, { kind: 'job_run', job_id: job, run_id: '99' }).ok).toBe(false)
  })
})

describe('cancel', () => {
  it('accepts a cancel and leaves the run CANCELLING, not CANCELLED', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'stoppable')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)

    expect(await cancel(cocoa, { kind: 'job_run', job_id: job, run_id: String(run_id) })).toEqual({
      ok: true
    })
    // Never labelled CANCELLED before the cluster confirms it (§16.3).
    expect(cocoa.job(job).runs.record(run_id).status).toBe('CANCELLING')

    write(job, 'poll-state', 'CANCELLED')
    await cocoa.poll_job(job)
    expect(cocoa.job(job).runs.record(run_id).status).toBe('CANCELLED')
  })

  it('reports a refused cancel and leaves the status alone', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'stubborn')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)
    write_script(job, 'cancel.sh', "echo 'already gone' >&2\nexit 9\n")

    const result = await cancel(cocoa, { kind: 'job_run', job_id: job, run_id: String(run_id) })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('already gone')
    expect(cocoa.job(job).runs.record(run_id).status).toBe('RUNNING')
  })

  it('refuses to cancel a run that has already ended', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'done')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, run_id, 'auto')

    const result = await cancel(cocoa, { kind: 'job_run', job_id: job, run_id: String(run_id) })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('cannot be cancelled')
  })

  it('cancels every still-active member of a bench', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const bench = bench_folder(dir, 'sweep', ['member', 'member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(bench)
    const start = await cocoa.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)

    expect(
      await cancel(cocoa, { kind: 'bench_run', bench_id: bench, run_id: String(start.run_id) })
    ).toEqual({ ok: true })
    for (const member of start.members) {
      expect(cocoa.job(job).runs.record(member.run_id).status).toBe('CANCELLING')
    }
    expect(cocoa.bench_status(bench, start.run_id).status).toBe('CANCELLING')
  })

  // The Rust adapter drops the per-member results here; a cancel that half
  // worked should not read as done.
  it('reports a bench whose members refused, naming one of them', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const bench = bench_folder(dir, 'sweep', ['member', 'member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(bench)
    const start = await cocoa.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)
    write_script(job, 'cancel.sh', "echo 'scancel: invalid job id' >&2\nexit 1\n")

    const result = await cancel(cocoa, {
      kind: 'bench_run',
      bench_id: bench,
      run_id: String(start.run_id)
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('`member`')
    expect(result.ok === false && result.message).toContain('scancel: invalid job id')
    expect(result.ok === false && result.message).toContain('1 more')
  })

  // Members that already ended keep their results; the bench asks only what
  // is still the cluster's to stop.
  it('leaves finished members alone', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const bench = bench_folder(dir, 'sweep', ['member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(bench)
    const start = await cocoa.start_bench(bench, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, start.members[0].run_id, 'auto')

    expect(
      await cancel(cocoa, { kind: 'bench_run', bench_id: bench, run_id: String(start.run_id) })
    ).toEqual({ ok: true })
    expect(cocoa.job(job).runs.record(start.members[0].run_id).status).toBe('SUCCEEDED')
  })

  it('answers rather than throws for a run that is not there', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'empty-history')
    const cocoa = engine(dir)
    cocoa.register(job)

    const result = await cancel(cocoa, { kind: 'job_run', job_id: job, run_id: '99' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('not found')
  })
})

describe('read_report', () => {
  /** A job with a run that has reported. */
  async function reported(name: string): Promise<[string, ReturnType<typeof engine>, number]> {
    const dir = temp_dir()
    const job = job_folder(dir, name)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, run_id, 'auto')
    return [job, cocoa, run_id]
  }

  it('reads a plain-text report', async () => {
    const [job, cocoa, run_id] = await reported('reporter')
    const result = read_report(cocoa, { entity_id: job, run_id: String(run_id) })
    expect(result).toEqual({ ok: true, format: 'PlainText', text: `report for run ${run_id}\n` })
  })

  // The world builder prefers .txt when a run wrote both; the viewer must be
  // handed the format the page announced, or it offers something else.
  it('prefers plain text over HTML, as the world builder does', async () => {
    const [job, cocoa, run_id] = await reported('two-formats')
    fs.writeFileSync(path.join(job, 'report', `${run_id}.html`), '<p>hi</p>')
    const result = read_report(cocoa, { entity_id: job, run_id: String(run_id) })
    expect(result.ok === true && result.format).toBe('PlainText')
  })

  it('reads an HTML report when that is all there is', async () => {
    const [job, cocoa, run_id] = await reported('html-only')
    fs.rmSync(path.join(job, 'report', `${run_id}.txt`))
    fs.writeFileSync(path.join(job, 'report', `${run_id}.html`), '<h1>Report</h1>')
    const result = read_report(cocoa, { entity_id: job, run_id: String(run_id) })
    expect(result).toEqual({ ok: true, format: 'Html', text: '<h1>Report</h1>' })
  })

  it('says so when a run has no report', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'unreported')
    const cocoa = engine(dir)
    cocoa.register(job)
    const result = read_report(cocoa, { entity_id: job, run_id: '0' })
    expect(result).toEqual({ ok: false, message: 'run 0 has no report' })
  })

  // The renderer names the folder, so the folder is checked: a report is only
  // ever read out of a registered experiment, and only by run id.
  it('refuses a folder that is not registered', () => {
    const cocoa = engine(temp_dir())
    const result = read_report(cocoa, { entity_id: '/etc', run_id: '0' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('no experiment is registered')
  })

  it('refuses a run id that is not a run id', async () => {
    const [job, cocoa] = await reported('picky-id')
    const result = read_report(cocoa, { entity_id: job, run_id: '../../../etc/passwd' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('is not a run id')
  })
})

describe('add_folder', () => {
  it('registers the folder that was picked', () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'picked')
    const cocoa = engine(dir)

    expect(add_folder(cocoa, job)).toEqual({ ok: true, entity_id: job, already: false })
    expect(cocoa.jobs().map((registered) => registered.path)).toEqual([job])
  })

  // One pick registers one folder: nothing beneath it is searched, which is
  // where this diverges from §11.5.
  it('does not look inside the picked folder', () => {
    const dir = temp_dir()
    job_folder(dir, 'nested-a')
    job_folder(dir, 'nested-b')
    const cocoa = engine(dir)

    const result = add_folder(cocoa, dir)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('no cocoa.toml')
    expect(cocoa.jobs()).toEqual([])
  })

  it('treats a folder already in the Explorer as a no-op, not a duplicate', () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'twice')
    const cocoa = engine(dir)
    add_folder(cocoa, job)

    expect(add_folder(cocoa, job)).toEqual({ ok: true, entity_id: job, already: true })
    expect(cocoa.jobs()).toHaveLength(1)
  })

  it('refuses a manifest that is unusable at the moment it is picked', () => {
    const dir = temp_dir()
    const folder = path.join(dir, 'broken')
    fs.mkdirSync(folder)
    write(folder, 'cocoa.toml', 'kind = "pipeline"\nname = "x"\n')
    const cocoa = engine(dir)

    const result = add_folder(cocoa, folder)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('kind')
    expect(cocoa.jobs()).toEqual([])
  })

  it('refuses a folder whose name is already taken', () => {
    const dir = temp_dir()
    const first = job_folder(dir, 'same-name')
    const second = job_folder(dir, 'elsewhere')
    const manifest = path.join(second, 'cocoa.toml')
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('elsewhere', 'same-name'))
    const cocoa = engine(dir)
    add_folder(cocoa, first)

    const result = add_folder(cocoa, second)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('already registered')
    expect(cocoa.jobs()).toHaveLength(1)
  })

  it('refuses a path that is not a folder', () => {
    const dir = temp_dir()
    const cocoa = engine(dir)
    const result = add_folder(cocoa, path.join(dir, 'nowhere'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.cancelled).toBe(false)
  })
})

describe('remove_folder', () => {
  it('takes the folder out of the Explorer and leaves the disk alone', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'goodbye')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    expect(remove_folder(cocoa, job)).toEqual({ ok: true })
    expect(cocoa.jobs()).toEqual([])
    // §36: removed from the Explorer, not deleted from disk.
    expect(fs.existsSync(path.join(job, 'cocoa.toml'))).toBe(true)
    expect(fs.existsSync(path.join(job, 'runs', String(run_id), 'run.json'))).toBe(true)
  })

  it('brings the history back when the folder is added again', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'returning')
    const cocoa = engine(dir)
    cocoa.register(job)
    await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)

    remove_folder(cocoa, job)
    expect(cocoa.registered(job)).toBe(false)

    add_folder(cocoa, job)
    expect(cocoa.job(job).runs.all()).toHaveLength(1)
  })

  it('answers rather than throws for a folder that is not registered', () => {
    const dir = temp_dir()
    const cocoa = engine(dir)
    const result = remove_folder(cocoa, path.join(dir, 'never-added'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('not found')
  })
})
