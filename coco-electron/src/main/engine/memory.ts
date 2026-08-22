// The in-memory truth (convention §1–§5, §12): which folders are registered,
// every manifest, every job and bench record. Reads never touch the disk.
// Writes mutate memory first and write through to the experiment folder —
// same file formats, so folders stay inspectable and interchangeable with the
// Rust engine. Between reconcile passes memory wins; a concurrent hand-edit
// can lose, which is accepted (local, single instance).
//
// `Engine` (index.ts) extends this with the operations that run scripts over
// it: `job.ts`, `bench.ts`, `in_flight.ts`.

import fs from 'node:fs'
import path from 'node:path'
import { EngineError, as_engine_error } from './errors'
import { load_manifest } from './manifest'
import type { JobManifest, Manifest } from './manifest'
import type { BenchRecord, RunRecord } from './record'
import { load_store, save_store, write_atomic } from './store'
import type { StoreData } from './store'

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

/** A bench member looked up in its job's records (§8.3, §9.1); `null` where the lookup fails. */
export interface ResolvedMember {
  run_id: number
  job_name: string
  job_path: string | null
  record: RunRecord | null
}

interface ManifestSlot {
  manifest: Manifest | null
  error: EngineError | null
}

interface RecordSlot<T> {
  record: T | null
  error: EngineError | null
}

export class Memory {
  private readonly store_path: string
  private store: StoreData

  // store.json persists only which folders are registered; everything else
  // lives here and is written through to the folders as records.
  private manifests = new Map<string, ManifestSlot>()
  private job_records = new Map<string, Map<number, RecordSlot<RunRecord>>>()
  private bench_records = new Map<string, Map<number, RecordSlot<BenchRecord>>>()

  constructor(store_path: string) {
    this.store_path = store_path
    this.store = load_store(store_path)
    this.reconcile()
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
  // Lookups
  // ------------------------------------------------------------------

  /**
   * The next run id for one experiment: one past the highest it already has,
   * or `0` if it has none. Derived from the records, never stored.
   *
   * Ids are per experiment, so two experiments each have a run `0`.
   * See `doc/convention.md` §5 for why there is no counter.
   */
  next_run_id(kind: 'job' | 'bench', folder: string): number {
    const mine = (kind === 'job' ? this.job_records : this.bench_records).get(folder)
    if (mine === undefined || mine.size === 0) {
      return 0
    }
    return Math.max(...mine.keys()) + 1
  }

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

  resolve_members(record: BenchRecord): ResolvedMember[] {
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

  // ------------------------------------------------------------------
  // Write-through: memory first, then the folder.
  // ------------------------------------------------------------------

  write_run_record(folder: string, record: RunRecord): void {
    map_for(this.job_records, folder).set(record.run_id, { record, error: null })
    this.persist(folder, record.run_id, record)
  }

  write_bench_record(folder: string, record: BenchRecord): void {
    map_for(this.bench_records, folder).set(record.run_id, { record, error: null })
    this.persist(folder, record.run_id, record)
  }

  /**
   * Forgets a run that was reserved and never launched (§7.1): the record
   * leaves memory and the folder. The run directory and the rendered script
   * in it are left as they are.
   */
  drop_run(folder: string, run_id: number): void {
    this.job_records.get(folder)?.delete(run_id)
    fs.rmSync(path.join(folder, 'runs', String(run_id), 'run.json'), { force: true })
  }

  private persist(folder: string, run_id: number, record: object): void {
    const record_path = path.join(folder, 'runs', String(run_id), 'run.json')
    write_atomic(record_path, JSON.stringify(record, null, 2))
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
