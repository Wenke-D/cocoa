// What the renderer may ask for. Wiring only: call an operation, publish, and
// answer — the deciding is `operations.ts`'s.
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
  StartResult,
  DeleteTarget,
  DeleteResult,
  RerunReportResult,
  RerunReportTarget
} from '@shared/world'
import { empty } from '@shared/maybe'
import { boot } from '../boot'
import * as operations from './operations'
import { current_world, publish_cycle } from './publish'
import { refresh_and_publish } from './refresh'
import { engine } from '../runtime'

/**
 * Define message between main process and render process
 */
export function register_ipc(): void {
  // The renderer pulls its starting world; a reload is its own resync. Events
  // sent before the bootstrap answer are applied to the old page state and then
  // overwritten by the (newer) bootstrap — order-safe either way.
  ipcMain.handle('cocoa:bootstrap', async (): Promise<BootstrapPayload> => {
    // A development control (§28): the Starting state is sub-second and
    // cannot be seen, let alone driven, unless the answer is held.
    if (boot.bootstrap_delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, boot.bootstrap_delay_ms))
    }
    return { world: current_world() }
  })

  // Events go out before the answer (publish-before-emit): by the time the
  // renderer learns the run id, it has already applied the run.
  ipcMain.handle(
    'cocoa:start',
    async (_event, name: string, parameters: Record<string, unknown>): Promise<StartResult> => {
      const result = await operations.start_run(engine, name, parameters)
      publish_cycle(empty())
      return result
    }
  )

  // A cancel that was accepted has already moved the run to `CANCELLING`, and
  // the modal closes on the answer — so the events must precede it here too, or
  // the page behind the modal would still read `RUNNING`.
  ipcMain.handle('cocoa:cancel', async (_event, target: CancelTarget): Promise<CancelResult> => {
    const result = await operations.cancel(engine, target)
    publish_cycle(empty())
    return result
  })

  // Deletion is synchronous — files and memory — and the events go out
  // before the modal closes, so the page behind it never shows the run it
  // just deleted.
  ipcMain.handle('cocoa:delete_run', (_event, target: DeleteTarget): DeleteResult => {
    const result = operations.delete_run(engine, target)
    publish_cycle(empty())
    return result
  })

  // A re-run marks the report due and answers; the run reads `Generating`
  // before the button's answer arrives. A tick is asked for at once rather
  // than in up to three seconds — dropped if one is already under way, which
  // takes the report itself or leaves it to the next.
  ipcMain.handle('cocoa:rerun_report', (_event, target: RerunReportTarget): RerunReportResult => {
    const result = operations.rerun_report(engine, target)
    publish_cycle(empty())
    if (result.ok) {
      void refresh_and_publish()
    }
    return result
  })

  // Nothing stands between the click and the picker, and a path is never typed
  // by hand (§11.5). The registration itself is synchronous: atomic on the
  // event loop, whatever else is in flight.
  ipcMain.handle('cocoa:add_folder', async (): Promise<AddFolderResult> => {
    const picked = await dialog.showOpenDialog({
      title: 'Add experiment folder',
      properties: ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, cancelled: true, message: '' }
    }
    const result = operations.add_folder(engine, picked.filePaths[0])
    publish_cycle(empty())
    return result
  })

  ipcMain.handle('cocoa:remove_folder', (_event, entity_id: string): RemoveFolderResult => {
    const result = operations.remove_folder(engine, entity_id)
    publish_cycle(empty())
    return result
  })

  // Reading a report neither changes engine state nor runs a script: one
  // synchronous look at the disk.
  ipcMain.handle('cocoa:report', (_event, target: ReportTarget): ReportResult =>
    operations.read_report(engine, target)
  )

  // The status bar's refresh: it waits out a tick already under way and says
  // how it went. One at a time — a second while it is pending is ignored,
  // which the held-down button makes a stray rather than a case.
  ipcMain.handle('cocoa:refresh', async (): Promise<void> => {
    await refresh_and_publish(true)
  })
}
