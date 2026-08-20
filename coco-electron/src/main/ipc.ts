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
import { empty } from '@shared/maybe'
import * as operations from './operations'
import { current_model, mark_bootstrapped, publish_cycle } from './publish'
import { refresh_and_publish } from './refresh'
import { engine, on_engine } from './runtime'

export function register_ipc(): void {
  // The renderer pulls its starting world; a reload is its own resync. Events
  // sent before the bootstrap answer are applied to the old page state and then
  // overwritten by the (newer) bootstrap — order-safe either way.
  ipcMain.handle('coco:bootstrap', (): BootstrapPayload => {
    const world = current_model()
    mark_bootstrapped()
    return { world }
  })

  // Events go out before the answer (publish-before-emit): by the time the
  // renderer learns the run id, it has already applied the run.
  ipcMain.handle(
    'coco:start',
    async (_event, name: string, parameters: Record<string, string>): Promise<StartResult> =>
      on_engine(async () => {
        const result = await operations.start_run(engine, name, parameters)
        publish_cycle(empty())
        return result
      })
  )

  // A cancel that was accepted has already moved the run to `CANCELLING`, and
  // the modal closes on the answer — so the events must precede it here too, or
  // the page behind the modal would still read `RUNNING`.
  ipcMain.handle('coco:cancel', async (_event, target: CancelTarget): Promise<CancelResult> =>
    on_engine(async () => {
      const result = await operations.cancel(engine, target)
      publish_cycle(empty())
      return result
    })
  )

  // Nothing stands between the click and the picker, and a path is never typed
  // by hand (§11.5). The picker itself is deliberately *outside* the engine
  // queue — a dialog can stay open for minutes, and the refresh tick must not
  // wait on the user's file browsing. Only the registration takes a turn.
  ipcMain.handle('coco:add_folder', async (): Promise<AddFolderResult> => {
    const picked = await dialog.showOpenDialog({
      title: 'Add experiment folder',
      properties: ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, cancelled: true, message: '' }
    }
    return on_engine(async () => {
      const result = operations.add_folder(engine, picked.filePaths[0])
      publish_cycle(empty())
      return result
    })
  })

  ipcMain.handle(
    'coco:remove_folder',
    async (_event, entity_id: string): Promise<RemoveFolderResult> =>
      on_engine(async () => {
        const result = operations.remove_folder(engine, entity_id)
        publish_cycle(empty())
        return result
      })
  )

  // Reading a report neither changes engine state nor runs a script, so it
  // does not take a turn: it must not queue behind a slow poll.
  ipcMain.handle('coco:report', (_event, target: ReportTarget): ReportResult =>
    operations.read_report(engine, target)
  )

  // The status bar's refresh: it takes its turn like everything else, but it is
  // never the tick that gets dropped, and it says how it went.
  ipcMain.handle('coco:refresh', async (): Promise<void> => {
    await refresh_and_publish(true)
  })
}
