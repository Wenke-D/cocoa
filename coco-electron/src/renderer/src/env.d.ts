/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { Params } from '@shared/params'
import type {
  AddFolderResult,
  BootstrapPayload,
  CancelResult,
  CancelTarget,
  CocoEvent,
  RemoveFolderResult,
  ReportResult,
  ReportTarget,
  StartResult,
  DeleteTarget,
  DeleteResult
} from '@shared/world'

declare global {
  interface Window {
    coco: {
      bootstrap(): Promise<BootstrapPayload>
      start_run(name: string, parameters: Params): Promise<StartResult>
      cancel(target: CancelTarget): Promise<CancelResult>
      delete_run(target: DeleteTarget): Promise<DeleteResult>
      report(target: ReportTarget): Promise<ReportResult>
      add_folder(): Promise<AddFolderResult>
      remove_folder(entity_id: string): Promise<RemoveFolderResult>
      refresh_now(): Promise<void>
      on_events(callback: (events: CocoEvent[]) => void): () => void
    }
  }
}

export {}
