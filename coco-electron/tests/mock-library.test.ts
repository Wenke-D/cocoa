// End-to-end check of the bundled `mock/` library: registering the folders
// and driving the engine through the mock scripts (launch, poll, bench plan,
// fan-out). No cluster needed — the same folders the user adds by picking
// `mock/` in the Add Folder picker.
//
// Ported from tests/coco_mock_library.rs, with one change: the folders are
// copied into a temp directory rather than driven in place, so a test run
// leaves no `runs/` or `report/` behind in the repository.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nowStamp } from '../src/main/engine/record'
import {
  MOCK_ROOT,
  cleanupTempDirs,
  engine,
  handEdit,
  recordPath,
  settle,
  tempDir
} from './support'

afterEach(cleanupTempDirs)

/** A private copy of the bundled library, with any generated state dropped. */
function mockLibrary(): string {
  const root = path.join(tempDir(), 'mock')
  fs.cpSync(MOCK_ROOT, root, { recursive: true })
  for (const folder of walkFolders(root)) {
    for (const generated of ['runs', 'report']) {
      fs.rmSync(path.join(folder, generated), { recursive: true, force: true })
    }
  }
  return root
}

function walkFolders(root: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    // The picker's scan skips hidden directories, and so does this: the
    // fixtures under `.fixtures` are not part of the demonstration library.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const child = path.join(root, entry.name)
    if (fs.existsSync(path.join(child, 'coco.toml'))) found.push(child)
    else found.push(...walkFolders(child))
  }
  return found
}

describe('bundled mock library', () => {
  it('registers, launches, polls and fans out', async () => {
    const root = mockLibrary()
    const coco = engine(path.dirname(root))

    const solver = path.join(root, 'jobs/solver-gpu')
    const flaky = path.join(root, 'jobs/flaky-solver')
    const failing = path.join(root, 'jobs/failing-solver')
    const bench = path.join(root, 'benches/nightly-benchmark')
    for (const folder of [solver, flaky, failing, bench]) {
      coco.register(folder)
    }
    expect(coco.entities()).toHaveLength(4)

    // A healthy job lifecycle through the first polls. The launch script runs
    // in its own time (§7.1); the record settles once it lands.
    const runId = await coco.startJob(solver, { nodes: '64' }, { gpu: '0' }, 'human')
    expect(await settle(coco)).toEqual([])
    expect(coco.runRecord(solver, runId).submission_id).toBe(`slurm-${runId}`)

    const poll = await coco.pollJob(solver)
    expect(poll.warnings).toEqual([])
    expect(poll.changed).toHaveLength(1)
    expect(['PENDING', 'RUNNING']).toContain(coco.runRecord(solver, runId).status)

    // The bench plans three instances and dispatches them all at once.
    const plan = await coco.planBench(bench, { sweep: 'nightly' })
    expect(plan).toHaveLength(3)
    expect(plan.map((instance) => instance.jobName)).toEqual([
      'solver-gpu',
      'solver-gpu',
      'flaky-solver'
    ])

    const start = await coco.startBench(bench, { sweep: 'nightly' }, 'human')
    expect(await settle(coco)).toEqual([])
    expect(start.members).toHaveLength(3)
    expect(start.launchFailures).toEqual([])
  })

  // The failing mock is the other half of the library's point: a run that
  // ends FAILED, carrying the cluster's reason, and never gets a report.
  it('carries a failing job to FAILED with the cluster reason', async () => {
    const root = mockLibrary()
    const coco = engine(path.dirname(root))
    const failing = path.join(root, 'jobs/failing-solver')
    coco.register(failing)

    const runId = await coco.startJob(failing, { nodes: '4' }, { mode: 'fail' }, 'human')
    expect(await settle(coco)).toEqual([])

    // The mock reports FAILED once the run is 8 s old, and it reads the age
    // from the record on disk — so backdating means editing the file and
    // letting the reconcile pass bring it back in, exactly as a hand-edit
    // would.
    const record = coco.runRecord(failing, runId)
    record.history[0].at = nowStamp(new Date(Date.now() - 60_000))
    handEdit(recordPath(failing, runId), JSON.stringify(record, null, 2))
    coco.reconcile()

    const report = await coco.pollJob(failing)
    expect(report.changed).toEqual([[runId, 'FAILED']])
    const polled = coco.runRecord(failing, runId)
    expect(polled.status).toBe('FAILED')
    expect(polled.reason).toContain('convergence stalled')
  })
})
