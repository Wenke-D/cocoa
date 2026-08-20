// The typed bridge: which main-process capabilities the page may call.
// The vocabulary of the event protocol: bootstrap once, then events.

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  bootstrap: (): Promise<unknown> => ipcRenderer.invoke('coco:bootstrap'),

  startRun: (name: string, parameters: Record<string, string>): Promise<unknown> =>
    ipcRenderer.invoke('coco:start', name, parameters),

  cancel: (target: unknown): Promise<unknown> => ipcRenderer.invoke('coco:cancel', target),

  addFolder: (): Promise<unknown> => ipcRenderer.invoke('coco:addFolder'),

  removeFolder: (entityId: string): Promise<unknown> =>
    ipcRenderer.invoke('coco:removeFolder', entityId),

  report: (target: unknown): Promise<unknown> => ipcRenderer.invoke('coco:report', target),

  refreshNow: (): Promise<unknown> => ipcRenderer.invoke('coco:refresh'),

  saveUi: (state: unknown): Promise<unknown> => ipcRenderer.invoke('coco:saveUi', state),

  /** What the application menu asked for; the window runs it the way a click
   *  would, so there is one path per operation and not two. */
  onCommand: (callback: (command: string) => void): (() => void) => {
    const listener = (_event: unknown, command: string): void => callback(command)
    ipcRenderer.on('coco:command', listener)
    return () => {
      ipcRenderer.removeListener('coco:command', listener)
    }
  },

  onEvents: (callback: (events: unknown) => void): (() => void) => {
    const listener = (_event: unknown, events: unknown): void => callback(events)
    ipcRenderer.on('coco:events', listener)
    return () => {
      ipcRenderer.removeListener('coco:events', listener)
    }
  }
}

contextBridge.exposeInMainWorld('coco', api)
