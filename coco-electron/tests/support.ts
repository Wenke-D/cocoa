// Fixtures for the engine tests: real folders, real executable scripts, the
// whole convention. The folders themselves live in `mock/.fixtures` and are
// copied per test; the scenarios they serve are ports of the Rust suite's in
// `coco-egui/tests/coco_engine.rs`, so both engines are held to the same questions.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Coco } from '../src/main/engine/coco'
import type { Config } from '../src/main/engine/coco'

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
export function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-test-')))
  created.push(dir)
  return dir
}

/** Removes every directory `tempDir` handed out. For `afterEach`. */
export function cleanupTempDirs(): void {
  while (created.length > 0) {
    fs.rmSync(created.pop() as string, { recursive: true, force: true })
  }
}

export function write(folder: string, name: string, contents: string): void {
  fs.writeFileSync(path.join(folder, name), contents)
}

export function writeScript(folder: string, name: string, body: string): void {
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
export function handEdit(file: string, contents: string): void {
  fs.writeFileSync(file, contents)
  const later = new Date(Date.now() + 2_000)
  fs.utimesSync(file, later, later)
}

export function engine(dir: string, config?: Config): Coco {
  return config === undefined
    ? new Coco(path.join(dir, 'store.json'))
    : new Coco(path.join(dir, 'store.json'), config)
}

/**
 * Waits for every launch script to land, as the workbench's refresh tick
 * would collect them one by one. Tests assert on the settled record.
 */
export async function settle(coco: Coco): Promise<string[]> {
  const errors = await coco.settleLaunches()
  return errors.map((error) => error.message)
}

export function runDir(folder: string, runId: number): string {
  return path.join(folder, 'runs', String(runId))
}

export function recordPath(folder: string, runId: number): string {
  return path.join(runDir(folder, runId), 'run.json')
}

export function reportPath(folder: string, runId: number): string {
  return path.join(folder, 'report', `${runId}.txt`)
}

export function exists(...parts: string[]): boolean {
  return fs.existsSync(path.join(...parts))
}

export function isFile(...parts: string[]): boolean {
  const file = path.join(...parts)
  return fs.existsSync(file) && fs.statSync(file).isFile()
}

export function readText(...parts: string[]): string {
  return fs.readFileSync(path.join(...parts), 'utf8')
}

/**
 * A copy of the shared job fixture (`mock/.fixtures/job`), registered under
 * `name`. The scripts are real files in the repository; see the fixture
 * README for the state files that drive them.
 */
export function jobFolder(dir: string, name: string): string {
  return copyFixture('job', dir, name)
}

/**
 * A copy of the shared bench fixture, whose plan dispatches one call per
 * named job. `planLines` rewrites that plan for tests that need a bad one.
 */
export function benchFolder(dir: string, name: string, jobNames: string[]): string {
  const folder = copyFixture('bench', dir, name)
  planLines(
    folder,
    jobNames.map((job) => `{"job": "${job}", "params": {"size": "256", "gpu": "0"}}`)
  )
  return folder
}

/** The plan a bench fixture will produce, one call per line. */
export function planLines(folder: string, lines: string[]): void {
  fs.writeFileSync(path.join(folder, 'plan-lines'), lines.join('\n') + '\n')
}

function copyFixture(fixture: 'job' | 'bench', dir: string, name: string): string {
  const folder = path.join(dir, name)
  fs.cpSync(path.join(FIXTURES, fixture), folder, { recursive: true })
  const manifest = path.join(folder, 'coco.toml')
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, 'utf8').replace(`"fixture-${fixture}"`, `"${name}"`)
  )
  return folder
}
