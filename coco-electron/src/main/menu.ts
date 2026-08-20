// The application menu, and with it the keyboard (§8 is silent on menus —
// egui has none — so this is the Electron shell's own chrome).
//
// Two rules shape it. Every item that *does* something to the workbench sends
// its command to the renderer rather than reaching into the engine here: the
// menu must go the way a click goes, or there would be two ways to add a
// folder and only one of them would navigate afterwards. And the Edit menu is
// not decoration — without it, Cmd+C in a parameter field does nothing on
// macOS, because those roles are what wire the clipboard up.

import { BrowserWindow, Menu, app } from 'electron'

/** What a menu item asks the window to do. Mirrors what the buttons call. */
export type MenuCommand = 'addFolder' | 'refresh'

function tell(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('coco:command', command)
}

export function buildMenu(): void {
  const mac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          // The id is how a drive scenario reaches this item: an accelerator
          // is handled natively, above the page, so a synthesised keystroke
          // never gets near it.
          id: 'add-folder',
          label: 'Add Experiment Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => tell('addFolder')
        },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Roles, not handlers: this is what makes the clipboard work in the
    // Start page's fields and in the report viewer's selection.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          id: 'refresh-now',
          label: 'Refresh Now',
          accelerator: 'CmdOrCtrl+R',
          click: () => tell('refresh')
        },
        { type: 'separator' },
        // Reloading the page is a developer's action here, not a user's — the
        // engine is in the main process and survives it — so it keeps the
        // second-class accelerator and Cmd+R means "ask the cluster".
        { role: 'forceReload', accelerator: 'Shift+CmdOrCtrl+R' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: mac
        ? [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' }
          ]
        : [{ role: 'minimize' }, { role: 'close' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
