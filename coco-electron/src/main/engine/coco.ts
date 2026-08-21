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
import { EngineError, as_engine_error } from './errors'
import * as invoke from './invoke'
import type { Invocation, Running } from './invoke'
import { load_manifest } from './manifest'
import type { JobManifest, Manifest } from './manifest'
import { all_params, apply_status, new_run_record, now_stamp } from './record'
import type {
  BenchMember,
  BenchMembersFile,
  BenchRecord,
  LaunchFailure,
  RunOrigin,
  RunRecord,
  Trigger
} from './record'
import { from_poll_word, is_cancellable, is_terminal } from './status'
import type { Status } from './status'
import { load_store, save_store, write_atomic } from './store'
import type { StoreData } from './store'
import * as template from './template'

/** Timeouts (convention §6), in milliseconds. */
export interface Config {
  launch_timeout: number
  poll_timeout: number
  cancel_timeout: number
  plan_timeout: number
  report_timeout: number
}

export const DEFAULT_CONFIG: Config = {
  launch_timeout: 60_000,
  poll_timeout: 60_000,
  cancel_timeout: 60_000,
  plan_timeout: 120_000,
  report_timeout: 600_000
}

export interface EntityView {
  path: string
  manifest: Manifest | null
  manifest_error: EngineError | null
}

export interface JobRunView {
  run_id: number
  record: RunRecord | null
  record_error: EngineError | null
}

export interface BenchRunView {
  run_id: number
  record: BenchRecord | null
  record_error: EngineError | null
}

export interface PollReport {
  polled: number
  changed: [number, Status][]
  warnings: string[]
}

export interface PlanInstance {
  job_path: string
  job_name: string
  render: Record<string, string>
  launch: Record<string, string>
}

export interface BenchStart {
  run_id: number
  members: BenchMember[]
  launch_failures: LaunchFailure[]
}

export interface BenchStatusView {
  status: Status
  missing_members: string[]
  succeeded: number
  failed: number
  cancelled: number
  running: number
  errors: number
}

export interface RefreshReport {
  polls: number
  poll_changes: [number, Status][]
  poll_warnings: string[]
  poll_errors: EngineError[]
  reports_run: number
  report_errors: EngineError[]
  launch_errors: EngineError[]
}

export type ReportMode = 'auto' | 'manual'

interface LaunchInFlight {
  path: string
  run_id: number
  script: string
  running: Running
}

interface ResolvedMember {
  run_id: number
  job_name: string
  job_path: string | null
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
  private readonly store_path: string
  private store: StoreData
  private readonly config: Config
  private launching: LaunchInFlight[] = []

  // ------------------------------------------------------------------
  // The in-memory truth. store.json persists only which folders are
  // registered; everything else lives here and is written through to the
  // folders as records.
  // ------------------------------------------------------------------
  private manifests = new Map<string, ManifestSlot>()
  private job_records = new Map<string, Map<number, RecordSlot<RunRecord>>>()
  private bench_records = new Map<string, Map<number, RecordSlot<BenchRecord>>>()

  constructor(store_path: string, config: Config = DEFAULT_CONFIG) {
    this.store_path = store_path
    this.store = load_store(store_path)
    this.config = config
    this.reconcile()
  }

  /**
   * The next run id for one experiment: one past the highest it already has,
   * or `0` if it has none. Derived from the records, never stored.
   *
   * Ids are per experiment, so two experiments each have a run `0`.
   * See `doc/convention.md` §5 for why there is no counter.
   */
  private next_run_id(records: Map<string, Map<number, unknown>>, folder: string): number {
    const mine = records.get(folder)
    if (mine === undefined || mine.size === 0) {
      return 0
    }
    return Math.max(...mine.keys()) + 1
  }

  // ------------------------------------------------------------------
  // Reconciliation. Records are coco's own files and nobody else changes
  // them, so a folder's runs are read exactly once — the first time the
  // folder is seen (startup, or its registration). Manifests stay the
  // user's authored files: small, and re-read every pass so an edited
  // coco.toml lands at the next tick (§4).
  // ------------------------------------------------------------------

  reconcile(): void {
    const registered = new Set(this.store.entities)
    for (const folder of [...this.manifests.keys()]) {
      if (!registered.has(folder)) {
        this.manifests.delete(folder)
        this.job_records.delete(folder)
        this.bench_records.delete(folder)
      }
    }

    for (const folder of this.store.entities) {
      let manifest: Manifest | null = null
      let error: EngineError | null = null
      try {
        manifest = load_manifest(folder)
      } catch (cause) {
        error = as_engine_error(folder, cause)
      }
      this.manifests.set(folder, { manifest, error })
      if (manifest === null) {
        continue
      }

      if (manifest.kind === 'job') {
        if (!this.job_records.has(folder)) {
          this.load_runs(folder, map_for(this.job_records, folder))
        }
      } else if (!this.bench_records.has(folder)) {
        this.load_runs(folder, map_for(this.bench_records, folder))
      }
    }
  }

  private load_runs<T>(folder: string, slots: Map<number, RecordSlot<T>>): void {
    const runs_dir = path.join(folder, 'runs')
    let entries: string[]
    try {
      entries = fs.readdirSync(runs_dir)
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue
      }
      const run_id = Number(entry)
      const record_path = path.join(runs_dir, entry, 'run.json')
      try {
        const text = fs.readFileSync(record_path, 'utf8')
        slots.set(run_id, { record: JSON.parse(text) as T, error: null })
      } catch (cause) {
        slots.set(run_id, {
          record: null,
          error: EngineError.store(
            record_path,
            `run.json does not parse: ${(cause as Error).message}`
          )
        })
      }
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
    if (this.store.entities.includes(canonical)) {
      return
    }
    const manifest = load_manifest(canonical)
    const collision = this.find_name_collision(manifest.name)
    if (collision !== null) {
      throw EngineError.name_collision(collision)
    }
    this.store.entities.push(canonical)
    save_store(this.store_path, this.store)
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
      throw EngineError.not_found(`entity ${canonical}`)
    }
    save_store(this.store_path, this.store)
    this.reconcile()
  }

  /** All registered entities, from the in-memory truth. */
  entities(): EntityView[] {
    return this.store.entities.map((folder) => {
      const slot = this.manifests.get(folder)
      return {
        path: folder,
        manifest: slot?.manifest ?? null,
        manifest_error:
          slot?.error ?? (slot === undefined ? EngineError.not_found(`entity ${folder}`) : null)
      }
    })
  }

  job_manifest(folder: string): JobManifest {
    const slot = this.manifests.get(folder)
    if (slot === undefined) {
      throw EngineError.not_found(`entity ${folder}`)
    }
    if (slot.manifest === null) {
      throw slot.error ?? EngineError.manifest(folder, 'manifest is unusable')
    }
    if (slot.manifest.kind !== 'job') {
      throw EngineError.validation(`${folder} is a bench, not a job`)
    }
    return slot.manifest
  }

  bench_manifest(folder: string): Exclude<Manifest, JobManifest> {
    const slot = this.manifests.get(folder)
    if (slot === undefined) {
      throw EngineError.not_found(`entity ${folder}`)
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
  job_runs(folder: string): JobRunView[] {
    return views_of(this.job_records.get(folder))
  }

  bench_runs(folder: string): BenchRunView[] {
    return views_of(this.bench_records.get(folder))
  }

  run_record(folder: string, run_id: number): RunRecord {
    const slot = this.job_records.get(folder)?.get(run_id)
    if (slot === undefined) {
      throw EngineError.not_found(`run ${run_id} in ${folder}`)
    }
    if (slot.record === null) {
      throw slot.error ?? EngineError.not_found(`run ${run_id} in ${folder}`)
    }
    return slot.record
  }

  bench_record(folder: string, run_id: number): BenchRecord {
    const slot = this.bench_records.get(folder)?.get(run_id)
    if (slot === undefined) {
      throw EngineError.not_found(`bench run ${run_id} in ${folder}`)
    }
    if (slot.record === null) {
      throw slot.error ?? EngineError.not_found(`bench run ${run_id} in ${folder}`)
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
  async start_job(
    folder: string,
    render: Record<string, string>,
    launch: Record<string, string>,
    by: Trigger
  ): Promise<number> {
    const origin: RunOrigin = by === 'human' ? { by: 'human' } : { by: 'agent' }
    return this.start_job_inner(folder, render, launch, origin)
  }

  private async start_job_inner(
    folder: string,
    render: Record<string, string>,
    launch: Record<string, string>,
    origin: RunOrigin
  ): Promise<number> {
    const manifest = this.job_manifest(folder)
    validate_params(manifest.render_params, render, 'render')
    validate_params(manifest.launch_params, launch, 'launch')

    // The template is read from disk at the moment of use — it is authored
    // content, not engine state, and must be as fresh as the start.
    const template_path = path.join(folder, manifest.template)
    let source: string
    try {
      source = fs.readFileSync(template_path, 'utf8')
    } catch (cause) {
      throw EngineError.io(template_path, cause)
    }
    try {
      template.analyze(source, manifest.render_params)
    } catch (cause) {
      throw EngineError.template(template_path, (cause as Error).message)
    }
    let rendered: string
    try {
      rendered = template.render(source, render)
    } catch (cause) {
      throw EngineError.template(template_path, (cause as Error).message)
    }

    const run_id = this.next_run_id(this.job_records, folder)
    const run_dir = path.join(folder, 'runs', String(run_id))
    try {
      fs.mkdirSync(run_dir, { recursive: true })
    } catch (cause) {
      throw EngineError.io(run_dir, cause)
    }

    const artifact = artifact_name(manifest.template)
    try {
      fs.writeFileSync(path.join(run_dir, artifact), rendered)
    } catch (cause) {
      throw EngineError.io(path.join(run_dir, artifact), cause)
    }

    const argv = [...manifest.launch.words]
    argv.push('--script', `runs/${run_id}/${artifact}`)
    argv.push('--run', String(run_id))
    for (const name of Object.keys(launch).sort()) {
      argv.push(`--${name}`, launch[name])
    }

    // The record is written before the spawn's await: the id was picked in
    // the same synchronous stretch, and a concurrent start must find it
    // taken rather than pick it too.
    const record = new_run_record(run_id, '', sorted(render), sorted(launch), origin, now_stamp())
    this.write_run_record(folder, record)

    // Only a script that cannot be started at all refuses the start itself:
    // that is a folder problem the submitter can act on now, and it leaves
    // no run behind — the reservation is dropped.
    let running: Running
    try {
      running = await invoke.spawn(folder, argv, this.config.launch_timeout)
    } catch (cause) {
      this.job_records.get(folder)?.delete(run_id)
      fs.rmSync(path.join(run_dir, 'run.json'), { force: true })
      throw EngineError.io(folder, cause)
    }

    this.launching.push({
      path: folder,
      run_id,
      script: manifest.launch.display,
      running
    })

    save_store(this.store_path, this.store)
    return run_id
  }

  /** Polls one job's active runs, one `poll` script call per run (§7.2, §10). */
  async poll_job(folder: string): Promise<PollReport> {
    const manifest = this.job_manifest(folder)
    const active: [number, RunRecord][] = []
    for (const view of this.job_runs(folder)) {
      const record = view.record
      // A run whose launch script has not returned yet has no submission id
      // to poll by; it is the launch's business until harvest collects it.
      if (record !== null && !is_terminal(record.status) && record.submission_id !== '') {
        active.push([record.run_id, record])
      }
    }

    const report: PollReport = { polled: active.length, changed: [], warnings: [] }
    let broken: EngineError | null = null

    // One script call per run (§7.2): the answer needs no submission prefix,
    // and one run's slow or broken poll never speaks for another's.
    for (const [run_id, record] of active) {
      // Another operation may land while a script runs — there is no queue.
      // The history length is the record's version: a cancel during this
      // run's (or an earlier run's) poll moves it, and an answer formed
      // before that move is stale and must not land (`serial` history: a
      // stale poll used to write the pre-cancel status back over
      // CANCELLING).
      if (is_terminal(record.status)) {
        continue
      }
      const seen = record.history.length

      const argv = [...manifest.poll.words, '--submission', record.submission_id]
      let invocation: Invocation
      try {
        invocation = await invoke.run(folder, argv, this.config.poll_timeout)
      } catch (cause) {
        throw EngineError.io(folder, cause)
      }
      const now = now_stamp()
      if (record.history.length !== seen) {
        continue
      }

      const lines = invoke.coco_return_lines(invocation.stdout)
      if (!invoke.invocation_ok(invocation) || lines.length === 0) {
        // Broken code rather than an unreachable scheduler — a poll answers
        // exactly one line, always (§7.2) — but coco cannot see the run
        // either way (§10). Mark it, keep polling the others, and raise the
        // first failure loudly once the sweep is done.
        const detail =
          lines.length === 0 && invoke.invocation_ok(invocation)
            ? 'poll script answered nothing'
            : invoke.invocation_output(invocation)
        if (record.status !== 'UNREACHABLE') {
          apply_status(record, 'UNREACHABLE', now, `poll script failed: ${detail}`)
          this.write_run_record(folder, record)
          report.changed.push([run_id, 'UNREACHABLE'])
        }
        broken ??= EngineError.invocation(
          manifest.poll.display,
          invocation.exit,
          invocation.timed_out,
          detail
        )
        continue
      }

      if (lines.length > 1) {
        report.warnings.push(`run ${run_id}: extra poll lines ignored`)
      }
      const match = lines[0].match(/^(\S+)(?:\s+(.*))?$/)
      if (match === null) {
        report.warnings.push(`malformed poll line ignored: \`${lines[0]}\``)
        continue
      }
      const [, word, rest] = match
      const reason = rest?.trim() !== '' ? rest?.trim() : undefined
      const status = word === 'UNREACHABLE' ? 'UNREACHABLE' : from_poll_word(word)
      if (status === null) {
        report.warnings.push(`unknown status \`${word}\` for run ${run_id} ignored`)
        continue
      }
      if (record.status !== status) {
        apply_status(record, status, now, reason)
        this.write_run_record(folder, record)
        report.changed.push([run_id, status])
      }
    }

    if (broken !== null) {
      throw broken
    }
    return report
  }

  /**
   * Runs the report script for one run (§7.3, §11). The record is the live
   * in-memory truth: a poll advancing the run while the (possibly long)
   * report script runs mutates the same object, so the outcomes compose.
   */
  async report_run(folder: string, run_id: number, mode: ReportMode): Promise<void> {
    const manifest = this.job_manifest(folder)
    const record = this.run_record(folder, run_id)

    const eligible =
      mode === 'auto'
        ? record.status === 'COMPLETED' || record.status === 'ANALYZING'
        : record.status === 'COMPLETED' ||
          record.status === 'ANALYZING' ||
          record.status === 'SUCCEEDED' ||
          (record.status === 'ERROR' &&
            record.history.some((change) => change.status === 'COMPLETED'))
    if (!eligible) {
      throw EngineError.validation(`run ${run_id} (${record.status}) cannot be reported`)
    }

    if (record.status !== 'ANALYZING') {
      apply_status(record, 'ANALYZING', now_stamp())
      this.write_run_record(folder, record)
    }

    const report_dir = path.join(folder, 'report')
    try {
      fs.mkdirSync(report_dir, { recursive: true })
    } catch (cause) {
      throw EngineError.io(report_dir, cause)
    }
    const argv = [
      ...manifest.report.words,
      '--run',
      String(run_id),
      '--submission',
      record.submission_id
    ]
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.report_timeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }

    const report_path = path.join(report_dir, `${run_id}.txt`)
    const file_ok = fs.existsSync(report_path) && fs.statSync(report_path).isFile()

    if (invoke.invocation_ok(invocation) && file_ok) {
      apply_status(record, 'SUCCEEDED', now_stamp())
      delete record.error
      this.write_run_record(folder, record)
      return
    }

    const detail = invoke.invocation_ok(invocation)
      ? `report script exited 0 but produced no report/${run_id}.txt`
      : invoke.invocation_output(invocation)
    const error = EngineError.invocation(
      manifest.report.display,
      invocation.exit,
      invocation.timed_out,
      detail
    )
    if (mode === 'auto') {
      apply_status(record, 'ERROR', now_stamp())
      record.error = detail
      this.write_run_record(folder, record)
    }
    throw error
  }

  /** Cancels one run through the job's `cancel` script (§7.4). */
  async cancel_run(folder: string, run_id: number): Promise<void> {
    const manifest = this.job_manifest(folder)
    const record = this.run_record(folder, run_id)
    if (!is_cancellable(record.status)) {
      throw EngineError.validation(`run ${run_id} (${record.status}) cannot be cancelled`)
    }
    if (record.submission_id === '') {
      throw EngineError.validation(
        `run ${run_id} is still launching; there is no submission to cancel yet`
      )
    }
    const argv = [...manifest.cancel.words, '--submission', record.submission_id]
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.cancel_timeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }
    if (invoke.invocation_ok(invocation)) {
      // The run may have moved while the cancel script ran — ended on its
      // own, or another cancel got there first. The cluster has been told
      // either way; only a run still cancellable takes the CANCELLING mark.
      if (is_cancellable(record.status)) {
        apply_status(record, 'CANCELLING', now_stamp())
        this.write_run_record(folder, record)
      }
      return
    }
    throw EngineError.invocation(
      manifest.cancel.display,
      invocation.exit,
      invocation.timed_out,
      invoke.invocation_output(invocation)
    )
  }

  // ------------------------------------------------------------------
  // Bench operations
  // ------------------------------------------------------------------

  /** Runs `plan` and validates every instance before anything is submitted (§8.1). */
  async plan_bench(folder: string, params: Record<string, string>): Promise<PlanInstance[]> {
    const manifest = this.bench_manifest(folder)
    validate_params(manifest.plan_params, params, 'plan')

    const argv = [...manifest.plan.words]
    for (const name of Object.keys(params).sort()) {
      argv.push(`--${name}`, params[name])
    }
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.plan_timeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }
    if (!invoke.invocation_ok(invocation)) {
      throw EngineError.invocation(
        manifest.plan.display,
        invocation.exit,
        invocation.timed_out,
        invoke.invocation_output(invocation)
      )
    }

    const lines = invoke.coco_return_lines(invocation.stdout)
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
        planned = parse_plan_line(line)
      } catch (cause) {
        problems.push(`call ${call}: ${(cause as Error).message}`)
        continue
      }
      const found = this.find_job_by_name(planned.job)
      if (found === null) {
        problems.push(`call ${call}: \`${planned.job}\` is not a registered job`)
        continue
      }
      const [job_path, job] = found
      const expected = new Set([...job.render_params, ...job.launch_params])
      const provided = new Set(Object.keys(planned.params))
      const missing = [...expected].filter((name) => !provided.has(name)).sort()
      const extra = [...provided].filter((name) => !expected.has(name)).sort()
      if (missing.length > 0 || extra.length > 0) {
        const wrong: string[] = []
        if (missing.length > 0) {
          wrong.push(`missing ${describe_names(missing)}`)
        }
        if (extra.length > 0) {
          wrong.push(`extra ${describe_names(extra)}`)
        }
        problems.push(`call ${call}: job \`${planned.job}\` — ${wrong.join(', ')}`)
        continue
      }
      const render: Record<string, string> = {}
      const launch: Record<string, string> = {}
      for (const [name, value] of Object.entries(planned.params)) {
        if (job.render_params.includes(name)) {
          render[name] = value
        } else {
          launch[name] = value
        }
      }
      instances.push({ job_path, job_name: job.name, render, launch })
    }

    if (problems.length > 0) {
      throw EngineError.invalid_plan(lines.length, problems)
    }
    return instances
  }

  /** Starts a bench: validates the plan, then dispatches every instance (§8.2). */
  async start_bench(
    folder: string,
    params: Record<string, string>,
    by: Trigger
  ): Promise<BenchStart> {
    const manifest = this.bench_manifest(folder)
    const instances = await this.plan_bench(folder, params)
    const bench_run_id = this.next_run_id(this.bench_records, folder)

    const members: BenchMember[] = []
    const launch_failures: LaunchFailure[] = []
    for (const [index, instance] of instances.entries()) {
      try {
        const run_id = await this.start_job_inner(
          instance.job_path,
          instance.render,
          instance.launch,
          {
            by: 'bench',
            run_id: bench_run_id,
            name: manifest.name,
            call: index + 1
          }
        )
        members.push({ run_id: run_id, job: instance.job_name })
      } catch (cause) {
        launch_failures.push({
          job: instance.job_name,
          params: { ...instance.render, ...instance.launch },
          error: (cause as Error).message
        })
      }
    }

    const record: BenchRecord = {
      run_id: bench_run_id,
      bench: manifest.name,
      by,
      started_at: now_stamp(),
      params: sorted(params),
      planned: members.length + launch_failures.length,
      members,
      launch_failures: launch_failures
    }
    this.write_bench_record(folder, record)
    save_store(this.store_path, this.store)

    return { run_id: bench_run_id, members, launch_failures }
  }

  /** Runs the bench's report over its members' results (§8.3). */
  async bench_report(folder: string, run_id: number): Promise<void> {
    const manifest = this.bench_manifest(folder)
    const record = this.bench_record(folder, run_id)

    const resolved = this.resolve_members(record)
    const block_reasons: string[] = []
    if (record.launch_failures.length > 0) {
      block_reasons.push(`${record.launch_failures.length} launch(es) failed`)
    }
    for (const member of resolved) {
      if (member.record === null) {
        block_reasons.push(`member \`${member.job_name}\` run ${member.run_id} cannot be resolved`)
      } else if (member.record.status !== 'SUCCEEDED') {
        block_reasons.push(
          `member \`${member.job_name}\` run ${member.run_id} ended ${member.record.status}`
        )
      }
    }
    if (block_reasons.length > 0) {
      throw EngineError.validation(`no bench report: ${block_reasons.join(', ')}`)
    }

    const run_dir = path.join(folder, 'runs', String(run_id))
    const members_file: BenchMembersFile = {
      run_id: run_id,
      bench: record.bench,
      params: record.params,
      members: resolved.map((member) => {
        const member_record = member.record as RunRecord
        const job_path = member.job_path as string
        return {
          run_id: member.run_id,
          job: member.job_name,
          params: all_params(member_record),
          submission_id: member_record.submission_id,
          report: path.join(job_path, 'report', `${member.run_id}.txt`)
        }
      })
    }
    write_atomic(path.join(run_dir, 'members.json'), JSON.stringify(members_file, null, 2))

    const report_dir = path.join(folder, 'report')
    try {
      fs.mkdirSync(report_dir, { recursive: true })
    } catch (cause) {
      throw EngineError.io(report_dir, cause)
    }
    const argv = [
      ...manifest.report.words,
      '--run',
      String(run_id),
      '--members',
      `runs/${run_id}/members.json`
    ]
    let invocation: Invocation
    try {
      invocation = await invoke.run(folder, argv, this.config.report_timeout)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }

    const report_path = path.join(report_dir, `${run_id}.txt`)
    const ok = invoke.invocation_ok(invocation) && fs.existsSync(report_path)
    const error = ok
      ? undefined
      : invoke.invocation_ok(invocation)
        ? `report script exited 0 but produced no report/${run_id}.txt`
        : invoke.invocation_output(invocation)
    record.report = { attempted: true, ...(error !== undefined ? { error } : {}) }
    this.write_bench_record(folder, record)

    if (!ok) {
      throw EngineError.invocation(
        manifest.report.display,
        invocation.exit,
        invocation.timed_out,
        error ?? ''
      )
    }
  }

  /** Cancels a bench run by cancelling its still-cancellable members (§3, §9.1). */
  async cancel_bench(
    folder: string,
    run_id: number
  ): Promise<{ run_id: number; job: string; ok: boolean; error?: string }[]> {
    const record = this.bench_record(folder, run_id)
    const results: { run_id: number; job: string; ok: boolean; error?: string }[] = []
    for (const member of record.members) {
      const found = this.find_job_by_name(member.job)
      if (found === null) {
        throw EngineError.not_found(`member job \`${member.job}\` of bench run ${run_id}`)
      }
      const [job_path] = found
      let member_record: RunRecord
      try {
        member_record = this.run_record(job_path, member.run_id)
      } catch {
        continue
      }
      if (!is_cancellable(member_record.status)) {
        continue
      }
      try {
        await this.cancel_run(job_path, member.run_id)
        results.push({ run_id: member.run_id, job: member.job, ok: true })
      } catch (cause) {
        results.push({
          run_id: member.run_id,
          job: member.job,
          ok: false,
          error: (cause as Error).message
        })
      }
    }
    return results
  }

  /** Derives a bench run's status (§9.1). Never stored, computed from memory. */
  bench_status(folder: string, run_id: number): BenchStatusView {
    const record = this.bench_record(folder, run_id)
    const resolved = this.resolve_members(record)
    const missing = resolved.filter((member) => member.record === null).map((m) => m.job_name)
    const members = resolved
      .map((member) => member.record)
      .filter((record): record is RunRecord => record !== null)

    const status =
      missing.length > 0
        ? 'ERROR'
        : derive_bench_status(members, record, report_on_disk(folder, run_id))

    const counts: BenchStatusView = {
      status,
      missing_members: missing,
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
  harvest_launches(): EngineError[] {
    const errors: EngineError[] = []
    const still: LaunchInFlight[] = []
    for (const in_flight of this.launching) {
      const invocation = in_flight.running.try_finish()
      if (invocation === null) {
        still.push(in_flight)
        continue
      }
      let submission_id: string | null = null
      let failure: EngineError | null = null
      try {
        submission_id = parse_launch_return(invocation)
      } catch (cause) {
        failure = invocation_error(in_flight.script, invocation, (cause as Error).message)
      }
      if (submission_id !== null) {
        try {
          const record = this.run_record(in_flight.path, in_flight.run_id)
          record.submission_id = submission_id
          this.write_run_record(in_flight.path, record)
        } catch (cause) {
          errors.push(as_engine_error(in_flight.path, cause))
        }
      } else if (failure !== null) {
        try {
          const record = this.run_record(in_flight.path, in_flight.run_id)
          apply_status(record, 'ERROR', now_stamp())
          record.error = failure.message
          this.write_run_record(in_flight.path, record)
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
  async settle_launches(): Promise<EngineError[]> {
    const errors: EngineError[] = []
    while (this.launching.length > 0) {
      errors.push(...this.harvest_launches())
      if (this.launching.length > 0) {
        await sleep(5)
      }
    }
    return errors
  }

  launches_in_flight(): number {
    return this.launching.length
  }

  /**
   * The way a closing coco leaves its launches (§10): the close waits for
   * nothing. An answer already delivered is still collected; a script that
   * has not answered is killed and its run marked ERROR now, honestly,
   * saying why the run cannot be tracked.
   */
  abandon_launches(): void {
    this.harvest_launches()
    for (const in_flight of this.launching) {
      in_flight.running.kill()
      try {
        const record = this.run_record(in_flight.path, in_flight.run_id)
        apply_status(record, 'ERROR', now_stamp())
        record.error =
          'coco closed before the launch script answered; the run can no longer be tracked'
        this.write_run_record(in_flight.path, record)
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
      poll_changes: [],
      poll_warnings: [],
      poll_errors: [],
      reports_run: 0,
      report_errors: [],
      launch_errors: this.harvest_launches()
    }

    this.reconcile()

    for (const view of this.entities()) {
      const manifest = view.manifest
      if (manifest === null) {
        continue
      }
      if (manifest.kind === 'job') {
        report.polls += 1
        try {
          const poll = await this.poll_job(view.path)
          report.poll_changes.push(...poll.changed)
          report.poll_warnings.push(...poll.warnings)
        } catch (cause) {
          report.poll_errors.push(as_engine_error(view.path, cause))
        }
        for (const run_view of this.job_runs(view.path)) {
          const record = run_view.record
          if (record === null) {
            continue
          }
          // A run still "launching" whose script this engine is not holding
          // is a previous session's leftover (§10): the stdout that carried
          // its submission id died with that process.
          if (
            record.submission_id === '' &&
            !is_terminal(record.status) &&
            !this.launching.some((in_flight) => in_flight.run_id === run_view.run_id)
          ) {
            apply_status(record, 'ERROR', now_stamp())
            record.error =
              'coco closed while the launch script was running; the submission id is lost'
            try {
              this.write_run_record(view.path, record)
            } catch (cause) {
              report.report_errors.push(as_engine_error(view.path, cause))
            }
            continue
          }
          if (record.status === 'COMPLETED' || record.status === 'ANALYZING') {
            report.reports_run += 1
            try {
              await this.report_run(view.path, run_view.run_id, 'auto')
            } catch (cause) {
              report.report_errors.push(as_engine_error(view.path, cause))
            }
          }
        }
      } else {
        for (const run_view of this.bench_runs(view.path)) {
          const record = run_view.record
          if (record === null) {
            continue
          }
          const needs_report = record.report === undefined || !record.report.attempted
          if (!needs_report) {
            continue
          }
          try {
            const status = this.bench_status(view.path, run_view.run_id)
            if (status.status === 'ANALYZING') {
              report.reports_run += 1
              await this.bench_report(view.path, run_view.run_id)
            }
          } catch (cause) {
            report.report_errors.push(as_engine_error(view.path, cause))
          }
        }
      }
    }
    return report
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private find_name_collision(name: string): string | null {
    for (const slot of this.manifests.values()) {
      if (slot.manifest !== null && slot.manifest.name === name) {
        return slot.manifest.name
      }
    }
    return null
  }

  find_job_by_name(name: string): [string, JobManifest] | null {
    for (const [folder, slot] of this.manifests) {
      if (slot.manifest !== null && slot.manifest.kind === 'job' && slot.manifest.name === name) {
        return [folder, slot.manifest]
      }
    }
    return null
  }

  find_bench_path_by_name(name: string): string | null {
    for (const [folder, slot] of this.manifests) {
      if (slot.manifest !== null && slot.manifest.kind === 'bench' && slot.manifest.name === name) {
        return folder
      }
    }
    return null
  }

  /** Write-through: memory first, then the folder, then remember the mtime
   * so the next reconcile pass does not read our own write back. */
  private write_run_record(folder: string, record: RunRecord): void {
    map_for(this.job_records, folder).set(record.run_id, { record, error: null })
    this.persist(folder, record.run_id, record)
  }

  private write_bench_record(folder: string, record: BenchRecord): void {
    map_for(this.bench_records, folder).set(record.run_id, { record, error: null })
    this.persist(folder, record.run_id, record)
  }

  private persist(folder: string, run_id: number, record: object): void {
    const record_path = path.join(folder, 'runs', String(run_id), 'run.json')
    write_atomic(record_path, JSON.stringify(record, null, 2))
  }

  private resolve_members(record: BenchRecord): ResolvedMember[] {
    return record.members.map((member) => {
      const found = this.find_job_by_name(member.job)
      let member_record: RunRecord | null = null
      if (found !== null) {
        member_record = this.job_records.get(found[0])?.get(member.run_id)?.record ?? null
      }
      return {
        run_id: member.run_id,
        job_name: member.job,
        job_path: found?.[0] ?? null,
        record: member_record
      }
    })
  }
}

function map_for<T>(
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

function views_of<T>(
  slots: Map<number, RecordSlot<T>> | undefined
): { run_id: number; record: T | null; record_error: EngineError | null }[] {
  if (slots === undefined) {
    return []
  }
  const views = [...slots.entries()].map(([run_id, slot]) => ({
    run_id,
    record: slot.record,
    record_error: slot.error
  }))
  views.sort((a, b) => b.run_id - a.run_id)
  return views
}

/** The bench status derivation (§9.1), over fully-resolved members. */
function derive_bench_status(
  members: RunRecord[],
  bench: BenchRecord,
  report_exists: boolean
): Status {
  if (members.some((member) => member.status === 'CANCELLING')) {
    return 'CANCELLING'
  }
  if (members.some((member) => !is_terminal(member.status))) {
    if (members.every((member) => member.status === 'STARTING')) {
      return 'STARTING'
    }
    return 'RUNNING'
  }
  if (bench.launch_failures.length > 0 || members.some((m) => m.status === 'ERROR')) {
    return 'ERROR'
  }
  if (members.some((m) => m.status === 'FAILED')) {
    return 'FAILED'
  }
  if (members.some((m) => m.status === 'CANCELLED')) {
    return 'CANCELLED'
  }
  if (bench.report !== undefined && bench.report.attempted) {
    if (bench.report.error !== undefined) {
      return 'ERROR'
    }
    if (!report_exists) {
      return 'ERROR'
    }
  }
  return report_exists ? 'SUCCEEDED' : 'ANALYZING'
}

export function report_on_disk(folder: string, run_id: number): boolean {
  const file = path.join(folder, 'report', `${run_id}.txt`)
  return fs.existsSync(file) && fs.statSync(file).isFile()
}

/** Strips a trailing `.tmpl` from the template's file name (§6.1). */
function artifact_name(template_rel: string): string {
  const name = path.basename(template_rel)
  if (name.endsWith('.tmpl') && name !== '.tmpl') {
    return name.slice(0, -'.tmpl'.length)
  }
  return name
}

/** Declared params and provided values must be exactly the same set (§2). */
function validate_params(declared: string[], provided: Record<string, string>, set: string): void {
  const declared_set = new Set(declared)
  const provided_set = new Set(Object.keys(provided))
  const missing = [...declared_set].filter((name) => !provided_set.has(name)).sort()
  const extra = [...provided_set].filter((name) => !declared_set.has(name)).sort()
  // A key carrying a blank value was never supplied (§2.1).
  const blank = [...declared_set]
    .filter((name) => provided[name] !== undefined && provided[name].trim() === '')
    .sort()
  if (missing.length === 0 && extra.length === 0 && blank.length === 0) {
    return
  }
  throw EngineError.validation(
    `${set} parameters must match the manifest exactly and each one needs a value; ` +
      `missing ${describe_names(missing)}, extra ${describe_names(extra)}, empty ${describe_names(blank)}`
  )
}

function describe_names(names: string[]): string {
  if (names.length === 0) {
    return 'none'
  }
  return names.map((name) => `\`${name}\``).join(', ')
}

/**
 * A launch must exit 0 and print exactly one `COCO_RETURN:` line whose
 * payload is a single non-empty token (§7.1).
 */
function parse_launch_return(invocation: Invocation): string {
  if (invocation.timed_out || invocation.exit !== 0) {
    throw new Error('')
  }
  const lines = invoke.coco_return_lines(invocation.stdout)
  const last = lines[lines.length - 1]
  if (last === undefined) {
    throw new Error('script printed no COCO_RETURN: line')
  }
  if (last === '' || last.split(/\s+/).length !== 1) {
    throw new Error('COCO_RETURN: payload must be a single token')
  }
  return last
}

function parse_plan_line(line: string): PlanLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new Error(`not a JSON object: ${(cause as Error).message}`, { cause })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('must be a JSON object')
  }
  const object = value as Record<string, unknown>
  const job = object.job
  if (typeof job !== 'string') {
    throw new Error('missing string field `job`')
  }
  const raw_params = object.params
  if (typeof raw_params !== 'object' || raw_params === null || Array.isArray(raw_params)) {
    throw new Error('missing object field `params`')
  }
  const params: Record<string, string> = {}
  for (const [name, param_value] of Object.entries(raw_params as Record<string, unknown>)) {
    if (typeof param_value !== 'string') {
      throw new Error(`param \`${name}\` must be a string`)
    }
    params[name] = param_value
  }
  return { job, params }
}

function invocation_error(script: string, invocation: Invocation, detail: string): EngineError {
  const output =
    detail === ''
      ? invoke.invocation_output(invocation)
      : `${detail}\n${invoke.invocation_output(invocation)}`
  return EngineError.invocation(script, invocation.exit, invocation.timed_out, output)
}

/** BTreeMap parity: object keys in sorted order, so JSON output is stable. */
function sorted(map: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of Object.keys(map).sort()) {
    result[key] = map[key]
  }
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
