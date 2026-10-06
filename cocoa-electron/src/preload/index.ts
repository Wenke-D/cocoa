// The typed bridge: which main-process capabilities the page may call.
// The vocabulary of the event protocol: bootstrap once, then events.

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  bootstrap: (): Promise<unknown> => ipcRenderer.invoke('cocoa:bootstrap'),

  start_run: (name: string, parameters: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('cocoa:start', name, parameters),

  cancel: (target: unknown): Promise<unknown> => ipcRenderer.invoke('cocoa:cancel', target),

  delete_run: (target: unknown): Promise<unknown> => ipcRenderer.invoke('cocoa:delete_run', target),

  add_folder: (): Promise<unknown> => ipcRenderer.invoke('cocoa:add_folder'),

  remove_folder: (entity_id: string): Promise<unknown> =>
    ipcRenderer.invoke('cocoa:remove_folder', entity_id),

  report: (target: unknown): Promise<unknown> => ipcRenderer.invoke('cocoa:report', target),

  rerun_report: (target: unknown): Promise<unknown> =>
    ipcRenderer.invoke('cocoa:rerun_report', target),

  refresh_now: (): Promise<unknown> => ipcRenderer.invoke('cocoa:refresh'),

  on_events: (callback: (events: unknown) => void): (() => void) => {
    const listener = (_event: unknown, events: unknown): void => callback(events)
    ipcRenderer.on('cocoa:events', listener)
    return () => {
      ipcRenderer.removeListener('cocoa:events', listener)
    }
  }
}

contextBridge.exposeInMainWorld('cocoa', api)
