// The operations the renderer asks for. They answer rather than throw: a
// refusal is an outcome the user reads, so every case here checks the message
// as much as the outcome.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  add_folder,
  attachments_location,
  cancel,
  lock_report,
  read_report,
  remove_folder,
  rerun_report,
  save_report,
  start_run,
  delete_run,
  visualize
} from '../../../src/main/bridge/operations'
import { attachment_dir } from '../../../src/main/engine/attachments'
import { engine, settle } from '../../support/engine'
import { write, write_script } from '../../support/files'
import { campaign_folder, job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

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

  it('starts a campaign by name', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'sweep', ['member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)

    const result = await start_run(cocoa, 'sweep', { mesh: 'fine' })
    expect(result.ok).toBe(true)
    await settle(cocoa)
    expect(cocoa.campaign(campaign).runs.all()).toHaveLength(1)
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

  it('cancels every still-active member of a campaign', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'sweep', ['member', 'member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)

    expect(
      await cancel(cocoa, {
        kind: 'campaign_run',
        campaign_id: campaign,
        run_id: String(start.run_id)
      })
    ).toEqual({ ok: true })
    for (const member of start.members) {
      expect(cocoa.job(job).runs.record(member.run_id).status).toBe('CANCELLING')
    }
    expect(cocoa.campaign_status(campaign, start.run_id).status).toBe('CANCELLING')
  })

  // A cancel that half worked should not read as done.
  it('reports a campaign whose members refused, naming one of them', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'sweep', ['member', 'member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)
    write_script(job, 'cancel.sh', "echo 'scancel: invalid job id' >&2\nexit 1\n")

    const result = await cancel(cocoa, {
      kind: 'campaign_run',
      campaign_id: campaign,
      run_id: String(start.run_id)
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('`member`')
    expect(result.ok === false && result.message).toContain('scancel: invalid job id')
    expect(result.ok === false && result.message).toContain('1 more')
  })

  // Members that already ended keep their results; the campaign asks only what
  // is still the cluster's to stop.
  it('leaves finished members alone', async () => {
    const dir = temp_dir()
    const done = job_folder(dir, 'done')
    const busy = job_folder(dir, 'busy')
    const campaign = campaign_folder(dir, 'sweep', ['done', 'busy'])
    const cocoa = engine(dir)
    cocoa.register(done)
    cocoa.register(busy)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(done, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(done)
    await cocoa.report_run(done, start.members[0].run_id, 'auto')
    write(busy, 'poll-state', 'RUNNING')
    await cocoa.poll_job(busy)

    expect(
      await cancel(cocoa, {
        kind: 'campaign_run',
        campaign_id: campaign,
        run_id: String(start.run_id)
      })
    ).toEqual({ ok: true })
    expect(cocoa.job(done).runs.record(start.members[0].run_id).status).toBe('SUCCEEDED')
    expect(cocoa.job(busy).runs.record(start.members[1].run_id).status).toBe('CANCELLING')
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

describe('start_run in a campaign call’s place', () => {
  it('starts the job’s run as the call’s, and answers every refusal', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'nightly', ['member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'FAILED')
    await cocoa.refresh()
    const replaces = { campaign_id: campaign, campaign_run_id: String(start.run_id), run_id: '0' }

    expect(await start_run(cocoa, 'nightly', { mesh: 'fine' }, 'human', replaces)).toEqual({
      ok: false,
      message: "only a job's run takes a campaign call's place"
    })
    expect(
      await start_run(cocoa, 'member', { size: '1', gpu: '0' }, 'human', {
        ...replaces,
        run_id: '../0'
      })
    ).toEqual({ ok: false, message: 'a campaign call is named by run ids' })

    write(job, 'poll-state', 'RUNNING')
    expect(await start_run(cocoa, 'member', { size: '1', gpu: '0' }, 'human', replaces)).toEqual({
      ok: true,
      run_id: '1'
    })
    expect(cocoa.campaign(campaign).runs.record(start.run_id).members).toEqual([
      { run_id: 1, job: 'member', attempts: [0] }
    ])
    await settle(cocoa)
  })
})

describe('rerun_report', () => {
  it('answers an accepted re-run, and every refusal, never throwing', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'rerun')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    const target = { entity_id: job, run_id: String(run_id) }

    expect(rerun_report(cocoa, target)).toEqual({
      ok: false,
      message: `run ${run_id} (STARTING) cannot be reported`
    })

    write(job, 'poll-state', 'FAILED')
    await cocoa.refresh()
    expect(rerun_report(cocoa, target)).toEqual({ ok: true })
    expect(cocoa.job(job).runs.record(run_id).report).toEqual({ attempted: false })
    expect(rerun_report(cocoa, target)).toEqual({
      ok: false,
      message: `the report of run ${run_id} is already running`
    })

    expect(rerun_report(cocoa, { entity_id: job, run_id: '../0' }).ok).toBe(false)
    expect(rerun_report(cocoa, { entity_id: job, run_id: '41' }).ok).toBe(false)
    expect(rerun_report(cocoa, { entity_id: '/nowhere', run_id: '0' }).ok).toBe(false)
    expect(rerun_report(cocoa, { ...target, members: true })).toEqual({
      ok: false,
      message: `${job} is a job, not a campaign`
    })
  })

  it('takes a campaign run’s members first when asked', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'nightly', ['member'])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    await cocoa.refresh()

    const target = { entity_id: campaign, run_id: String(start.run_id), members: true }
    expect(rerun_report(cocoa, target)).toEqual({ ok: true })
    expect(cocoa.job(job).runs.record(start.members[0].run_id).status).toBe('ANALYZING')
    expect(rerun_report(cocoa, target)).toEqual({
      ok: false,
      message: `the report of campaign run ${start.run_id} is already running`
    })
  })
})

describe('lock_report', () => {
  it('answers a lock and an unlock, and every refusal, never throwing', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'kept')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    const target = { entity_id: job, run_id: String(run_id) }

    expect(lock_report(cocoa, { ...target, locked: true })).toEqual({
      ok: false,
      message: `run ${run_id} has no report to lock`
    })

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    expect(lock_report(cocoa, { ...target, locked: true })).toEqual({ ok: true })
    expect(cocoa.job(job).runs.record(run_id).report_locked).toBe(true)
    expect(rerun_report(cocoa, target)).toEqual({
      ok: false,
      message: `the report of run ${run_id} is locked; unlock it to regenerate it`
    })
    expect(lock_report(cocoa, { ...target, locked: false })).toEqual({ ok: true })
    expect(cocoa.job(job).runs.record(run_id).report_locked).toBeUndefined()

    expect(lock_report(cocoa, { entity_id: job, run_id: '../0', locked: true }).ok).toBe(false)
    expect(lock_report(cocoa, { entity_id: job, run_id: '41', locked: true }).ok).toBe(false)
    expect(lock_report(cocoa, { entity_id: '/nowhere', run_id: '0', locked: true }).ok).toBe(false)
  })
})

describe('save_report', () => {
  it('saves a reported run’s copy, and answers every refusal', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'kept')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    const target = { entity_id: job, run_id: String(run_id) }
    const destination = path.join(temp_dir(), 'copy')

    expect(save_report(cocoa, target, destination)).toEqual({
      ok: false,
      cancelled: false,
      message: `run ${run_id} has no report to save`
    })

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.refresh()
    expect(save_report(cocoa, target, destination)).toEqual({ ok: true, path: destination })
    expect(fs.existsSync(path.join(destination, 'report', `${run_id}.txt`))).toBe(true)

    expect(save_report(cocoa, { entity_id: job, run_id: '../0' }, destination).ok).toBe(false)
    expect(save_report(cocoa, { entity_id: '/nowhere', run_id: '0' }, destination).ok).toBe(false)
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
    const result = read_report(cocoa, {
      entity_id: job,
      run_id: String(run_id),
      format: 'PlainText'
    })
    expect(result).toEqual({ ok: true, format: 'PlainText', text: `report for run ${run_id}\n` })
  })

  // A run that wrote both gets a button for each (§20): each reads its own file.
  it('reads the format asked for when a run wrote both', async () => {
    const [job, cocoa, run_id] = await reported('two-formats')
    fs.writeFileSync(path.join(job, 'report', `${run_id}.html`), '<p>hi</p>')
    const target = { entity_id: job, run_id: String(run_id) }
    expect(read_report(cocoa, { ...target, format: 'Html' })).toEqual({
      ok: true,
      format: 'Html',
      text: '<p>hi</p>'
    })
    expect(read_report(cocoa, { ...target, format: 'PlainText' })).toEqual({
      ok: true,
      format: 'PlainText',
      text: `report for run ${run_id}\n`
    })
  })

  it('says so when the format asked for was not written', async () => {
    const [job, cocoa, run_id] = await reported('text-only')
    const result = read_report(cocoa, { entity_id: job, run_id: String(run_id), format: 'Html' })
    expect(result).toEqual({ ok: false, message: `run ${run_id} has no html report` })
  })

  it('reads an HTML report when that is all there is', async () => {
    const [job, cocoa, run_id] = await reported('html-only')
    fs.rmSync(path.join(job, 'report', `${run_id}.txt`))
    fs.writeFileSync(path.join(job, 'report', `${run_id}.html`), '<h1>Report</h1>')
    const result = read_report(cocoa, { entity_id: job, run_id: String(run_id), format: 'Html' })
    expect(result).toEqual({ ok: true, format: 'Html', text: '<h1>Report</h1>' })
  })

  it('says so when a run has no report', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'unreported')
    const cocoa = engine(dir)
    cocoa.register(job)
    const result = read_report(cocoa, { entity_id: job, run_id: '0', format: 'PlainText' })
    expect(result).toEqual({ ok: false, message: 'run 0 has no txt report' })
  })

  // The renderer names the folder, so the folder is checked: a report is only
  // ever read out of a registered experiment, and only by run id.
  it('refuses a folder that is not registered', () => {
    const cocoa = engine(temp_dir())
    const result = read_report(cocoa, { entity_id: '/etc', run_id: '0', format: 'PlainText' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('no experiment is registered')
  })

  it('refuses a run id that is not a run id', async () => {
    const [job, cocoa] = await reported('picky-id')
    const result = read_report(cocoa, {
      entity_id: job,
      run_id: '../../../etc/passwd',
      format: 'PlainText'
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('is not a run id')
  })
})

describe('attachments_location', () => {
  it('answers the directory of a run whose report attached something, and refuses the rest', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'attached')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    const target = { entity_id: job, run_id: String(run_id) }
    expect(attachments_location(cocoa, target)).toEqual({
      ok: false,
      message: `run ${run_id} has no report attachments`
    })

    fs.mkdirSync(attachment_dir(job, run_id), { recursive: true })
    fs.writeFileSync(path.join(attachment_dir(job, run_id), 'loss.png'), '')
    expect(attachments_location(cocoa, target)).toEqual({
      ok: true,
      dir: attachment_dir(job, run_id)
    })

    expect(attachments_location(cocoa, { ...target, run_id: '../0' })).toEqual({
      ok: false,
      message: '`../0` is not a run id'
    })
    expect(attachments_location(cocoa, { ...target, entity_id: '/etc' }).ok).toBe(false)
  })
})

describe('visualize', () => {
  it('answers a refusal rather than throwing it', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'unviewed')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    const target = { entity_id: job, run_id: String(run_id) }

    expect(await visualize(cocoa, target, () => {})).toEqual({
      ok: false,
      message: '`unviewed` has no visualize script'
    })
    expect(await visualize(cocoa, { ...target, run_id: '../0' }, () => {})).toEqual({
      ok: false,
      message: '`../0` is not a run id'
    })
    expect((await visualize(cocoa, { ...target, entity_id: '/etc' }, () => {})).ok).toBe(false)
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
