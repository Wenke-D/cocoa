// The in-memory truth (convention §1–§5, §12): the registered jobs and
// campaigns, each holding its manifest and its runs. Reads never touch the
// disk. Writes mutate memory first and write through to the experiment
// folder — same file formats, so folders stay inspectable. Between reconcile
// passes memory wins; a concurrent hand-edit can lose, which is accepted
// (local, single instance).
//
// Jobs and campaigns are the whole domain; there is no type over both. The
// store remembers which folders are which, so a folder whose manifest breaks
// stays what it was, carrying the error, and one whose manifest changes kind
// moves across.

import fs from 'node:fs'
import { Campaign } from './campaign/campaign'
import { EngineError, as_engine_error } from './errors'
import { Job } from './job/job'
import { load_manifest } from './manifest'
import type { Manifest } from './manifest'
import type { CampaignRecord, RunRecord } from './record'
import { load_store, save_store } from './store'

/** A campaign member looked up in its job's records (§8.3, §9.1); `null` where the lookup fails. */
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

/** Every registered job and campaign, keyed by folder, and the store that lists them. */
export class Memory {
  /** The private store (store.ts) registrations are written to. */
  private readonly store_path: string
  private readonly jobs_by_path = new Map<string, Job>()
  private readonly campaigns_by_path = new Map<string, Campaign>()

  constructor(store_path: string) {
    this.store_path = store_path
    const store = load_store(store_path)
    for (const folder of store.jobs) {
      this.jobs_by_path.set(folder, new Job(folder))
    }
    for (const folder of store.campaigns) {
      this.campaigns_by_path.set(folder, new Campaign(folder))
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
    for (const campaign of this.campaigns()) {
      const read = read_manifest(campaign.path)
      if (read.manifest !== null && read.manifest.kind !== 'campaign') {
        this.rekind(campaign.path, read.manifest)
        continue
      }
      campaign.manifest = read.manifest
      campaign.manifest_error = read.error
    }
  }

  /**
   * A folder whose manifest now says the other kind leaves the side it was
   * on and is built afresh on the other, its runs re-read as that kind's
   * records.
   */
  private rekind(folder: string, manifest: Manifest): void {
    this.jobs_by_path.delete(folder)
    this.campaigns_by_path.delete(folder)
    this.adopt(folder, manifest)
    this.save()
  }

  private adopt(folder: string, manifest: Manifest): void {
    if (manifest.kind === 'job') {
      this.jobs_by_path.set(folder, new Job(folder, manifest))
    } else {
      this.campaigns_by_path.set(folder, new Campaign(folder, manifest))
    }
  }

  private save(): void {
    save_store(this.store_path, {
      jobs: [...this.jobs_by_path.keys()],
      campaigns: [...this.campaigns_by_path.keys()]
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
    if (!this.jobs_by_path.delete(canonical) && !this.campaigns_by_path.delete(canonical)) {
      throw EngineError.not_found(`folder ${canonical}`)
    }
    this.save()
  }

  registered(folder: string): boolean {
    return this.jobs_by_path.has(folder) || this.campaigns_by_path.has(folder)
  }

  /** Every registered job, in registration order. */
  jobs(): Job[] {
    return [...this.jobs_by_path.values()]
  }

  /** Every registered campaign, in registration order. */
  campaigns(): Campaign[] {
    return [...this.campaigns_by_path.values()]
  }

  job(folder: string): Job {
    const job = this.jobs_by_path.get(folder)
    if (job === undefined) {
      if (this.campaigns_by_path.has(folder)) {
        throw EngineError.validation(`${folder} is a campaign, not a job`)
      }
      throw EngineError.not_found(`job ${folder}`)
    }
    return job
  }

  campaign(folder: string): Campaign {
    const campaign = this.campaigns_by_path.get(folder)
    if (campaign === undefined) {
      if (this.jobs_by_path.has(folder)) {
        throw EngineError.validation(`${folder} is a job, not a campaign`)
      }
      throw EngineError.not_found(`campaign ${folder}`)
    }
    return campaign
  }

  /** Names are read off manifests, so a job whose manifest is broken has none (§5). */
  find_job_by_name(name: string): Job | null {
    return this.jobs().find((job) => job.manifest?.name === name) ?? null
  }

  find_campaign_by_name(name: string): Campaign | null {
    return this.campaigns().find((campaign) => campaign.manifest?.name === name) ?? null
  }

  private find_name_collision(name: string): string | null {
    if (this.find_job_by_name(name) !== null || this.find_campaign_by_name(name) !== null) {
      return name
    }
    return null
  }

  resolve_members(record: CampaignRecord): ResolvedMember[] {
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

  /** Every member's earlier attempts (§8.5), looked up as `resolve_members` looks up the current runs. */
  resolve_attempts(record: CampaignRecord): ResolvedMember[] {
    return record.members.flatMap((member) => {
      const job = this.find_job_by_name(member.job)
      return (member.attempts ?? []).map((run_id) => ({
        run_id,
        job_name: member.job,
        job_path: job?.path ?? null,
        record: job?.runs.find(run_id) ?? null
      }))
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
