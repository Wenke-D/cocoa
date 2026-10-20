// The experiment folders the suites copy and drive: `tests/fixtures`, copied
// per test, and the bundled demonstration library.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

/** The bundled demonstration library, `examples/`. */
export const EXAMPLES_ROOT = path.join(REPO_ROOT, 'examples')

/** The shared experiment folders the suites copy and drive, `tests/fixtures`. */
const FIXTURES = path.resolve(HERE, '..', 'fixtures')

/**
 * A copy of the shared job fixture (`tests/fixtures/job`), registered under
 * `name`. The scripts are real files in the repository; see the fixture
 * README for the state files that drive them.
 */
export function job_folder(dir: string, name: string): string {
  return copy_fixture('job', dir, name)
}

/**
 * A copy of the shared campaign fixture, whose plan dispatches one call per
 * named job. `plan_lines` rewrites that plan for tests that need a bad one.
 */
export function campaign_folder(dir: string, name: string, job_names: string[]): string {
  const folder = copy_fixture('campaign', dir, name)
  plan_lines(
    folder,
    job_names.map((job) => `{"job": "${job}", "params": {"size": "256", "gpu": "0"}}`)
  )
  return folder
}

/** The plan a campaign fixture will produce, one call per line. */
export function plan_lines(folder: string, lines: string[]): void {
  fs.writeFileSync(path.join(folder, 'plan-lines'), lines.join('\n') + '\n')
}

function copy_fixture(fixture: 'job' | 'campaign', dir: string, name: string): string {
  const folder = path.join(dir, name)
  fs.cpSync(path.join(FIXTURES, fixture), folder, { recursive: true })
  const manifest = path.join(folder, 'cocoa.toml')
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, 'utf8').replace(`"fixture-${fixture}"`, `"${name}"`)
  )
  return folder
}
