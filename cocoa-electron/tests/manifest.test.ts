// Manifest loading and validation: a manifest either loads or it does not,
// and the message says why.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { load_manifest } from '../src/main/engine/manifest'
import { cleanup_temp_dirs, temp_dir, write } from './support'

afterEach(cleanup_temp_dirs)

const RENDER_PARAMS = `
[[render.params]]
name        = "size"
type        = "string"
description = "Nodes to request"

[[render.params]]
name        = "backend"
type        = "enum"
values      = ["cuda", "hip"]
description = "Which backend to build"
`

const LAUNCH_PARAMS = `
[[launch.params]]
name        = "mesh"
type        = "string"
description = "Mesh resolution"

[[launch.params]]
name        = "gpu"
type        = "enum"
values      = ["0", "1"]
description = "Which GPU to pin to"
`

const VALID_JOB = `
kind        = "job"
name        = "solver-gpu"
description = "GPU solver sweep"

[render]
template    = "job.sbatch.tmpl"
${RENDER_PARAMS}
[launch]
command     = "./launch.sh"
${LAUNCH_PARAMS}
[poll]
command     = "./poll.py"

[report]
command     = "./report.py"

[cancel]
command     = "./cancel.sh"
`

const TEMPLATE = '#SBATCH --nodes={{ size }}\n./solver --backend {{ backend }}\n'

/** `VALID_JOB` with its launch params replaced by `params` — TOML, or nothing. */
function job_with_launch(params: string): string {
  return VALID_JOB.replace(LAUNCH_PARAMS, params)
}

/** The message of a refused load; fails loudly if the manifest loads. */
function refused(folder: string): string {
  try {
    load_manifest(folder)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected the manifest to be refused')
}

describe('load_manifest', () => {
  it('loads a valid job, its parameters typed and in order', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', VALID_JOB)
    write(dir, 'job.sbatch.tmpl', TEMPLATE)

    const manifest = load_manifest(dir)
    expect(manifest.kind).toBe('job')
    if (manifest.kind !== 'job') {
      return
    }
    expect(manifest.name).toBe('solver-gpu')
    expect(manifest.render_params).toEqual([
      { name: 'size', type: 'string', values: null, list: false, description: 'Nodes to request' },
      {
        name: 'backend',
        type: 'enum',
        values: ['cuda', 'hip'],
        list: false,
        description: 'Which backend to build'
      }
    ])
    expect(manifest.launch_params.map((param) => param.name)).toEqual(['mesh', 'gpu'])
    expect(manifest.launch.words).toEqual(['./launch.sh'])
    expect(manifest.description).toBe('GPU solver sweep')
  })

  it('loads a valid bench', () => {
    const dir = temp_dir()
    write(
      dir,
      'cocoa.toml',
      `
kind        = "bench"
name        = "nightly-benchmark"

[plan]
command     = "./plan.sh"

[[plan.params]]
name        = "mesh"
type        = "string"
description = "Mesh family"

[report]
command     = "./report.py"
`
    )
    const manifest = load_manifest(dir)
    expect(manifest.kind).toBe('bench')
    if (manifest.kind !== 'bench') {
      return
    }
    expect(manifest.name).toBe('nightly-benchmark')
    expect(manifest.plan_params.map((param) => param.name)).toEqual(['mesh'])
  })

  it('loads every shape: string, enum, and lists of both', () => {
    const dir = temp_dir()
    write(
      dir,
      'cocoa.toml',
      job_with_launch(`
[[launch.params]]
name        = "tags"
type        = "string"
list        = true
description = "Tags, one per line"

[[launch.params]]
name        = "backends"
type        = "enum"
values      = ["cuda", "hip"]
list        = true
description = "Backends to try"
`)
    )
    write(dir, 'job.sbatch.tmpl', TEMPLATE)
    const manifest = load_manifest(dir)
    if (manifest.kind !== 'job') {
      throw new Error('expected a job')
    }
    expect(manifest.launch_params).toEqual([
      { name: 'tags', type: 'string', values: null, list: true, description: 'Tags, one per line' },
      {
        name: 'backends',
        type: 'enum',
        values: ['cuda', 'hip'],
        list: true,
        description: 'Backends to try'
      }
    ])
  })

  it('accepts empty params lists', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', VALID_JOB.replace(RENDER_PARAMS, 'params = []\n'))
    write(dir, 'job.sbatch.tmpl', '#SBATCH --nodes=4\n')
    expect(() => load_manifest(dir)).not.toThrow()
  })

  it('refuses the old list of bare names, and says what replaced it', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', job_with_launch('params = ["mesh", "gpu"]\n'))
    write(dir, 'job.sbatch.tmpl', TEMPLATE)
    const message = refused(dir)
    expect(message).toContain('[[launch.params]]')
    expect(message).toContain('§2.1')
  })

  it('requires a name, a known type and a description of every parameter', () => {
    const dir = temp_dir()
    write(dir, 'job.sbatch.tmpl', TEMPLATE)

    write(
      dir,
      'cocoa.toml',
      job_with_launch('[[launch.params]]\ntype = "string"\ndescription = "x"\n')
    )
    expect(refused(dir)).toContain('`name`')

    write(
      dir,
      'cocoa.toml',
      job_with_launch('[[launch.params]]\nname = "mesh"\ndescription = "x"\n')
    )
    expect(refused(dir)).toContain('`type`')

    write(
      dir,
      'cocoa.toml',
      job_with_launch('[[launch.params]]\nname = "mesh"\ntype = "number"\ndescription = "x"\n')
    )
    expect(refused(dir)).toContain('`string` or `enum`')

    write(dir, 'cocoa.toml', job_with_launch('[[launch.params]]\nname = "mesh"\ntype = "string"\n'))
    expect(refused(dir)).toContain('`description`')

    write(
      dir,
      'cocoa.toml',
      job_with_launch('[[launch.params]]\nname = "mesh"\ntype = "string"\ndescription = "  "\n')
    )
    expect(refused(dir)).toContain('`description`')
  })

  it('ties values to enums: required there, refused elsewhere, never empty or repeated', () => {
    const dir = temp_dir()
    write(dir, 'job.sbatch.tmpl', TEMPLATE)

    write(
      dir,
      'cocoa.toml',
      job_with_launch('[[launch.params]]\nname = "gpu"\ntype = "enum"\ndescription = "x"\n')
    )
    expect(refused(dir)).toContain('needs `values`')

    write(
      dir,
      'cocoa.toml',
      job_with_launch(
        '[[launch.params]]\nname = "gpu"\ntype = "enum"\nvalues = []\ndescription = "x"\n'
      )
    )
    expect(refused(dir)).toContain('needs `values`')

    write(
      dir,
      'cocoa.toml',
      job_with_launch(
        '[[launch.params]]\nname = "gpu"\ntype = "enum"\nvalues = ["0", ""]\ndescription = "x"\n'
      )
    )
    expect(refused(dir)).toContain('needs `values`')

    write(
      dir,
      'cocoa.toml',
      job_with_launch(
        '[[launch.params]]\nname = "gpu"\ntype = "enum"\nvalues = ["0", "0"]\ndescription = "x"\n'
      )
    )
    expect(refused(dir)).toContain('twice')

    write(
      dir,
      'cocoa.toml',
      job_with_launch(
        '[[launch.params]]\nname = "mesh"\ntype = "string"\nvalues = ["a"]\ndescription = "x"\n'
      )
    )
    expect(refused(dir)).toContain('only an enum takes `values`')
  })

  it('refuses a `list` that is not a boolean, and the retired flag type', () => {
    const dir = temp_dir()
    write(dir, 'job.sbatch.tmpl', TEMPLATE)

    write(
      dir,
      'cocoa.toml',
      job_with_launch('[[launch.params]]\nname = "profile"\ntype = "flag"\ndescription = "x"\n')
    )
    expect(refused(dir)).toContain('`string` or `enum`')

    write(
      dir,
      'cocoa.toml',
      job_with_launch(
        '[[launch.params]]\nname = "tags"\ntype = "string"\nlist = "yes"\ndescription = "x"\n'
      )
    )
    expect(refused(dir)).toContain('`list` must be true or false')
  })

  it('rejects an unknown key on a parameter', () => {
    const dir = temp_dir()
    write(dir, 'job.sbatch.tmpl', TEMPLATE)
    write(
      dir,
      'cocoa.toml',
      job_with_launch(
        '[[launch.params]]\nname = "mesh"\ntype = "string"\ndefault = "1"\ndescription = "x"\n'
      )
    )
    expect(refused(dir)).toContain('unknown field `default`')
  })

  it('rejects a missing or unknown kind', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', 'name = "x"\n')
    expect(refused(dir)).toContain('kind')

    write(dir, 'cocoa.toml', 'kind = "pipeline"\nname = "x"\n')
    const message = refused(dir)
    expect(message).toContain('job')
    expect(message).toContain('bench')
  })

  it('rejects a missing or empty name', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', 'kind = "job"\n')
    expect(refused(dir)).toContain('name')

    write(dir, 'cocoa.toml', 'kind = "job"\nname = ""\n')
    expect(refused(dir)).toContain('non-empty')
  })

  it('rejects unknown keys at every level', () => {
    const dir = temp_dir()
    write(
      dir,
      'cocoa.toml',
      `
kind = "job"
name = "x"
[render]
template = "job.sbatch.tmpl"
params = []
[launch]
command = "./launch.sh"
params = []
[extra]
`
    )
    write(dir, 'job.sbatch.tmpl', 'plain\n')
    expect(refused(dir)).toContain('unknown field')
  })

  it('rejects a bench carrying job tables', () => {
    const dir = temp_dir()
    write(
      dir,
      'cocoa.toml',
      `
kind = "bench"
name = "b"
[plan]
command = "./plan.sh"
params = []
[launch]
command = "./launch.sh"
params = []
`
    )
    expect(refused(dir)).toContain('unknown field')
  })

  it('rejects missing required tables and commands', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', 'kind = "job"\nname = "x"\n')
    expect(refused(dir)).toContain('[render]')

    write(
      dir,
      'cocoa.toml',
      'kind = "job"\nname = "x"\n[render]\ntemplate = "t.tmpl"\nparams = []\n' +
        '[launch]\ncommand = "./l"\nparams = []\n[poll]\n[report]\ncommand = "./r"\n' +
        '[cancel]\ncommand = "./c"\n'
    )
    write(dir, 't.tmpl', 'plain\n')
    expect(refused(dir)).toContain('[poll]')
  })

  it('rejects a command that does not split into words', () => {
    const dir = temp_dir()
    write(
      dir,
      'cocoa.toml',
      VALID_JOB.replace('command     = "./poll.py"', `command     = "./poll.py 'oops"`)
    )
    write(dir, 'job.sbatch.tmpl', TEMPLATE)
    expect(refused(dir)).toContain('unclosed')
  })

  it('rejects a parameter declared in both render and launch', () => {
    const dir = temp_dir()
    write(
      dir,
      'cocoa.toml',
      job_with_launch('[[launch.params]]\nname = "size"\ntype = "string"\ndescription = "x"\n')
    )
    write(dir, 'job.sbatch.tmpl', TEMPLATE)
    expect(refused(dir)).toContain('both')
  })

  it('rejects a duplicated parameter name', () => {
    const dir = temp_dir()
    write(
      dir,
      'cocoa.toml',
      job_with_launch(
        '[[launch.params]]\nname = "mesh"\ntype = "string"\ndescription = "x"\n' +
          '[[launch.params]]\nname = "mesh"\ntype = "string"\ndescription = "y"\n'
      )
    )
    write(dir, 'job.sbatch.tmpl', TEMPLATE)
    expect(refused(dir)).toContain('duplicate')
  })

  it('rejects a template that is not a file in the folder', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', VALID_JOB)
    expect(refused(dir)).toContain('template')
  })

  it('rejects a template that disagrees with [render].params', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', VALID_JOB)
    write(dir, 'job.sbatch.tmpl', '#SBATCH --nodes={{ size }}\n')
    expect(refused(dir)).toContain('never used: backend')
  })

  it('rejects a folder with no manifest', () => {
    const dir = temp_dir()
    expect(refused(dir)).toContain('cocoa.toml')
  })

  it('rejects a manifest that does not parse', () => {
    const dir = temp_dir()
    write(dir, 'cocoa.toml', 'kind = "job"\nname = \n')
    expect(refused(dir)).toContain('does not parse')
  })

  it('rejects a template reached by escaping the folder', () => {
    const dir = temp_dir()
    const folder = path.join(dir, 'exp')
    fs.mkdirSync(folder)
    write(dir, 'outside.tmpl', 'plain\n')
    write(
      folder,
      'cocoa.toml',
      VALID_JOB.replace(
        'template    = "job.sbatch.tmpl"',
        'template    = "../outside.tmpl"'
      ).replace(RENDER_PARAMS, 'params = []\n')
    )
    expect(refused(folder)).toContain('inside the folder')
  })
})
