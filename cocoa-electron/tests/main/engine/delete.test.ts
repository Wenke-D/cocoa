import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../support/engine'
import { failure } from '../../support/failure'
import { exists, is_file, write, write_script } from '../../support/files'
import { campaign_folder, job_folder, plan_lines } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('deletion', () => {
  /** Starts a run and walks it to SUCCEEDED, report on disk. */
  async function finished_run(cocoa: ReturnType<typeof engine>, job: string): Promise<number> {
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    await cocoa.report_run(job, run_id, 'auto')
    return run_id
  }

  it('deletes a finished run: record, artifact and report gone, others untouched', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(job)
    const kept = await finished_run(cocoa, job)
    const doomed = await finished_run(cocoa, job)
    const newest = await finished_run(cocoa, job)

    cocoa.delete_run(job, doomed)

    expect(exists(job, 'runs', String(doomed))).toBe(false)
    expect(is_file(job, 'report', `${doomed}.txt`)).toBe(false)
    expect(() => cocoa.job(job).runs.record(doomed)).toThrow()
    expect(is_file(job, 'runs', String(kept), 'run.json')).toBe(true)
    expect(is_file(job, 'report', `${kept}.txt`)).toBe(true)

    // A deleted middle run frees nothing: ids keep counting from the top.
    expect(cocoa.job(job).runs.next_id()).toBe(newest + 1)

    // Deleting the newest hands back every id above what remains — the id
    // is derived from what is on disk (§5), and the disk no longer knows
    // them. Stated deliberately, not an accident to fix.
    cocoa.delete_run(job, newest)
    expect(cocoa.job(job).runs.next_id()).toBe(kept + 1)
  })

  it('refuses an active run, and UNREACHABLE, which may still be running', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'busy')
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    write(job, 'poll-state', 'RUNNING')
    await cocoa.poll_job(job)

    expect(await failure(Promise.resolve().then(() => cocoa.delete_run(job, run_id)))).toContain(
      'cancel it first'
    )

    write_script(job, 'poll.sh', "echo 'oops' >&2\nexit 3\n")
    await cocoa.poll_job(job).catch(() => undefined)
    expect(cocoa.job(job).runs.record(run_id).status).toBe('UNREACHABLE')
    expect(await failure(Promise.resolve().then(() => cocoa.delete_run(job, run_id)))).toContain(
      'not finished'
    )
    expect(is_file(job, 'runs', String(run_id), 'run.json')).toBe(true)
  })

  it('deletes a settled campaign run whole, members included, and only whole', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member-job')
    const campaign = campaign_folder(dir, 'sweep', [])
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    plan_lines(campaign, [
      '{"job": "member-job", "params": {"size": "1", "gpu": "0"}}',
      '{"job": "member-job", "params": {"size": "2", "gpu": "0"}}'
    ])

    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    const member = start.members[0]

    // A dispatched run is never deleted from the job's side, whatever its
    // status: the fan-out goes whole, from the campaign.
    expect(
      await failure(Promise.resolve().then(() => cocoa.delete_run(job, member.run_id)))
    ).toContain('delete that campaign run instead')

    // Still dispatching members: refused.
    expect(
      await failure(Promise.resolve().then(() => cocoa.delete_campaign_run(campaign, start.run_id)))
    ).toContain('cancel it first')

    write(job, 'poll-state', 'FAILED broke')
    await cocoa.poll_job(job)

    // Settled, but a failed member's report is still owed (§7.3.1).
    expect(
      await failure(Promise.resolve().then(() => cocoa.delete_campaign_run(campaign, start.run_id)))
    ).toContain('report is still running')
    await cocoa.refresh()

    cocoa.delete_campaign_run(campaign, start.run_id)
    expect(exists(campaign, 'runs', String(start.run_id))).toBe(false)
    // The members went with it: no record, no files, in their own job.
    for (const gone of start.members) {
      expect(exists(job, 'runs', String(gone.run_id))).toBe(false)
      expect(exists(job, 'report', `${gone.run_id}.txt`)).toBe(false)
      expect(() => cocoa.job(job).runs.record(gone.run_id)).toThrow()
    }
  })
})
