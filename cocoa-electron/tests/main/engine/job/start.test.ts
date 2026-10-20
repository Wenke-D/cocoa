import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engine, settle } from '../../../support/engine'
import { failure } from '../../../support/failure'
import { exists, is_file, read_text, write, write_script } from '../../../support/files'
import { job_folder } from '../../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('job lifecycle', () => {
  it('runs a job from start through poll to report', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'solver-gpu')
    const cocoa = engine(dir)
    cocoa.register(job)

    const run_id = await cocoa.start_job(job, { size: '256' }, { gpu: '0' }, 'human')
    expect(await settle(cocoa)).toEqual([])

    let record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('STARTING')
    expect(record.submission_id).toBe(`sub-${run_id}`)
    expect(is_file(job, 'runs', String(run_id), 'job.sbatch')).toBe(true)
    expect(read_text(job, 'runs', String(run_id), 'job.sbatch')).toContain('--nodes=256')

    write(job, 'poll-state', 'RUNNING')
    const report = await cocoa.poll_job(job)
    expect(report.changed).toEqual([[run_id, 'RUNNING']])
    expect(cocoa.job(job).runs.record(run_id).status).toBe('RUNNING')

    write(job, 'poll-state', 'COMPLETED')
    await cocoa.poll_job(job)
    expect(cocoa.job(job).runs.record(run_id).status).toBe('COMPLETED')

    await cocoa.report_run(job, run_id, 'auto')
    record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('SUCCEEDED')
    expect(is_file(job, 'report', `${run_id}.txt`)).toBe(true)

    // A succeeded run cannot be cancelled.
    expect(await failure(cocoa.cancel_run(job, run_id))).toContain('cannot be cancelled')
  })

  // A start means "launched" (§7.1): the run exists from the moment the
  // script is spawned, and a script that then fails moves that run to ERROR
  // rather than un-happening it.
  it('lands a failed launch in ERROR and keeps the run id spent', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'broken-launch')
    write_script(job, 'launch.sh', "echo 'cluster refused' >&2\nexit 1\n")
    const cocoa = engine(dir)
    cocoa.register(job)

    const run_id = await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    expect(run_id).toBe(0)

    const errors = await settle(cocoa)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('cluster refused')

    const record = cocoa.job(job).runs.record(run_id)
    expect(record.status).toBe('ERROR')
    expect(record.error).toContain('cluster refused')

    // The failed id is consumed: the next start gets id 1, never 0.
    write_script(job, 'launch.sh', "echo 'COCOA_RETURN: ok-1'\n")
    expect(await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')).toBe(1)
    await settle(cocoa)
  })

  // A script that cannot be started at all — no interpreter, no file — is a
  // folder problem the submitter can fix now, so it refuses the start itself
  // and no run is recorded.
  it('refuses a start whose launch script cannot spawn', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'unspawnable')
    fs.rmSync(path.join(job, 'launch.sh'))
    const cocoa = engine(dir)
    cocoa.register(job)

    await failure(cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human'))
    expect(exists(job, 'runs', '0', 'run.json')).toBe(false)
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
    const cocoa = engine(dir)
    cocoa.register(job)

    // Every field left empty, which is what an untouched start form sends.
    expect(await failure(cocoa.start_job(job, { size: '' }, { gpu: '' }, 'human'))).toContain(
      'size'
    )

    // One field filled, the other blank or whitespace.
    expect(await failure(cocoa.start_job(job, { size: '256' }, { gpu: '  ' }, 'human'))).toContain(
      'gpu'
    )

    // Nothing was launched, and no run id was burned on a refused start.
    expect(exists(job, 'runs')).toBe(false)

    // The same start with real values goes through.
    await cocoa.start_job(job, { size: '256' }, { gpu: '0' }, 'human')
    await settle(cocoa)
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
      'cocoa.toml',
      fs
        .readFileSync(path.join(job, 'cocoa.toml'), 'utf8')
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
    write_script(job, 'launch.sh', 'printf \'%s\\n\' "$@" > argv\necho "COCOA_RETURN: sub"\n')
    const cocoa = engine(dir)
    cocoa.register(job)

    const run_id = await cocoa.start_job(
      job,
      { size: '2', fast: 'true', backends: ['hip', 'cuda'] },
      { gpu: '1', profile: 'false', tags: ['a', 'b'] },
      'human'
    )
    await settle(cocoa)

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
    expect(cocoa.job(job).runs.record(run_id).launch).toEqual({
      gpu: '1',
      profile: 'false',
      tags: ['a', 'b']
    })

    // A wrong shape is refused with every fault named, nothing launched.
    const message = await failure(
      cocoa.start_job(
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
