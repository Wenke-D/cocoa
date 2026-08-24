// The in-memory truth (convention §1–§5, §12): the registered jobs and
// benches, each holding its manifest and its runs. Reads never touch the
// disk. Writes mutate memory first and write through to the experiment
// folder — same file formats, so folders stay inspectable. Between reconcile
// passes memory wins; a concurrent hand-edit can lose, which is accepted
// (local, single instance).
//
// Jobs and benches are the whole domain; there is no type over both. The
// store remembers which folders are which, so a folder whose manifest breaks
// stays what it was, carrying the error, and one whose manifest changes kind
// moves across.
//
// `Engine` (index.ts) extends this with the operations that run scripts over
// it: `job.ts`, `bench.ts`, `in_flight.ts`.

import fs from 'node:fs'
import path from 'node:path'
import { EngineError, as_engine_error } from './errors'
import { load_manifest } from './manifest'
import type { BenchManifest, JobManifest, Manifest } from './manifest'
import type { BenchRecord, RunRecord } from './record'
import { load_store, save_store, write_atomic } from './store'

export interface RunView<R> {
  run_id: number
  record: R | null
  record_error: EngineError | null
}

interface RecordSlot<R> {
  record: R | null
  error: EngineError | null
}

/**
 * One folder's `runs/` (§7, §12). Records are cocoa's own files and nobody
 * else changes them, so they are read exactly once — when the folder is
 * first seen — and every write lands in memory first, then in
 * `runs/<id>/run.json`.
 */
export class Runs<R extends { run_id: number }> {
  private readonly folder: string
  private readonly slots = new Map<number, RecordSlot<R>>()

  constructor(folder: string) {
    this.folder = folder
    let entries: string[]
    try {
      entries = fs.readdirSync(path.join(folder, 'runs'))
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue
      }
      const record_path = this.record_path(Number(entry))
      try {
        const text = fs.readFileSync(record_path, 'utf8')
        this.slots.set(Number(entry), { record: JSON.parse(text) as R, error: null })
      } catch (cause) {
        this.slots.set(Number(entry), {
          record: null,
          error: EngineError.store(
            record_path,
            `run.json does not parse: ${(cause as Error).message}`
          )
        })
      }
    }
  }

  /** Every run, newest first; one whose record does not parse carries the error. */
  all(): RunView<R>[] {
    const views = [...this.slots.entries()].map(([run_id, slot]) => ({
      run_id,
      record: slot.record,
      record_error: slot.error
    }))
    views.sort((a, b) => b.run_id - a.run_id)
    return views
  }

  record(run_id: number): R {
    const slot = this.slots.get(run_id)
    if (slot === undefined) {
      throw EngineError.not_found(`run ${run_id} in ${this.folder}`)
    }
    if (slot.record === null) {
      throw slot.error ?? EngineError.not_found(`run ${run_id} in ${this.folder}`)
    }
    return slot.record
  }

  find(run_id: number): R | null {
    return this.slots.get(run_id)?.record ?? null
  }

  /**
   * One past the highest id here, or `0`. Derived, never stored — §5 says
   * why there is no counter. Ids are per experiment: two experiments each
   * have a run `0`.
   */
  next_id(): number {
    if (this.slots.size === 0) {
      return 0
    }
    return Math.max(...this.slots.keys()) + 1
  }

  /** Memory first, then the folder. */
  write(record: R): void {
    this.slots.set(record.run_id, { record, error: null })
    write_atomic(this.record_path(record.run_id), JSON.stringify(record, null, 2))
  }

  /**
   * Forgets a run that was reserved and never launched (§7.1): the record
   * leaves memory and the folder. The run directory and the rendered script
   * in it are left as they are.
   */
  drop(run_id: number): void {
    this.slots.delete(run_id)
    fs.rmSync(this.record_path(run_id), { force: true })
  }

  private record_path(run_id: number): string {
    return path.join(this.folder, 'runs', String(run_id), 'run.json')
  }
}

/** A registered job folder (§2): its manifest as last read, and its runs. */
export class Job {
  readonly path: string
  /** `null` while `cocoa.toml` is unusable; `manifest_error` then says why (§4). */
  manifest: JobManifest | null
  manifest_error: EngineError | null = null
  readonly runs: Runs<RunRecord>

  constructor(folder: string, manifest: JobManifest | null = null) {
    this.path = folder
    this.manifest = manifest
    this.runs = new Runs(folder)
  }

  /** The manifest, or the error standing in its place. */
  usable_manifest(): JobManifest {
    if (this.manifest === null) {
      throw this.manifest_error ?? EngineError.manifest(this.path, 'manifest is unusable')
    }
    return this.manifest
  }
}

/** A registered bench folder (§3): its manifest as last read, and its runs. */
export class Bench {
  readonly path: string
  /** `null` while `cocoa.toml` is unusable; `manifest_error` then says why (§4). */
  manifest: BenchManifest | null
  manifest_error: EngineError | null = null
  readonly runs: Runs<BenchRecord>

  constructor(folder: string, manifest: BenchManifest | null = null) {
    this.path = folder
    this.manifest = manifest
    this.runs = new Runs(folder)
  }

  /** The manifest, or the error standing in its place. */
  usable_manifest(): BenchManifest {
    if (this.manifest === null) {
      throw this.manifest_error ?? EngineError.manifest(this.path, 'manifest is unusable')
    }
    return this.manifest
  }
}

/** A bench member looked up in its job's records (§8.3, §9.1); `null` where the lookup fails. */
export interface ResolvedMember {
  run_id: number
  job_name: string
  job_path: string | null
  record: RunRecord | null
}

/** What `register` answers: the canonical path a folder is keyed by, and whether it was already there. */
export interface Registration {
  path: string
  already: boolean
}

export class Memory {
  private readonly store_path: string
  private readonly jobs_by_path = new Map<string, Job>()
  private readonly benches_by_path = new Map<string, Bench>()

  constructor(store_path: string) {
    this.store_path = store_path
    const store = load_store(store_path)
    for (const folder of store.jobs) {
      this.jobs_by_path.set(folder, new Job(folder))
    }
    for (const folder of store.benches) {
      this.benches_by_path.set(folder, new Bench(folder))
    }
    this.reconcile()
  }

  // ------------------------------------------------------------------
  // Reconciliation. Manifests are the user's authored files: small, and
  // re-read every pass so an edited cocoa.toml lands at the next tick (§4).
  // Runs were read when the folder was first seen and are not looked at
  // again — see `Runs`.
  // ------------------------------------------------------------------

  reconcile(): void {
    for (const job of this.jobs()) {
      const read = read_manifest(job.path)
      if (read.manifest !== null && read.manifest.kind !== 'job') {
        this.rekind(job.path, read.manifest)
        continue
      }
      job.manifest = read.manifest
      job.manifest_error = read.error
    }
    for (const bench of this.benches()) {
      const read = read_manifest(bench.path)
      if (read.manifest !== null && read.manifest.kind !== 'bench') {
        this.rekind(bench.path, read.manifest)
        continue
      }
      bench.manifest = read.manifest
      bench.manifest_error = read.error
    }
  }

  /**
   * A folder whose manifest now says the other kind leaves the side it was
   * on and is built afresh on the other, its runs re-read as that kind's
   * records.
   */
  private rekind(folder: string, manifest: Manifest): void {
    this.jobs_by_path.delete(folder)
    this.benches_by_path.delete(folder)
    this.adopt(folder, manifest)
    this.save()
  }

  private adopt(folder: string, manifest: Manifest): void {
    if (manifest.kind === 'job') {
      this.jobs_by_path.set(folder, new Job(folder, manifest))
    } else {
      this.benches_by_path.set(folder, new Bench(folder, manifest))
    }
  }

  private save(): void {
    save_store(this.store_path, {
      jobs: [...this.jobs_by_path.keys()],
      benches: [...this.benches_by_path.keys()]
    })
  }

  // ------------------------------------------------------------------
  // Registration and lookup (all answered from memory)
  // ------------------------------------------------------------------

  /**
   * Registers a folder (§5): refused unless its manifest is usable at this
   * moment and its name is free. A folder already registered is a no-op,
   * and says so.
   */
  register(folder: string): Registration {
    let canonical: string
    try {
      canonical = fs.realpathSync(folder)
    } catch (cause) {
      throw EngineError.io(folder, cause)
    }
    if (!fs.statSync(canonical).isDirectory()) {
      throw EngineError.validation(`${canonical} is not a folder`)
    }
    if (this.registered(canonical)) {
      return { path: canonical, already: true }
    }
    const manifest = load_manifest(canonical)
    const collision = this.find_name_collision(manifest.name)
    if (collision !== null) {
      throw EngineError.name_collision(collision)
    }
    this.adopt(canonical, manifest)
    this.save()
    return { path: canonical, already: false }
  }

  unregister(folder: string): void {
    let canonical: string
    try {
      canonical = fs.realpathSync(folder)
    } catch {
      canonical = folder
    }
    if (!this.jobs_by_path.delete(canonical) && !this.benches_by_path.delete(canonical)) {
      throw EngineError.not_found(`folder ${canonical}`)
    }
    this.save()
  }

  registered(folder: string): boolean {
    return this.jobs_by_path.has(folder) || this.benches_by_path.has(folder)
  }

  /** Every registered job, in registration order. */
  jobs(): Job[] {
    return [...this.jobs_by_path.values()]
  }

  /** Every registered bench, in registration order. */
  benches(): Bench[] {
    return [...this.benches_by_path.values()]
  }

  job(folder: string): Job {
    const job = this.jobs_by_path.get(folder)
    if (job === undefined) {
      if (this.benches_by_path.has(folder)) {
        throw EngineError.validation(`${folder} is a bench, not a job`)
      }
      throw EngineError.not_found(`job ${folder}`)
    }
    return job
  }

  bench(folder: string): Bench {
    const bench = this.benches_by_path.get(folder)
    if (bench === undefined) {
      if (this.jobs_by_path.has(folder)) {
        throw EngineError.validation(`${folder} is a job, not a bench`)
      }
      throw EngineError.not_found(`bench ${folder}`)
    }
    return bench
  }

  /** Names are read off manifests, so a job whose manifest is broken has none (§5). */
  find_job_by_name(name: string): Job | null {
    return this.jobs().find((job) => job.manifest?.name === name) ?? null
  }

  find_bench_by_name(name: string): Bench | null {
    return this.benches().find((bench) => bench.manifest?.name === name) ?? null
  }

  private find_name_collision(name: string): string | null {
    if (this.find_job_by_name(name) !== null || this.find_bench_by_name(name) !== null) {
      return name
    }
    return null
  }

  resolve_members(record: BenchRecord): ResolvedMember[] {
    return record.members.map((member) => {
      const job = this.find_job_by_name(member.job)
      return {
        run_id: member.run_id,
        job_name: member.job,
        job_path: job?.path ?? null,
        record: job?.runs.find(member.run_id) ?? null
      }
    })
  }
}

function read_manifest(folder: string): { manifest: Manifest | null; error: EngineError | null } {
  try {
    return { manifest: load_manifest(folder), error: null }
  } catch (cause) {
    return { manifest: null, error: as_engine_error(folder, cause) }
  }
}
