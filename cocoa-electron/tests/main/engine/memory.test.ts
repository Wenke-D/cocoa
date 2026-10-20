import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { load_store } from '../../../src/main/engine/store'
import { engine, settle } from '../../support/engine'
import { failure, throws } from '../../support/failure'
import { write } from '../../support/files'
import { campaign_folder, job_folder } from '../../support/fixtures'
import { cleanup_temp_dirs, temp_dir } from '../../support/temp_dir'

afterEach(cleanup_temp_dirs)

describe('registration', () => {
  // The entity is one the user knows and has run, so a manifest that breaks
  // later stays listed carrying the error (§11.5). Memory is the truth here,
  // so the edit lands at the next reconcile — the refresh tick's job.
  it('keeps an entity whose manifest breaks later, carrying the error', async () => {
    const dir = temp_dir()
    const folder = job_folder(dir, 'solver')
    const cocoa = engine(dir)
    cocoa.register(folder)

    write(folder, 'cocoa.toml', 'kind = "pipeline"\nname = "solver"\n')
    cocoa.reconcile()

    const jobs = cocoa.jobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].manifest_error).not.toBeNull()

    expect(await failure(cocoa.start_job(folder, {}, {}, 'human'))).toContain('kind')
  })

  // The store remembers which side a folder registered on, so a manifest
  // found broken at the next open still lands there, carrying the error.
  it('opens a job whose manifest broke while cocoa was closed, as a job', () => {
    const dir = temp_dir()
    const folder = job_folder(dir, 'solver')
    engine(dir).register(folder)
    write(folder, 'cocoa.toml', 'kind = "pipeline"\nname = "solver"\n')

    const reopened = engine(dir)
    expect(reopened.jobs().map((job) => job.path)).toEqual([folder])
    expect(reopened.campaigns()).toEqual([])
    expect(reopened.job(folder).manifest).toBeNull()
    expect(reopened.job(folder).manifest_error?.message).toContain('kind')
  })

  // A manifest that now declares the other kind moves the folder across,
  // and the store follows: the manifest decides, the store only remembers.
  it('moves a folder to the other side when its manifest changes kind', () => {
    const dir = temp_dir()
    const folder = job_folder(dir, 'was-a-job')
    const cocoa = engine(dir)
    cocoa.register(folder)

    const campaign_manifest = path.join(campaign_folder(dir, 'now-a-campaign', []), 'cocoa.toml')
    fs.copyFileSync(campaign_manifest, path.join(folder, 'cocoa.toml'))
    cocoa.reconcile()

    expect(cocoa.jobs()).toEqual([])
    expect(cocoa.campaigns().map((campaign) => campaign.path)).toEqual([folder])
    expect(cocoa.campaign(folder).manifest?.name).toBe('now-a-campaign')
    expect(load_store(path.join(dir, 'store.json'))).toEqual({ jobs: [], campaigns: [folder] })
  })

  // The other side of that rule: a manifest already broken when the folder is
  // picked never registers at all (§11.5).
  it('refuses a folder whose manifest is already broken', () => {
    const dir = temp_dir()
    const folder = path.join(dir, 'broken')
    fs.mkdirSync(folder, { recursive: true })
    write(folder, 'cocoa.toml', 'kind = "pipeline"\nname = "x"\n')

    const cocoa = engine(dir)
    expect(throws(() => cocoa.register(folder))).toContain('kind')
    expect(cocoa.jobs()).toEqual([])
  })

  it('refuses a second entity with a name already registered', () => {
    const dir = temp_dir()
    const first = job_folder(dir, 'same-name')
    // A different folder claiming the same name: what a copied experiment
    // looks like before anyone renames it.
    const second = job_folder(dir, 'elsewhere')
    const manifest = path.join(second, 'cocoa.toml')
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('elsewhere', 'same-name'))

    const cocoa = engine(dir)
    cocoa.register(first)
    expect(throws(() => cocoa.register(second))).toContain('already registered')
  })

  it('registers a folder once and unregisters it with its runs', async () => {
    const dir = temp_dir()
    const job = job_folder(dir, 'come-and-go')
    const cocoa = engine(dir)
    cocoa.register(job)
    cocoa.register(job)
    expect(cocoa.jobs()).toHaveLength(1)

    await cocoa.start_job(job, { size: '1' }, { gpu: '0' }, 'human')
    await settle(cocoa)
    expect(cocoa.job(job).runs.all()).toHaveLength(1)

    cocoa.unregister(job)
    expect(cocoa.jobs()).toEqual([])
    expect(throws(() => cocoa.job(job))).toContain('not found')
    expect(throws(() => cocoa.unregister(job))).toContain('not found')
  })
})
