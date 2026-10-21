import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { attachment_count, attachment_dir } from '../../../src/main/engine/attachments'
import type { Engine } from '../../../src/main/engine/engine'
import { build_world } from '../../../src/main/engine/world'
import { engine, settle } from '../../support/engine'
import { exists, is_file, read_text, write, write_script } from '../../support/files'
import { campaign_folder, job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

/**
 * Swaps in a report script that attaches each name listed in `attach-state`
 * to the directory `--attachment-dir` names, and nothing when there is no
 * such file.
 */
function attaching_report(folder: string): void {
  write_script(
    folder,
    'report.sh',
    [
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    --run) run="$2"; shift 2 ;;',
      '    --attachment-dir) dir="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'mkdir -p report',
      'echo "report for run $run" > "report/$run.txt"',
      '[ -f attach-state ] && for name in $(cat attach-state); do echo "$name" > "$dir/$name"; done',
      'exit 0',
      ''
    ].join('\n')
  )
}

async function completed_run(cocoa: Engine, job: string): Promise<number> {
  const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
  await settle(cocoa)
  write(job, 'poll-state', 'COMPLETED')
  await cocoa.poll_job(job)
  return run_id
}

describe('report attachments', () => {
  it('hands the report an attachment directory and counts what it left there', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'plots')
    attaching_report(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)

    write(job, 'attach-state', 'loss.png table.csv')
    await cocoa.report_run(job, run_id, 'auto')
    expect(cocoa.job(job).runs.record(run_id).status).toBe('SUCCEEDED')
    expect(attachment_dir(job, run_id)).toBe(
      path.join(job, 'runs', String(run_id), 'report', 'attachment')
    )
    expect(read_text(attachment_dir(job, run_id), 'loss.png')).toBe('loss.png\n')
    expect(attachment_count(job, run_id)).toBe(2)

    const world = build_world(cocoa, null)
    expect(world.job_runs[job][String(run_id)].attachments).toBe(2)
  })

  it('leaves nothing behind when the report attached nothing', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'plain')
    attaching_report(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)

    await cocoa.report_run(job, run_id, 'auto')
    expect(is_file(job, 'report', `${run_id}.txt`)).toBe(true)
    expect(exists(job, 'runs', String(run_id), 'report')).toBe(false)
    expect(attachment_count(job, run_id)).toBe(0)
  })

  it('replaces the attachments on a re-run, as it replaces the report', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'rerun')
    attaching_report(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)

    write(job, 'attach-state', 'old.txt')
    await cocoa.report_run(job, run_id, 'auto')
    write(job, 'attach-state', 'new.txt')
    await cocoa.report_run(job, run_id, 'manual')
    expect(fs.readdirSync(attachment_dir(job, run_id))).toEqual(['new.txt'])
  })

  it('goes with the run when the run is deleted', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'deleted')
    attaching_report(job)
    const cocoa = engine(dir)
    cocoa.register(job)
    const run_id = await completed_run(cocoa, job)

    write(job, 'attach-state', 'loss.png')
    await cocoa.report_run(job, run_id, 'auto')
    cocoa.delete_run(job, run_id)
    expect(exists(attachment_dir(job, run_id))).toBe(false)
  })

  it("gives a campaign report its own directory, and its members' in members.json", async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'member')
    const campaign = campaign_folder(dir, 'nightly', ['member'])
    attaching_report(job)
    attaching_report(campaign)
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(campaign)
    const start = await cocoa.start_campaign(campaign, { mesh: 'fine' }, 'human')
    await settle(cocoa)
    const member_id = start.members[0].run_id
    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    write(job, 'attach-state', 'loss.png')
    await cocoa.report_run(job, member_id, 'auto')

    write(campaign, 'attach-state', 'summary.csv')
    await cocoa.campaign_report(campaign, start.run_id)
    const members = JSON.parse(
      read_text(campaign, 'runs', String(start.run_id), 'members.json')
    ) as { members: { attachments: string | null }[] }
    expect(members.members[0].attachments).toBe(attachment_dir(job, member_id))
    expect(is_file(attachment_dir(campaign, start.run_id), 'summary.csv')).toBe(true)

    const world = build_world(cocoa, null)
    expect(world.campaign_runs[campaign][String(start.run_id)].attachments).toBe(1)
  })
})
