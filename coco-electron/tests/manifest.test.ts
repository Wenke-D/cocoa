// Manifest loading and validation. Ported from engine/manifest.rs's inline
// tests: a manifest either loads or it does not, and the message says why.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { load_manifest } from '../src/main/engine/manifest'
import { cleanup_temp_dirs, temp_dir, write } from './support'

afterEach(cleanup_temp_dirs)

const VALID_JOB = `
kind        = "job"
name        = "solver-gpu"
description = "GPU solver sweep"

[render]
template    = "job.sbatch.tmpl"
params      = ["size", "backend"]

[launch]
command     = "./launch.sh"
params      = ["mesh", "gpu"]

[poll]
command     = "./poll.py"

[report]
command     = "./report.py"

[cancel]
command     = "./cancel.sh"
`

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
  it('loads a valid job', () => {
    const dir = temp_dir()
    write(dir, 'coco.toml', VALID_JOB)
    write(dir, 'job.sbatch.tmpl', '#SBATCH --nodes={{ size }}\n./solver --backend {{ backend }}\n')

    const manifest = load_manifest(dir)
    expect(manifest.kind).toBe('job')
    if (manifest.kind !== 'job') return
    expect(manifest.name).toBe('solver-gpu')
    expect(manifest.render_params).toEqual(['size', 'backend'])
    expect(manifest.launch_params).toEqual(['mesh', 'gpu'])
    expect(manifest.launch.words).toEqual(['./launch.sh'])
    expect(manifest.description).toBe('GPU solver sweep')
  })

  it('loads a valid bench', () => {
    const dir = temp_dir()
    write(
      dir,
      'coco.toml',
      `
kind        = "bench"
name        = "nightly-benchmark"

[plan]
command     = "./plan.sh"
params      = ["mesh"]

[report]
command     = "./report.py"
`
    )
    const manifest = load_manifest(dir)
    expect(manifest.kind).toBe('bench')
    if (manifest.kind !== 'bench') return
    expect(manifest.name).toBe('nightly-benchmark')
    expect(manifest.plan_params).toEqual(['mesh'])
  })

  it('accepts empty params lists', () => {
    const dir = temp_dir()
    write(
      dir,
      'coco.toml',
      VALID_JOB.replace('params      = ["size", "backend"]', 'params      = []')
    )
    write(dir, 'job.sbatch.tmpl', '#SBATCH --nodes=4\n')
    expect(() => load_manifest(dir)).not.toThrow()
  })

  it('rejects a missing or unknown kind', () => {
    const dir = temp_dir()
    write(dir, 'coco.toml', 'name = "x"\n')
    expect(refused(dir)).toContain('kind')

    write(dir, 'coco.toml', 'kind = "pipeline"\nname = "x"\n')
    const message = refused(dir)
    expect(message).toContain('job')
    expect(message).toContain('bench')
  })

  it('rejects a missing or empty name', () => {
    const dir = temp_dir()
    write(dir, 'coco.toml', 'kind = "job"\n')
    expect(refused(dir)).toContain('name')

    write(dir, 'coco.toml', 'kind = "job"\nname = ""\n')
    expect(refused(dir)).toContain('non-empty')
  })

  it('rejects unknown keys at every level', () => {
    const dir = temp_dir()
    write(
      dir,
      'coco.toml',
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
      'coco.toml',
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
    write(dir, 'coco.toml', 'kind = "job"\nname = "x"\n')
    expect(refused(dir)).toContain('[render]')

    write(
      dir,
      'coco.toml',
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
      'coco.toml',
      VALID_JOB.replace('command     = "./poll.py"', `command     = "./poll.py 'oops"`)
    )
    write(dir, 'job.sbatch.tmpl', '{{ size }} {{ backend }}\n')
    expect(refused(dir)).toContain('unclosed')
  })

  it('rejects a parameter declared in both render and launch', () => {
    const dir = temp_dir()
    write(
      dir,
      'coco.toml',
      VALID_JOB.replace('params      = ["mesh", "gpu"]', 'params      = ["size", "backend"]')
    )
    write(dir, 'job.sbatch.tmpl', '{{ size }} {{ backend }}\n')
    expect(refused(dir)).toContain('both')
  })

  it('rejects a duplicated parameter name', () => {
    const dir = temp_dir()
    write(
      dir,
      'coco.toml',
      VALID_JOB.replace('params      = ["mesh", "gpu"]', 'params      = ["mesh", "mesh"]')
    )
    write(dir, 'job.sbatch.tmpl', '{{ size }} {{ backend }}\n')
    expect(refused(dir)).toContain('duplicate')
  })

  it('rejects a template that is not a file in the folder', () => {
    const dir = temp_dir()
    write(dir, 'coco.toml', VALID_JOB)
    expect(refused(dir)).toContain('template')
  })

  it('rejects a template that disagrees with [render].params', () => {
    const dir = temp_dir()
    write(dir, 'coco.toml', VALID_JOB)
    write(dir, 'job.sbatch.tmpl', '#SBATCH --nodes={{ size }}\n')
    expect(refused(dir)).toContain('never used: backend')
  })

  it('rejects a folder with no manifest', () => {
    const dir = temp_dir()
    expect(refused(dir)).toContain('coco.toml')
  })

  it('rejects a manifest that does not parse', () => {
    const dir = temp_dir()
    write(dir, 'coco.toml', 'kind = "job"\nname = \n')
    expect(refused(dir)).toContain('does not parse')
  })

  it('rejects a template reached by escaping the folder', () => {
    const dir = temp_dir()
    const folder = path.join(dir, 'exp')
    fs.mkdirSync(folder)
    write(dir, 'outside.tmpl', 'plain\n')
    write(
      folder,
      'coco.toml',
      VALID_JOB.replace(
        'template    = "job.sbatch.tmpl"',
        'template    = "../outside.tmpl"'
      ).replace('params      = ["size", "backend"]', 'params      = []')
    )
    expect(refused(folder)).toContain('inside the folder')
  })
})
