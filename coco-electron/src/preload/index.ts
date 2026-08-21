// The typed bridge: which main-process capabilities the page may call.
// The vocabulary of the event protocol: bootstrap once, then events.

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  bootstrap: (): Promise<unknown> => ipcRenderer.invoke('coco:bootstrap'),

  start_run: (name: string, parameters: Record<string, string>): Promise<unknown> =>
    ipcRenderer.invoke('coco:start', name, parameters),

  cancel: (target: unknown): Promise<unknown> => ipcRenderer.invoke('coco:cancel', target),

  add_folder: (): Promise<unknown> => ipcRenderer.invoke('coco:add_folder'),

  remove_folder: (entity_id: string): Promise<unknown> =>
    ipcRenderer.invoke('coco:remove_folder', entity_id),

  report: (target: unknown): Promise<unknown> => ipcRenderer.invoke('coco:report', target),

  refresh_now: (): Promise<unknown> => ipcRenderer.invoke('coco:refresh'),

  on_events: (callback: (events: unknown) => void): (() => void) => {
    const listener = (_event: unknown, events: unknown): void => callback(events)
    ipcRenderer.on('coco:events', listener)
    return () => {
      ipcRenderer.removeListener('coco:events', listener)
    }
  }
}

contextBridge.exposeInMainWorld('coco', api)
