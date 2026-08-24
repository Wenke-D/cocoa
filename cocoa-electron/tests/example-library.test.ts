// End-to-end check of the bundled `examples/` library: registering the folders
// and driving the engine through the mock scripts (launch, poll, bench plan,
// fan-out). No cluster needed — the same folders the user adds by picking
// `examples/` in the Add Folder picker.
//
// The folders are copied into a temp directory rather than driven in place,
// so a test run leaves no `runs/` or `report/` behind in the repository.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { now_stamp } from '../src/main/engine/record'
import {
  EXAMPLES_ROOT,
  cleanup_temp_dirs,
  engine,
  hand_edit,
  record_path,
  settle,
  temp_dir
} from './support'

afterEach(cleanup_temp_dirs)

/** A private copy of the bundled library, with any generated state dropped. */
function example_library(): string {
  const root = path.join(temp_dir(), 'examples')
  fs.cpSync(EXAMPLES_ROOT, root, { recursive: true })
  for (const folder of walk_folders(root)) {
    for (const generated of ['runs', 'report']) {
      fs.rmSync(path.join(folder, generated), { recursive: true, force: true })
    }
  }
  return root
}

function walk_folders(root: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    // The picker's scan skips hidden directories, and so does this, so that
    // what the suite walks is what a user picking the folder would get.
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue
    }
    const child = path.join(root, entry.name)
    if (fs.existsSync(path.join(child, 'cocoa.toml'))) {
      found.push(child)
    } else {
      found.push(...walk_folders(child))
    }
  }
  return found
}

describe('bundled example library', () => {
  it('registers, launches, polls and fans out', async () => {
    const root = example_library()
    const cocoa = engine(path.dirname(root))

    const solver = path.join(root, 'jobs/solver-gpu')
    const flaky = path.join(root, 'jobs/flaky-solver')
    const failing = path.join(root, 'jobs/failing-solver')
    const bench = path.join(root, 'benches/nightly-benchmark')
    for (const folder of [solver, flaky, failing, bench]) {
      cocoa.register(folder)
    }
    expect(cocoa.jobs()).toHaveLength(3)
    expect(cocoa.benches()).toHaveLength(1)

    // A healthy job lifecycle through the first polls. The launch script runs
    // in its own time (§7.1); the record settles once it lands.
    const run_id = await cocoa.start_job(solver, { nodes: '64' }, { gpu: '0' }, 'human')
    expect(await settle(cocoa)).toEqual([])
    expect(cocoa.job(solver).runs.record(run_id).submission_id).toBe(`slurm-${run_id}`)

    const poll = await cocoa.poll_job(solver)
    expect(poll.warnings).toEqual([])
    expect(poll.changed).toHaveLength(1)
    expect(['PENDING', 'RUNNING']).toContain(cocoa.job(solver).runs.record(run_id).status)

    // The bench plans three instances and dispatches them all at once.
    const plan = await cocoa.plan_bench(bench, { sweep: 'nightly' })
    expect(plan).toHaveLength(3)
    expect(plan.map((instance) => instance.job_name)).toEqual([
      'solver-gpu',
      'solver-gpu',
      'flaky-solver'
    ])

    const start = await cocoa.start_bench(bench, { sweep: 'nightly' }, 'human')
    expect(await settle(cocoa)).toEqual([])
    expect(start.members).toHaveLength(3)
    expect(start.launch_failures).toEqual([])
  })

  // The failing example is the other half of the library's point: a run that
  // ends FAILED, carrying the cluster's reason, and never gets a report.
  it('carries a failing job to FAILED with the cluster reason', async () => {
    const root = example_library()
    const cocoa = engine(path.dirname(root))
    const failing = path.join(root, 'jobs/failing-solver')
    cocoa.register(failing)

    const run_id = await cocoa.start_job(
      failing,
      { nodes: '4' },
      { mode: 'fail', profile: 'false', tags: ['smoke'] },
      'human'
    )
    expect(await settle(cocoa)).toEqual([])

    // The mock reports FAILED once the run is 8 s old, and it reads the age
    // from the record on disk — so backdating means editing the file and
    // letting the reconcile pass bring it back in, exactly as a hand-edit
    // would.
    const record = cocoa.job(failing).runs.record(run_id)
    record.history[0].at = now_stamp(new Date(Date.now() - 60_000))
    hand_edit(record_path(failing, run_id), JSON.stringify(record, null, 2))
    cocoa.reconcile()

    const report = await cocoa.poll_job(failing)
    expect(report.changed).toEqual([[run_id, 'FAILED']])
    const polled = cocoa.job(failing).runs.record(run_id)
    expect(polled.status).toBe('FAILED')
    expect(polled.reason).toContain('convergence stalled')
  })
})
