import { EngineError } from '../errors'
import type { JobManifest } from '../manifest'
import type { RunRecord } from '../record'
import { Runs } from '../runs'

/** A registered job folder (§2): its manifest as last read, and its runs. */
export class Job {
  /** The canonical folder path the job is keyed by. */
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
