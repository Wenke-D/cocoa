// The engine: every operation the convention defines, over registered
// folders (convention §1–§12). Ported from engine/coco.rs, then restructured
// 2026-08-19 at the user's direction: **memory is the truth**.
//
// The engine holds the whole domain state in memory — manifests, job and
// bench records. Reads never touch the disk. Writes mutate memory first and
// write through to the experiment folder (same file formats, so folders stay
// inspectable and interchangeable with the Rust engine). A reconcile pass
// (run on every refresh tick) pulls externally-edited files back into memory
// by mtime; between passes, memory wins — a concurrent hand-edit can lose,
// which is accepted (local, single instance).
//
// Script invocations are async, because the Electron main process must not
// block.

import fs from 'node:fs'
import path from 'node:path'
import { EngineError, asEngineError } from './errors'
import * as invoke from './invoke'
import type { Invocation, Running } from './invoke'
import { loadManifest } from './manifest'
import type { JobManifest, Manifest } from './manifest'
import { allParams, applyStatus, newRunRecord, nowStamp } from './record'
import type {
  BenchMember,
  BenchMembersFile,
  BenchRecord,
  LaunchFailure,
  RunOrigin,
  RunRecord,
  Trigger
} from './record'
import { fromPollWord, isCancellable, isTerminal } from './status'
import type { Status } from './status'
import { allocateRunId, loadStore, saveStore, writeAtomic } from './store'
import type { StoreData } from './store'
import * as template from './template'

/** Timeouts (convention §6), in milliseconds. */
export interface Config {
  launchTimeout: number
  pollTimeout: number
  cancelTimeout: number
  planTimeout: number
  reportTimeout: number
}

export const DEFAULT_CONFIG: Config = {
  launchTimeout: 60_000,
  pollTimeout: 60_000,
  cancelTimeout: 60_000,
  planTimeout: 120_000,
  reportTimeout: 600_000
}

export interface EntityView {
  path: string
  manifest: Manifest | null
  manifestError: EngineError | null
}

export interface JobRunView {
  runId: number
  record: RunRecord | null
  recordError: EngineError | null
}

export interface BenchRunView {
  runId: number
  record: BenchRecord | null
  recordError: EngineError | null
}

export interface PollReport {
  polled: number
  changed: [number, Status][]
  warnings: string[]
}

export interface PlanInstance {
  jobPath: string
  jobName: string
  render: Record<string, string>
  launch: Record<string, string>
}

export interface BenchStart {
  runId: number
  members: BenchMember[]
  launchFailures: LaunchFailure[]
}

export interface BenchStatusView {
  status: Status
  missingMembers: string[]
  succeeded: number
  failed: number
  cancelled: number
  running: number
  errors: number
}

export interface RefreshReport {
  polls: number
  pollChanges: [number, Status][]
  pollWarnings: string[]
  pollErrors: EngineError[]
  reportsRun: number
  reportErrors: EngineError[]
  launchErrors: EngineError[]
}

export type ReportMode = 'auto' | 'manual'

interface LaunchInFlight {
  path: string
  runId: number
  script: string
  running: Running
}

interface ResolvedMember {
  runId: number
  jobName: string
  jobPath: string | null
  record: RunRecord | null
}

interface PlanLine {
  job: string
  params: Record<string, string>
}

interface ManifestSlot {
  manifest: Manifest | null
  error: EngineError | null
}

interface RecordSlot<T> {
  record: T | null
  error: EngineError | null
}

export class Coco {
  private readonly storePath: string
  private store: StoreData
  private readonly config: Config
  private launching: LaunchInFlight[] = []

  // ------------------------------------------------------------------
  // The in-memory truth. store.json persists only the global state
  // (registered folders, last_args, the run-id counter); everything else
  // lives here and is written through to the folders as records.
  // ------------------------------------------------------------------
  private manifests = new Map<string, ManifestSlot>()
  private jobRecords = new Map<string, Map<number, RecordSlot<RunRecord>>>()
  private benchRecords = new Map<string, Map<number, RecordSlot<BenchRecord>>>()
  /** mtimes of record files as this engine last read or wrote them; the
   * reconcile pass re-reads a file only when the disk disagrees. */
  private fileMtimes = new Map<string, number>()

  constructor(storePath: string, config: Config = DEFAULT_CONFIG) {
    this.storePath = storePath
    this.store = loadStore(storePath)
    this.config = config
    this.reconcile()
  }

  lastArgs(): Record<string, Record<string, string>> {
    return this.store.last_args
  }

  // ------------------------------------------------------------------
  // Reconciliation: disk → memory, for changes this engine did not make
  // (a hand-edited run.json, an edited coco.toml, a deleted run folder).
  // Manifests are small and re-read every pass, as the Rust engine does
  // (§4); records re-read only when their mtime moved.
  // ------------------------------------------------------------------

  reconcile(): void {
    const registered = new Set(this.store.entities)
    for (const folder of [...this.manifests.keys()]) {
      if (!registered.has(folder)) {
        this.manifests.delete(folder)
        this.jobRecords.delete(folder)
        this.benchRecords.delete(folder)
      }
    }

    for (const folder of this.store.entities) {
      let manifest: Manifest | null = null
      let error: EngineError | null = null
      try {
        manifest = loadManifest(folder)
      } catch (cause) {
        error = asEngineError(folder, cause)
      }
      this.manifests.set(folder, { manifest, error })
      if (manifest === null) continue

      if (manifest.kind === 'job') {
        this.reconcileRuns(folder, mapFor(this.jobRecords, folder))
      } else {
        this.reconcileRuns(folder, mapFor(this.benchRecords, folder))
      }
    }
  }

  private reconcileRuns<T>(folder: string, slots: Map<number, RecordSlot<T>>): void {
    const runsDir = path.join(folder, 'runs')
    let entries: string[]
    try {
      entries = fs.readdirSync(runsDir)
    } catch {
      entries = []
    }
    const onDisk = new Set<number>()
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue
      const runId = Number(entry)
      onDisk.add(runId)
      const recordPath = path.join(runsDir, entry, 'run.json')
      let mtime: number
      try {
        mtime = fs.statSync(recordPath).mtimeMs
      } catch {
        slots.set(runId, {
          record: null,
          error: EngineError.notFound(`run ${runId} in ${folder}`)
        })
        continue
      }
      if (this.fileMtimes.get(recordPath) === mtime && slots.has(runId)) continue
      try {
        const text = fs.readFileSync(recordPath, 'utf8')
        slots.set(runId, { record: JSON.parse(text) as T, error: null })
      } catch (cause) {
        slots.set(runId, {
          record: null,
          error: EngineError.store(
            recordPath,
            `run.json does not parse: ${(cause as Error).message}`
          )
        })
      }
      this.fileMtimes.set(recordPath, mtime)
    }
    for (const runId of [...slots.keys()]) {
      if (!onDisk.has(runId)) slots.delete(runId)
    }
  }

  // ------------------------------------------------------------------
  // Registration and listing (all answered from memory)
  // ------------------------------------------------------------------

  register(folder: string): void {
    let canonical: string
    try {
      canonical = fs.realpathSync(folder)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }
    if (!fs.statSync(canonical).isDirectory()) {
      throw EngineError.validation(`${canonical} is not a folder`)
    }
    if (this.store.entities.includes(canonical)) return
    const manifest = loadManifest(canonical)
    const collision = this.findNameCollision(manifest.name)
    if (collision !== null) throw EngineError.nameCollision(collision)
    this.store.entities.push(canonical)
    saveStore(this.storePath, this.store)
    this.reconcile()
  }

  unregister(folder: string): void {
    let canonical: string
    try {
      canonical = fs.realpathSync(folder)
    } catch {
      canonical = folder
    }
    const before = this.store.entities.length
    this.store.entities = this.store.entities.filter((entry) => entry !== canonical)
    if (this.store.entities.length === before) {
      throw EngineError.notFound(`entity ${canonical}`)
    }
    saveStore(this.storePath, this.store)
    this.reconcile()
  }

  /** All registered entities, from the in-memory truth. */
  entities(): EntityView[] {
    return this.store.entities.map((folder) => {
      const slot = this.manifests.get(folder)
      return {
        path: folder,
        manifest: slot?.manifest ?? null,
        manifestError:
          slot?.error ?? (slot === undefined ? EngineError.notFound(`entity ${folder}`) : null)
      }
    })
  }

  jobManifest(folder: string): JobManifest {
    const slot = this.manifests.get(folder)
    if (slot === undefined) {
      throw EngineError.notFound(`entity ${folder}`)
    }
    if (slot.manifest === null) {
      throw slot.error ?? EngineError.manifest(folder, 'manifest is unusable')
    }
    if (slot.manifest.kind !== 'job') {
      throw EngineError.validation(`${folder} is a bench, not a job`)
    }
    return slot.manifest
  }

  benchManifest(folder: string): Exclude<Manifest, JobManifest> {
    const slot = this.manifests.get(folder)
    if (slot === undefined) {
      throw EngineError.notFound(`entity ${folder}`)
    }
    if (slot.manifest === null) {
      throw slot.error ?? EngineError.manifest(folder, 'manifest is unusable')
    }
    if (slot.manifest.kind !== 'bench') {
      throw EngineError.validation(`${folder} is a job, not a bench`)
    }
    return slot.manifest
  }

  /** A job's history, newest first, from memory. */
  jobRuns(folder: string): JobRunView[] {
    return viewsOf(this.jobRecords.get(folder))
  }

  benchRuns(folder: string): BenchRunView[] {
    return viewsOf(this.benchRecords.get(folder))
  }

  runRecord(folder: string, runId: number): RunRecord {
    const slot = this.jobRecords.get(folder)?.get(runId)
    if (slot === undefined) {
      throw EngineError.notFound(`run ${runId} in ${folder}`)
    }
    if (slot.record === null) {
      throw slot.error ?? EngineError.notFound(`run ${runId} in ${folder}`)
    }
    return slot.record
  }

  benchRecord(folder: string, runId: number): BenchRecord {
    const slot = this.benchRecords.get(folder)?.get(runId)
    if (slot === undefined) {
      throw EngineError.notFound(`bench run ${runId} in ${folder}`)
    }
    if (slot.record === null) {
      throw slot.error ?? EngineError.notFound(`bench run ${runId} in ${folder}`)
    }
    return slot.record
  }

  // ------------------------------------------------------------------
  // Job operations
  // ------------------------------------------------------------------

  /**
   * Starts a job (§7.1): renders the template, spawns `launch` — a start
   * means "launched", not waited-for — and records the run with an empty
   * submission id, which is what marks it as still launching.
   */
  async startJob(
    folder: string,
    render: Record<string, string>,
    launch: Record<string, string>,
    by: Trigger
  ): Promise<number> {
    const origin: RunOrigin = by === 'human' ? { by: 'human' } : { by: 'agent' }
    return this.startJobInner(folder, render, launch, origin)
  }

  private async startJobInner(
    folder: string,
    render: Record<string, string>,
    launch: Record<string, string>,
    origin: RunOrigin
  ): Promise<number> {
    const manifest = this.jobManifest(folder)
    validateParams(manifest.render_params, render, 'render')
    validateParams(manifest.launch_params, launch, 'launch')

    // The template is read from disk at the moment of use — it is authored
    // content, not engine state, and must be as fresh as the start.
    const templatePath = path.join(folder, manifest.template)
    let source: string
    try {
      source = fs.readFileSync(templatePath, 'utf8')
    } catch (cause) {
      throw EngineError.io(templatePath, cause)
    }
    try {
      template.analyze(source, manifest.render_params)
    } catch (cause) {
      throw EngineError.template(templatePath, (cause as Error).message)
    }
    let rendered: string
    try {
      rendered = template.render(source, render)
    } catch (cause) {
      throw EngineError.template(templatePath, (cause as Error).message)
    }

    const runId = allocateRunId(this.storePath, this.store)
    const runDir = path.join(folder, 'runs', String(runId))
    try {
      fs.mkdirSync(runDir, { recursive: true })
    } catch (cause) {
      throw EngineError.io(runDir, cause)
    }

    const artifact = artifactName(manifest.template)
    try {
      fs.writeFileSync(path.join(runDir, artifact), rendered)
    } catch (cause) {
      throw EngineError.io(path.join(runDir, artifact), cause)
    }

    const argv = [...manifest.launch.words]
    argv.push('--script', `runs/${runId}/${artifact}`)
    argv.push('--run', String(runId))
    for (const name of Object.keys(launch).sort()) {
      argv.push(`--${name}`, launch[name])
    }

    // Only a script that cannot be started at all refuses the start itself:
    // that is a folder problem the submitter can act on now.
    let running: Running
    try {
      running = await invoke.spawn(folder, argv, this.config.launchTimeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }

    const record = newRunRecord(runId, '', sorted(render), sorted(launch), origin, nowStamp())
    this.writeRunRecord(folder, record)
    this.launching.push({
      path: folder,
      runId,
      script: manifest.launch.display,
      running
    })

    this.store.last_args[manifest.name] = { ...sorted(render), ...sorted(launch) }
    saveStore(this.storePath, this.store)
    return runId
  }

  /** Polls one job's active runs through the job's own `poll` script (§7.2, §10). */
  async pollJob(folder: string): Promise<PollReport> {
    const manifest = this.jobManifest(folder)
    const active: [number, RunRecord][] = []
    for (const view of this.jobRuns(folder)) {
      const record = view.record
      // A run whose launch script has not returned yet has no submission id
      // to poll by; it is the launch's business until harvest collects it.
      if (record !== null && !isTerminal(record.status) && record.submission_id !== '') {
        active.push([record.run_id, record])
      }
    }

    const report: PollReport = { polled: active.length, changed: [], warnings: [] }
    if (active.length === 0) return report

    const bySubmission = new Map<string, [number, RunRecord]>()
    for (const [runId, record] of active) bySubmission.set(record.submission_id, [runId, record])
    const submissions = [...bySubmission.keys()].sort()

    const argv = [...manifest.poll.words, '--submissions', submissions.join(',')]
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.pollTimeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }

    if (!invoke.invocationOk(invocation)) {
      const reason = `poll script failed: ${invoke.invocationOutput(invocation)}`
      const now = nowStamp()
      for (const [runId, record] of bySubmission.values()) {
        if (record.status !== 'UNREACHABLE') {
          applyStatus(record, 'UNREACHABLE', now, reason)
          this.writeRunRecord(folder, record)
          report.changed.push([runId, 'UNREACHABLE'])
        }
      }
      throw EngineError.invocation(
        manifest.poll.display,
        invocation.exit,
        invocation.timedOut,
        invoke.invocationOutput(invocation)
      )
    }

    const lines = invoke.cocoReturnLines(invocation.stdout)
    const statusLines = lines.filter((line) => line.split(/\s+/)[0] !== 'UNREACHABLE')
    const unreachableReasons = lines
      .filter((line) => line.split(/\s+/)[0] === 'UNREACHABLE')
      .map((line) => line.replace(/^UNREACHABLE\s*/, '').trim())

    const now = nowStamp()
    if (statusLines.length > 0) {
      for (const line of statusLines) {
        const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/)
        if (match === null) {
          report.warnings.push(`malformed poll line ignored: \`${line}\``)
          continue
        }
        const [, submission, word, rest] = match
        const reason = rest?.trim() !== '' ? rest?.trim() : undefined
        const entry = bySubmission.get(submission)
        if (entry === undefined) {
          report.warnings.push(`poll line for unknown submission \`${submission}\` ignored`)
          continue
        }
        const [runId, record] = entry
        const status = fromPollWord(word)
        if (status === null) {
          report.warnings.push(`unknown status \`${word}\` for run ${runId} ignored`)
          continue
        }
        if (isTerminal(record.status)) continue
        if (record.status !== status) {
          applyStatus(record, status, now, reason)
          this.writeRunRecord(folder, record)
          report.changed.push([runId, status])
        }
      }
    } else if (unreachableReasons.length > 0) {
      const last = unreachableReasons[unreachableReasons.length - 1]
      const reason = last !== '' ? last : undefined
      for (const [runId, record] of bySubmission.values()) {
        if (record.status !== 'UNREACHABLE') {
          applyStatus(record, 'UNREACHABLE', now, reason)
          this.writeRunRecord(folder, record)
          report.changed.push([runId, 'UNREACHABLE'])
        }
      }
    }
    return report
  }

  /**
   * Runs the report script for one run (§7.3, §11). The record is the live
   * in-memory truth: a poll advancing the run while the (possibly long)
   * report script runs mutates the same object, so the outcomes compose.
   */
  async reportRun(folder: string, runId: number, mode: ReportMode): Promise<void> {
    const manifest = this.jobManifest(folder)
    const record = this.runRecord(folder, runId)

    const eligible =
      mode === 'auto'
        ? record.status === 'COMPLETED' || record.status === 'ANALYZING'
        : record.status === 'COMPLETED' ||
          record.status === 'ANALYZING' ||
          record.status === 'SUCCEEDED' ||
          (record.status === 'ERROR' &&
            record.history.some((change) => change.status === 'COMPLETED'))
    if (!eligible) {
      throw EngineError.validation(`run ${runId} (${record.status}) cannot be reported`)
    }

    if (record.status !== 'ANALYZING') {
      applyStatus(record, 'ANALYZING', nowStamp())
      this.writeRunRecord(folder, record)
    }

    const reportDir = path.join(folder, 'report')
    try {
      fs.mkdirSync(reportDir, { recursive: true })
    } catch (cause) {
      throw EngineError.io(reportDir, cause)
    }
    const argv = [
      ...manifest.report.words,
      '--run',
      String(runId),
      '--submission',
      record.submission_id
    ]
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.reportTimeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }

    const reportPath = path.join(reportDir, `${runId}.txt`)
    const fileOk = fs.existsSync(reportPath) && fs.statSync(reportPath).isFile()

    if (invoke.invocationOk(invocation) && fileOk) {
      applyStatus(record, 'SUCCEEDED', nowStamp())
      delete record.error
      this.writeRunRecord(folder, record)
      return
    }

    const detail = invoke.invocationOk(invocation)
      ? `report script exited 0 but produced no report/${runId}.txt`
      : invoke.invocationOutput(invocation)
    const error = EngineError.invocation(
      manifest.report.display,
      invocation.exit,
      invocation.timedOut,
      detail
    )
    if (mode === 'auto') {
      applyStatus(record, 'ERROR', nowStamp())
      record.error = detail
      this.writeRunRecord(folder, record)
    }
    throw error
  }

  /** Cancels one run through the job's `cancel` script (§7.4). */
  async cancelRun(folder: string, runId: number): Promise<void> {
    const manifest = this.jobManifest(folder)
    const record = this.runRecord(folder, runId)
    if (!isCancellable(record.status)) {
      throw EngineError.validation(`run ${runId} (${record.status}) cannot be cancelled`)
    }
    if (record.submission_id === '') {
      throw EngineError.validation(
        `run ${runId} is still launching; there is no submission to cancel yet`
      )
    }
    const argv = [...manifest.cancel.words, '--submission', record.submission_id]
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.cancelTimeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }
    if (invoke.invocationOk(invocation)) {
      applyStatus(record, 'CANCELLING', nowStamp())
      this.writeRunRecord(folder, record)
      return
    }
    throw EngineError.invocation(
      manifest.cancel.display,
      invocation.exit,
      invocation.timedOut,
      invoke.invocationOutput(invocation)
    )
  }

  // ------------------------------------------------------------------
  // Bench operations
  // ------------------------------------------------------------------

  /** Runs `plan` and validates every instance before anything is submitted (§8.1). */
  async planBench(folder: string, params: Record<string, string>): Promise<PlanInstance[]> {
    const manifest = this.benchManifest(folder)
    validateParams(manifest.plan_params, params, 'plan')

    const argv = [...manifest.plan.words]
    for (const name of Object.keys(params).sort()) {
      argv.push(`--${name}`, params[name])
    }
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.planTimeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }
    if (!invoke.invocationOk(invocation)) {
      throw EngineError.invocation(
        manifest.plan.display,
        invocation.exit,
        invocation.timedOut,
        invoke.invocationOutput(invocation)
      )
    }

    const lines = invoke.cocoReturnLines(invocation.stdout)
    if (lines.length === 0) {
      throw EngineError.validation('plan produced no instances; a bench start needs at least one')
    }

    // Every call is checked, not just up to the first bad one (§8.1).
    const instances: PlanInstance[] = []
    const problems: string[] = []
    for (const [index, line] of lines.entries()) {
      const call = index + 1
      let planned: PlanLine
      try {
        planned = parsePlanLine(line)
      } catch (cause) {
        problems.push(`call ${call}: ${(cause as Error).message}`)
        continue
      }
      const found = this.findJobByName(planned.job)
      if (found === null) {
        problems.push(`call ${call}: \`${planned.job}\` is not a registered job`)
        continue
      }
      const [jobPath, job] = found
      const expected = new Set([...job.render_params, ...job.launch_params])
      const provided = new Set(Object.keys(planned.params))
      const missing = [...expected].filter((name) => !provided.has(name)).sort()
      const extra = [...provided].filter((name) => !expected.has(name)).sort()
      if (missing.length > 0 || extra.length > 0) {
        const wrong: string[] = []
        if (missing.length > 0) wrong.push(`missing ${describeNames(missing)}`)
        if (extra.length > 0) wrong.push(`extra ${describeNames(extra)}`)
        problems.push(`call ${call}: job \`${planned.job}\` — ${wrong.join(', ')}`)
        continue
      }
      const render: Record<string, string> = {}
      const launch: Record<string, string> = {}
      for (const [name, value] of Object.entries(planned.params)) {
        if (job.render_params.includes(name)) render[name] = value
        else launch[name] = value
      }
      instances.push({ jobPath, jobName: job.name, render, launch })
    }

    if (problems.length > 0) {
      throw EngineError.invalidPlan(lines.length, problems)
    }
    return instances
  }

  /** Starts a bench: validates the plan, then dispatches every instance (§8.2). */
  async startBench(
    folder: string,
    params: Record<string, string>,
    by: Trigger
  ): Promise<BenchStart> {
    const manifest = this.benchManifest(folder)
    const instances = await this.planBench(folder, params)
    const benchRunId = allocateRunId(this.storePath, this.store)

    const members: BenchMember[] = []
    const launchFailures: LaunchFailure[] = []
    for (const [index, instance] of instances.entries()) {
      try {
        const runId = await this.startJobInner(instance.jobPath, instance.render, instance.launch, {
          by: 'bench',
          run_id: benchRunId,
          name: manifest.name,
          call: index + 1
        })
        members.push({ run_id: runId, job: instance.jobName })
      } catch (cause) {
        launchFailures.push({
          job: instance.jobName,
          params: { ...instance.render, ...instance.launch },
          error: (cause as Error).message
        })
      }
    }

    const record: BenchRecord = {
      run_id: benchRunId,
      bench: manifest.name,
      by,
      started_at: nowStamp(),
      params: sorted(params),
      planned: members.length + launchFailures.length,
      members,
      launch_failures: launchFailures
    }
    this.writeBenchRecord(folder, record)
    this.store.last_args[manifest.name] = sorted(params)
    saveStore(this.storePath, this.store)

    return { runId: benchRunId, members, launchFailures }
  }

  /** Runs the bench's report over its members' results (§8.3). */
  async benchReport(folder: string, runId: number): Promise<void> {
    const manifest = this.benchManifest(folder)
    const record = this.benchRecord(folder, runId)

    const resolved = this.resolveMembers(record)
    const blockReasons: string[] = []
    if (record.launch_failures.length > 0) {
      blockReasons.push(`${record.launch_failures.length} launch(es) failed`)
    }
    for (const member of resolved) {
      if (member.record === null) {
        blockReasons.push(`member \`${member.jobName}\` run ${member.runId} cannot be resolved`)
      } else if (member.record.status !== 'SUCCEEDED') {
        blockReasons.push(
          `member \`${member.jobName}\` run ${member.runId} ended ${member.record.status}`
        )
      }
    }
    if (blockReasons.length > 0) {
      throw EngineError.validation(`no bench report: ${blockReasons.join(', ')}`)
    }

    const runDir = path.join(folder, 'runs', String(runId))
    const membersFile: BenchMembersFile = {
      run_id: runId,
      bench: record.bench,
      params: record.params,
      members: resolved.map((member) => {
        const memberRecord = member.record as RunRecord
        const jobPath = member.jobPath as string
        return {
          run_id: member.runId,
          job: member.jobName,
          params: allParams(memberRecord),
          submission_id: memberRecord.submission_id,
          report: path.join(jobPath, 'report', `${member.runId}.txt`)
        }
      })
    }
    writeAtomic(path.join(runDir, 'members.json'), JSON.stringify(membersFile, null, 2))

    const reportDir = path.join(folder, 'report')
    try {
      fs.mkdirSync(reportDir, { recursive: true })
    } catch (cause) {
      throw EngineError.io(reportDir, cause)
    }
    const argv = [
      ...manifest.report.words,
      '--run',
      String(runId),
      '--members',
      `runs/${runId}/members.json`
    ]
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.reportTimeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }

    const reportPath = path.join(reportDir, `${runId}.txt`)
    const ok = invoke.invocationOk(invocation) && fs.existsSync(reportPath)
    const error = ok
      ? undefined
      : invoke.invocationOk(invocation)
        ? `report script exited 0 but produced no report/${runId}.txt`
        : invoke.invocationOutput(invocation)
    record.report = { attempted: true, ...(error !== undefined ? { error } : {}) }
    this.writeBenchRecord(folder, record)

    if (!ok) {
      throw EngineError.invocation(
        manifest.report.display,
        invocation.exit,
        invocation.timedOut,
        error ?? ''
      )
    }
  }

  /** Cancels a bench run by cancelling its still-cancellable members (§3, §9.1). */
  async cancelBench(
    folder: string,
    runId: number
  ): Promise<{ runId: number; job: string; ok: boolean; error?: string }[]> {
    const record = this.benchRecord(folder, runId)
    const results: { runId: number; job: string; ok: boolean; error?: string }[] = []
    for (const member of record.members) {
      const found = this.findJobByName(member.job)
      if (found === null) {
        throw EngineError.notFound(`member job \`${member.job}\` of bench run ${runId}`)
      }
      const [jobPath] = found
      let memberRecord: RunRecord
      try {
        memberRecord = this.runRecord(jobPath, member.run_id)
      } catch {
        continue
      }
      if (!isCancellable(memberRecord.status)) continue
      try {
        await this.cancelRun(jobPath, member.run_id)
        results.push({ runId: member.run_id, job: member.job, ok: true })
      } catch (cause) {
        results.push({
          runId: member.run_id,
          job: member.job,
          ok: false,
          error: (cause as Error).message
        })
      }
    }
    return results
  }

  /** Derives a bench run's status (§9.1). Never stored, computed from memory. */
  benchStatus(folder: string, runId: number): BenchStatusView {
    const record = this.benchRecord(folder, runId)
    const resolved = this.resolveMembers(record)
    const missing = resolved.filter((member) => member.record === null).map((m) => m.jobName)
    const members = resolved
      .map((member) => member.record)
      .filter((record): record is RunRecord => record !== null)

    const status =
      missing.length > 0
        ? 'ERROR'
        : deriveBenchStatus(members, record, reportOnDisk(folder, runId))

    const counts: BenchStatusView = {
      status,
      missingMembers: missing,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      running: 0,
      errors: 0
    }
    for (const member of members) {
      switch (member.status) {
        case 'SUCCEEDED':
          counts.succeeded += 1
          break
        case 'FAILED':
          counts.failed += 1
          break
        case 'CANCELLED':
          counts.cancelled += 1
          break
        case 'ERROR':
          counts.errors += 1
          break
        default:
          counts.running += 1
      }
    }
    return counts
  }

  // ------------------------------------------------------------------
  // Refresh
  // ------------------------------------------------------------------

  /** Collects launch scripts that have finished since the last look (§7.1). */
  harvestLaunches(): EngineError[] {
    const errors: EngineError[] = []
    const still: LaunchInFlight[] = []
    for (const inFlight of this.launching) {
      const invocation = inFlight.running.tryFinish()
      if (invocation === null) {
        still.push(inFlight)
        continue
      }
      let submissionId: string | null = null
      let failure: EngineError | null = null
      try {
        submissionId = parseLaunchReturn(invocation)
      } catch (cause) {
        failure = invocationError(inFlight.script, invocation, (cause as Error).message)
      }
      if (submissionId !== null) {
        try {
          const record = this.runRecord(inFlight.path, inFlight.runId)
          record.submission_id = submissionId
          this.writeRunRecord(inFlight.path, record)
        } catch (cause) {
          errors.push(asEngineError(inFlight.path, cause))
        }
      } else if (failure !== null) {
        try {
          const record = this.runRecord(inFlight.path, inFlight.runId)
          applyStatus(record, 'ERROR', nowStamp())
          record.error = failure.message
          this.writeRunRecord(inFlight.path, record)
        } catch {
          // The record is gone; the error below still reaches the caller.
        }
        errors.push(failure)
      }
    }
    this.launching = still
    return errors
  }

  /** Waits until no launch is in flight. For tests and shutdown. */
  async settleLaunches(): Promise<EngineError[]> {
    const errors: EngineError[] = []
    while (this.launching.length > 0) {
      errors.push(...this.harvestLaunches())
      if (this.launching.length > 0) await sleep(5)
    }
    return errors
  }

  launchesInFlight(): number {
    return this.launching.length
  }

  /** The way a closing coco leaves its launches (§10). */
  async shutdownLaunches(graceMs: number): Promise<void> {
    const deadline = Date.now() + graceMs
    while (this.launching.length > 0 && Date.now() < deadline) {
      this.harvestLaunches()
      if (this.launching.length > 0) await sleep(5)
    }
    for (const inFlight of this.launching) {
      inFlight.running.kill()
      try {
        const record = this.runRecord(inFlight.path, inFlight.runId)
        applyStatus(record, 'ERROR', nowStamp())
        record.error =
          'coco closed while the launch script was still running; the launch was abandoned'
        this.writeRunRecord(inFlight.path, record)
      } catch {
        // Nothing left to mark.
      }
    }
    this.launching = []
  }

  /**
   * One refresh tick (§7.5, §10): harvest, reconcile disk → memory, poll,
   * auto-report, bench reports.
   */
  async refresh(): Promise<RefreshReport> {
    const report: RefreshReport = {
      polls: 0,
      pollChanges: [],
      pollWarnings: [],
      pollErrors: [],
      reportsRun: 0,
      reportErrors: [],
      launchErrors: this.harvestLaunches()
    }

    this.reconcile()

    for (const view of this.entities()) {
      const manifest = view.manifest
      if (manifest === null) continue
      if (manifest.kind === 'job') {
        report.polls += 1
        try {
          const poll = await this.pollJob(view.path)
          report.pollChanges.push(...poll.changed)
          report.pollWarnings.push(...poll.warnings)
        } catch (cause) {
          report.pollErrors.push(asEngineError(view.path, cause))
        }
        for (const runView of this.jobRuns(view.path)) {
          const record = runView.record
          if (record === null) continue
          // A run still "launching" whose script this engine is not holding
          // is a previous session's leftover (§10): the stdout that carried
          // its submission id died with that process.
          if (
            record.submission_id === '' &&
            !isTerminal(record.status) &&
            !this.launching.some((inFlight) => inFlight.runId === runView.runId)
          ) {
            applyStatus(record, 'ERROR', nowStamp())
            record.error =
              'coco closed while the launch script was running; the submission id is lost'
            try {
              this.writeRunRecord(view.path, record)
            } catch (cause) {
              report.reportErrors.push(asEngineError(view.path, cause))
            }
            continue
          }
          if (record.status === 'COMPLETED' || record.status === 'ANALYZING') {
            report.reportsRun += 1
            try {
              await this.reportRun(view.path, runView.runId, 'auto')
            } catch (cause) {
              report.reportErrors.push(asEngineError(view.path, cause))
            }
          }
        }
      } else {
        for (const runView of this.benchRuns(view.path)) {
          const record = runView.record
          if (record === null) continue
          const needsReport = record.report === undefined || !record.report.attempted
          if (!needsReport) continue
          try {
            const status = this.benchStatus(view.path, runView.runId)
            if (status.status === 'ANALYZING') {
              report.reportsRun += 1
              await this.benchReport(view.path, runView.runId)
            }
          } catch (cause) {
            report.reportErrors.push(asEngineError(view.path, cause))
          }
        }
      }
    }
    return report
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private findNameCollision(name: string): string | null {
    for (const slot of this.manifests.values()) {
      if (slot.manifest !== null && slot.manifest.name === name) return slot.manifest.name
    }
    return null
  }

  findJobByName(name: string): [string, JobManifest] | null {
    for (const [folder, slot] of this.manifests) {
      if (slot.manifest !== null && slot.manifest.kind === 'job' && slot.manifest.name === name) {
        return [folder, slot.manifest]
      }
    }
    return null
  }

  findBenchPathByName(name: string): string | null {
    for (const [folder, slot] of this.manifests) {
      if (slot.manifest !== null && slot.manifest.kind === 'bench' && slot.manifest.name === name) {
        return folder
      }
    }
    return null
  }

  /** Write-through: memory first, then the folder, then remember the mtime
   * so the next reconcile pass does not read our own write back. */
  private writeRunRecord(folder: string, record: RunRecord): void {
    mapFor(this.jobRecords, folder).set(record.run_id, { record, error: null })
    this.persist(folder, record.run_id, record)
  }

  private writeBenchRecord(folder: string, record: BenchRecord): void {
    mapFor(this.benchRecords, folder).set(record.run_id, { record, error: null })
    this.persist(folder, record.run_id, record)
  }

  private persist(folder: string, runId: number, record: object): void {
    const recordPath = path.join(folder, 'runs', String(runId), 'run.json')
    writeAtomic(recordPath, JSON.stringify(record, null, 2))
    try {
      this.fileMtimes.set(recordPath, fs.statSync(recordPath).mtimeMs)
    } catch {
      // Unreadable right after writing: let the next reconcile sort it out.
    }
  }

  private resolveMembers(record: BenchRecord): ResolvedMember[] {
    return record.members.map((member) => {
      const found = this.findJobByName(member.job)
      let memberRecord: RunRecord | null = null
      if (found !== null) {
        memberRecord = this.jobRecords.get(found[0])?.get(member.run_id)?.record ?? null
      }
      return {
        runId: member.run_id,
        jobName: member.job,
        jobPath: found?.[0] ?? null,
        record: memberRecord
      }
    })
  }
}

function mapFor<T>(
  maps: Map<string, Map<number, RecordSlot<T>>>,
  folder: string
): Map<number, RecordSlot<T>> {
  let slots = maps.get(folder)
  if (slots === undefined) {
    slots = new Map()
    maps.set(folder, slots)
  }
  return slots
}

function viewsOf<T>(
  slots: Map<number, RecordSlot<T>> | undefined
): { runId: number; record: T | null; recordError: EngineError | null }[] {
  if (slots === undefined) return []
  const views = [...slots.entries()].map(([runId, slot]) => ({
    runId,
    record: slot.record,
    recordError: slot.error
  }))
  views.sort((a, b) => b.runId - a.runId)
  return views
}

/** The bench status derivation (§9.1), over fully-resolved members. */
function deriveBenchStatus(
  members: RunRecord[],
  bench: BenchRecord,
  reportExists: boolean
): Status {
  if (members.some((member) => member.status === 'CANCELLING')) return 'CANCELLING'
  if (members.some((member) => !isTerminal(member.status))) {
    if (members.every((member) => member.status === 'STARTING')) return 'STARTING'
    return 'RUNNING'
  }
  if (bench.launch_failures.length > 0 || members.some((m) => m.status === 'ERROR')) return 'ERROR'
  if (members.some((m) => m.status === 'FAILED')) return 'FAILED'
  if (members.some((m) => m.status === 'CANCELLED')) return 'CANCELLED'
  if (bench.report !== undefined && bench.report.attempted) {
    if (bench.report.error !== undefined) return 'ERROR'
    if (!reportExists) return 'ERROR'
  }
  return reportExists ? 'SUCCEEDED' : 'ANALYZING'
}

export function reportOnDisk(folder: string, runId: number): boolean {
  const file = path.join(folder, 'report', `${runId}.txt`)
  return fs.existsSync(file) && fs.statSync(file).isFile()
}

/** Strips a trailing `.tmpl` from the template's file name (§6.1). */
function artifactName(templateRel: string): string {
  const name = path.basename(templateRel)
  if (name.endsWith('.tmpl') && name !== '.tmpl') return name.slice(0, -'.tmpl'.length)
  return name
}

/** Declared params and provided values must be exactly the same set (§2). */
function validateParams(
  declared: string[],
  provided: Record<string, string>,
  set: string
): void {
  const declaredSet = new Set(declared)
  const providedSet = new Set(Object.keys(provided))
  const missing = [...declaredSet].filter((name) => !providedSet.has(name)).sort()
  const extra = [...providedSet].filter((name) => !declaredSet.has(name)).sort()
  // A key carrying a blank value was never supplied (§2.1).
  const blank = [...declaredSet]
    .filter((name) => provided[name] !== undefined && provided[name].trim() === '')
    .sort()
  if (missing.length === 0 && extra.length === 0 && blank.length === 0) return
  throw EngineError.validation(
    `${set} parameters must match the manifest exactly and each one needs a value; ` +
      `missing ${describeNames(missing)}, extra ${describeNames(extra)}, empty ${describeNames(blank)}`
  )
}

function describeNames(names: string[]): string {
  if (names.length === 0) return 'none'
  return names.map((name) => `\`${name}\``).join(', ')
}

/**
 * A launch must exit 0 and print exactly one `COCO_RETURN:` line whose
 * payload is a single non-empty token (§7.1).
 */
function parseLaunchReturn(invocation: Invocation): string {
  if (invocation.timedOut || invocation.exit !== 0) {
    throw new Error('')
  }
  const lines = invoke.cocoReturnLines(invocation.stdout)
  const last = lines[lines.length - 1]
  if (last === undefined) {
    throw new Error('script printed no COCO_RETURN: line')
  }
  if (last === '' || last.split(/\s+/).length !== 1) {
    throw new Error('COCO_RETURN: payload must be a single token')
  }
  return last
}

function parsePlanLine(line: string): PlanLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new Error(`not a JSON object: ${(cause as Error).message}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('must be a JSON object')
  }
  const object = value as Record<string, unknown>
  const job = object.job
  if (typeof job !== 'string') {
    throw new Error('missing string field `job`')
  }
  const rawParams = object.params
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    throw new Error('missing object field `params`')
  }
  const params: Record<string, string> = {}
  for (const [name, paramValue] of Object.entries(rawParams as Record<string, unknown>)) {
    if (typeof paramValue !== 'string') {
      throw new Error(`param \`${name}\` must be a string`)
    }
    params[name] = paramValue
  }
  return { job, params }
}

function invocationError(script: string, invocation: Invocation, detail: string): EngineError {
  const output =
    detail === ''
      ? invoke.invocationOutput(invocation)
      : `${detail}\n${invoke.invocationOutput(invocation)}`
  return EngineError.invocation(script, invocation.exit, invocation.timedOut, output)
}

/** BTreeMap parity: object keys in sorted order, so JSON output is stable. */
function sorted(map: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of Object.keys(map).sort()) result[key] = map[key]
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
