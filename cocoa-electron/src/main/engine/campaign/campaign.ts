import { EngineError } from '../errors'
import type { CampaignManifest } from '../manifest'
import type { CampaignRecord } from '../record'
import { Runs } from '../runs'

/** A registered campaign folder (§3): its manifest as last read, and its runs. */
export class Campaign {
  /** The canonical folder path the campaign is keyed by. */
  readonly path: string
  /** `null` while `cocoa.toml` is unusable; `manifest_error` then says why (§4). */
  manifest: CampaignManifest | null
  manifest_error: EngineError | null = null
  readonly runs: Runs<CampaignRecord>

  constructor(folder: string, manifest: CampaignManifest | null = null) {
    this.path = folder
    this.manifest = manifest
    this.runs = new Runs(folder)
  }

  /** The manifest, or the error standing in its place. */
  usable_manifest(): CampaignManifest {
    if (this.manifest === null) {
      throw this.manifest_error ?? EngineError.manifest(this.path, 'manifest is unusable')
    }
    return this.manifest
  }
}
