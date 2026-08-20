// What the renderer may ask for. Wiring only: call an operation, publish, and
// answer — the deciding is `operations.ts`'s, the queueing is `serial.ts`'s.
//
// Every handler is registered in one call from `index.ts`, at whenReady.

import { dialog, ipcMain } from 'electron'
import type {
  AddFolderResult,
  BootstrapPayload,
  CancelResult,
  CancelTarget,
  RemoveFolderResult,
  ReportResult,
  ReportTarget,
  StartResult
} from '@shared/world'
import type { UiState } from '@shared/ui'
import { arrangement, mergeFromRenderer } from './arrangement'
import * as operations from './operations'
import { currentModel, markBootstrapped, publishCycle } from './publish'
import { refreshAndPublish } from './refresh'
import { engine, onEngine } from './runtime'

export function registerIpc(): void {
  // The renderer pulls its starting state; a reload is its own resync. Events
  // sent before the bootstrap answer are applied to the old page state and then
  // overwritten by the (newer) bootstrap — order-safe either way.
  ipcMain.handle('coco:bootstrap', (): BootstrapPayload => {
    const world = currentModel()
    markBootstrapped()
    return { world, ui: arrangement() }
  })

  ipcMain.handle('coco:saveUi', (_event, state: UiState): void => {
    mergeFromRenderer(state)
  })

  // Events go out before the answer (publish-before-emit): by the time the
  // renderer learns the run id, it has already applied the run.
  ipcMain.handle(
    'coco:start',
    async (_event, name: string, parameters: Record<string, string>): Promise<StartResult> =>
      onEngine(async () => {
        const result = await operations.startRun(engine, name, parameters)
        publishCycle(null)
        return result
      })
  )

  // A cancel that was accepted has already moved the run to `CANCELLING`, and
  // the modal closes on the answer — so the events must precede it here too, or
  // the page behind the modal would still read `RUNNING`.
  ipcMain.handle('coco:cancel', async (_event, target: CancelTarget): Promise<CancelResult> =>
    onEngine(async () => {
      const result = await operations.cancel(engine, target)
      publishCycle(null)
      return result
    })
  )

  // Nothing stands between the click and the picker, and a path is never typed
  // by hand (§11.5). The picker itself is deliberately *outside* the engine
  // queue — a dialog can stay open for minutes, and the refresh tick must not
  // wait on the user's file browsing. Only the registration takes a turn.
  ipcMain.handle('coco:addFolder', async (): Promise<AddFolderResult> => {
    const picked = await dialog.showOpenDialog({
      title: 'Add experiment folder',
      properties: ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, cancelled: true, message: '' }
    }
    return onEngine(async () => {
      const result = operations.addFolder(engine, picked.filePaths[0])
      publishCycle(null)
      return result
    })
  })

  ipcMain.handle(
    'coco:removeFolder',
    async (_event, entityId: string): Promise<RemoveFolderResult> =>
      onEngine(async () => {
        const result = operations.removeFolder(engine, entityId)
        publishCycle(null)
        return result
      })
  )

  // Reading a report neither changes engine state nor runs a script, so it
  // does not take a turn: it must not queue behind a slow poll.
  ipcMain.handle('coco:report', (_event, target: ReportTarget): ReportResult =>
    operations.readReport(engine, target)
  )

  // The status bar's refresh: it takes its turn like everything else, but it is
  // never the tick that gets dropped, and it says how it went.
  ipcMain.handle('coco:refresh', async (): Promise<void> => {
    await refreshAndPublish(true)
  })
}
