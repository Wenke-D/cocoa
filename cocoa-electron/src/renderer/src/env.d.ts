/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { Params } from '@shared/params'
import type {
  AddFolderResult,
  AttachmentsTarget,
  BootstrapPayload,
  CancelResult,
  CancelTarget,
  CocoaEvent,
  OpenAttachmentsResult,
  RemoveFolderResult,
  ReportResult,
  ReportTarget,
  StartResult,
  DeleteTarget,
  DeleteResult,
  LockReportResult,
  LockReportTarget,
  RerunReportResult,
  RerunReportTarget,
  SaveReportResult,
  SaveReportTarget,
  VisualizeResult,
  VisualizeTarget
} from '@shared/protocol'

declare global {
  interface Window {
    cocoa: {
      bootstrap(): Promise<BootstrapPayload>
      start_run(name: string, parameters: Params): Promise<StartResult>
      cancel(target: CancelTarget): Promise<CancelResult>
      delete_run(target: DeleteTarget): Promise<DeleteResult>
      report(target: ReportTarget): Promise<ReportResult>
      rerun_report(target: RerunReportTarget): Promise<RerunReportResult>
      lock_report(target: LockReportTarget): Promise<LockReportResult>
      save_report(target: SaveReportTarget): Promise<SaveReportResult>
      open_attachments(target: AttachmentsTarget): Promise<OpenAttachmentsResult>
      visualize(target: VisualizeTarget): Promise<VisualizeResult>
      add_folder(): Promise<AddFolderResult>
      remove_folder(entity_id: string): Promise<RemoveFolderResult>
      refresh_now(): Promise<void>
      on_events(callback: (events: CocoaEvent[]) => void): () => void
    }
  }
}

export {}
