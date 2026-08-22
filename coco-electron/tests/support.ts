// Fixtures for the engine tests: real folders, real executable scripts, the
// whole convention. The folders themselves live in `mock/.fixtures` and are
// copied per test.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '../src/main/engine'
import type { Config } from '../src/main/engine'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The bundled demonstration library, `mock/`. */
export const MOCK_ROOT = path.join(REPO_ROOT, 'mock')

/** The shared experiment folders the suites copy and drive, `mock/.fixtures`. */
const FIXTURES = path.join(MOCK_ROOT, '.fixtures')

const created: string[] = []

/**
 * A temp directory, canonicalized — on macOS `/var` is a symlink to
 * `/private/var`, and the engine keys everything by the canonical path it
 * gets from `register`.
 */
export function temp_dir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-test-')))
  created.push(dir)
  return dir
}

/** Removes every directory `temp_dir` handed out. For `afterEach`. */
export function cleanup_temp_dirs(): void {
  while (created.length > 0) {
    fs.rmSync(created.pop() as string, { recursive: true, force: true })
  }
}

export function write(folder: string, name: string, contents: string): void {
  fs.writeFileSync(path.join(folder, name), contents)
}

export function write_script(folder: string, name: string, body: string): void {
  const file = path.join(folder, name)
  fs.writeFileSync(file, `#!/bin/sh\n${body}`)
  fs.chmodSync(file, 0o755)
}

/**
 * Writes a file the way a person outside coco would, and moves its mtime
 * forward so the change is unambiguous to the reconcile pass. Real hand-edits
 * arrive seconds apart from the engine's own writes; a test writes in the same
 * millisecond, which would otherwise be indistinguishable from "unchanged".
 */
export function hand_edit(file: string, contents: string): void {
  fs.writeFileSync(file, contents)
  const later = new Date(Date.now() + 2_000)
  fs.utimesSync(file, later, later)
}

export function engine(dir: string, config?: Config): Engine {
  return config === undefined
    ? new Engine(path.join(dir, 'store.json'))
    : new Engine(path.join(dir, 'store.json'), config)
}

/**
 * Waits for every launch script to land, as the workbench's refresh tick
 * would collect them one by one. Tests assert on the settled record.
 */
export async function settle(coco: Engine): Promise<string[]> {
  const errors = await coco.settle_launches()
  return errors.map((error) => error.message)
}

export function run_dir(folder: string, run_id: number): string {
  return path.join(folder, 'runs', String(run_id))
}

export function record_path(folder: string, run_id: number): string {
  return path.join(run_dir(folder, run_id), 'run.json')
}

export function report_path(folder: string, run_id: number): string {
  return path.join(folder, 'report', `${run_id}.txt`)
}

export function exists(...parts: string[]): boolean {
  return fs.existsSync(path.join(...parts))
}

export function is_file(...parts: string[]): boolean {
  const file = path.join(...parts)
  return fs.existsSync(file) && fs.statSync(file).isFile()
}

export function read_text(...parts: string[]): string {
  return fs.readFileSync(path.join(...parts), 'utf8')
}

/**
 * A copy of the shared job fixture (`mock/.fixtures/job`), registered under
 * `name`. The scripts are real files in the repository; see the fixture
 * README for the state files that drive them.
 */
export function job_folder(dir: string, name: string): string {
  return copy_fixture('job', dir, name)
}

/**
 * A copy of the shared bench fixture, whose plan dispatches one call per
 * named job. `plan_lines` rewrites that plan for tests that need a bad one.
 */
export function bench_folder(dir: string, name: string, job_names: string[]): string {
  const folder = copy_fixture('bench', dir, name)
  plan_lines(
    folder,
    job_names.map((job) => `{"job": "${job}", "params": {"size": "256", "gpu": "0"}}`)
  )
  return folder
}

/** The plan a bench fixture will produce, one call per line. */
export function plan_lines(folder: string, lines: string[]): void {
  fs.writeFileSync(path.join(folder, 'plan-lines'), lines.join('\n') + '\n')
}

function copy_fixture(fixture: 'job' | 'bench', dir: string, name: string): string {
  const folder = path.join(dir, name)
  fs.cpSync(path.join(FIXTURES, fixture), folder, { recursive: true })
  const manifest = path.join(folder, 'coco.toml')
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, 'utf8').replace(`"fixture-${fixture}"`, `"${name}"`)
  )
  return folder
}
