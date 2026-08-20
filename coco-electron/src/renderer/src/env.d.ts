/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { UiState } from '@shared/ui'
import type {
  AddFolderResult,
  BootstrapPayload,
  CancelResult,
  CancelTarget,
  CocoEvent,
  RemoveFolderResult,
  ReportResult,
  ReportTarget,
  StartResult
} from '@shared/world'

declare global {
  interface Window {
    coco: {
      bootstrap(): Promise<BootstrapPayload>
      startRun(name: string, parameters: Record<string, string>): Promise<StartResult>
      cancel(target: CancelTarget): Promise<CancelResult>
      report(target: ReportTarget): Promise<ReportResult>
      addFolder(): Promise<AddFolderResult>
      removeFolder(entityId: string): Promise<RemoveFolderResult>
      refreshNow(): Promise<void>
      saveUi(state: UiState): Promise<void>
      onCommand(callback: (command: string) => void): () => void
      onEvents(callback: (events: CocoEvent[]) => void): () => void
    }
  }
}

export {}
