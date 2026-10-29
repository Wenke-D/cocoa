// What the renderer may ask for. Wiring only: call an operation, publish, and
// answer — the deciding is `operations.ts`'s.
//
// Every handler is registered in one call from `index.ts`, at whenReady.

import path from 'node:path'
import { app, dialog, ipcMain, shell } from 'electron'
import type {
  AddFolderResult,
  AttachmentsTarget,
  BootstrapPayload,
  CancelResult,
  CancelTarget,
  OpenAttachmentsResult,
  RemoveFolderResult,
  ReplaceTarget,
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
import { empty } from '@shared/maybe'
import { boot } from '../boot'
import * as operations from './operations'
import { current_world, publish_cycle } from './publish'
import { refresh_and_publish } from './refresh'
import { engine } from '../runtime'
import { send } from '../shell/window'

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
    async (
      _event,
      name: string,
      parameters: Record<string, unknown>,
      replaces?: ReplaceTarget
    ): Promise<StartResult> => {
      const result = await operations.start_run(engine, name, parameters, 'human', replaces)
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

  // A lock is a field on the record: written, published, answered.
  ipcMain.handle('cocoa:lock_report', (_event, target: LockReportTarget): LockReportResult => {
    const result = operations.lock_report(engine, target)
    publish_cycle(empty())
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

  // Attachments are whatever a report script brought, of any kind and size, so
  // they are the file manager's to show, not the app's.
  ipcMain.handle(
    'cocoa:open_attachments',
    async (_event, target: AttachmentsTarget): Promise<OpenAttachmentsResult> => {
      const location = operations.attachments_location(engine, target)
      if (!location.ok) {
        return location
      }
      const error = await shell.openPath(location.dir)
      return error === '' ? { ok: true } : { ok: false, message: error }
    }
  )

  // The person names where the copy goes, a new folder suggested in their
  // home; nothing is written until they have said so.
  ipcMain.handle(
    'cocoa:save_report',
    async (_event, target: SaveReportTarget): Promise<SaveReportResult> => {
      const name =
        current_world().entities.find((entity) => entity.id === target.entity_id)?.name ??
        path.basename(target.entity_id)
      const picked = await dialog.showSaveDialog({
        title: 'Save report as',
        defaultPath: path.join(app.getPath('home'), `${name}-run-${target.run_id}-report`),
        buttonLabel: 'Save'
      })
      if (picked.canceled || picked.filePath === undefined || picked.filePath === '') {
        return { ok: false, cancelled: true, message: '' }
      }
      return operations.save_report(engine, target, picked.filePath)
    }
  )

  // A viewer is the person's to close, so the answer is "started". One that
  // exits non-zero — at once, or an hour later — is said as a notice of its own.
  ipcMain.handle('cocoa:visualize', (_event, target: VisualizeTarget): Promise<VisualizeResult> =>
    operations.visualize(engine, target, (error) =>
      send([{ kind: 'notice', level: 'error', text: error.message }])
    )
  )

  // The status bar's refresh: it waits out a tick already under way and says
  // how it went. One at a time — a second while it is pending is ignored,
  // which the held-down button makes a stray rather than a case.
  ipcMain.handle('cocoa:refresh', async (): Promise<void> => {
    await refresh_and_publish(true)
  })
}
