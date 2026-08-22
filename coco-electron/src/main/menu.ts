// The application menu, cut to what the platform needs. The workbench
// commands are gone for now — the buttons are the only path — but macOS wires
// the clipboard through menu roles, so an Edit menu must exist for Cmd+C to
// work in a parameter field, and Quit lives in the app menu. The other
// platforms handle both without a menu, so they get none at all.

import { Menu, app } from 'electron'
import { launch } from './launch'

/**
 * Setup the workbench menu for macOS.
 * Do nothing for Windows and Linux
 */
export function build_menu(): void {
  if (!launch.is_mac) {
    Menu.setApplicationMenu(null)
    return
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
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
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
