// The application menu (step 9). Every item that does something to the
// workbench goes through the window, so a menu pick and a click are the same
// operation — including what happens *after* it, which is the part a menu
// wired straight into the main process would lose.
//
// Accelerators are handled natively, above the page, so a synthesised
// keystroke never reaches them; the items are clicked by id instead, which is
// the same code path the accelerator runs.

import path from 'node:path'

async function clickMenu(app, id) {
  await app.evaluate(async ({ Menu }, wanted) => {
    const find = (items) => {
      for (const item of items) {
        if (item.id === wanted) return item
        const found = item.submenu ? find(item.submenu.items) : null
        if (found !== null) return found
      }
      return null
    }
    const item = find(Menu.getApplicationMenu().items)
    if (item === null) throw new Error(`no menu item ${wanted}`)
    item.click()
  }, id)
}

export async function run({ app, page, shot, log, waitText, library }) {
  await waitText('solver-gpu', 20_000)

  const labels = await app.evaluate(async ({ Menu }) =>
    Menu.getApplicationMenu().items.map((item) => item.label || item.role)
  )
  log('menu:', labels.join(' · '))
  for (const expected of ['File', 'Edit', 'View', 'Window']) {
    if (!labels.includes(expected)) throw new Error(`the menu has no ${expected}: ${labels}`)
  }

  // Refresh Now: the same manual refresh the status bar's button asks for,
  // which always answers.
  await clickMenu(app, 'refresh-now')
  await waitText('Refreshed.', 10_000)
  log('View → Refresh Now said:', (await page.locator('.notice').innerText()).trim())
  await shot('refreshed-from-the-menu')

  // Add Experiment Folder…: the picker is native, so it is stubbed in the
  // main process; what matters here is that the menu's add navigates to the
  // folder it added, exactly as the Explorer's `+` does.
  const folder = path.join(library, 'jobs/failing-solver')
  await app.evaluate(async ({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })
  }, folder)

  await clickMenu(app, 'add-folder')
  await page.locator('button.start').waitFor({ timeout: 10_000 })
  const selected = await page.locator('aside .selected').first().innerText()
  log('after File → Add Experiment Folder…:', selected.trim())
  if (!selected.includes('failing-solver')) {
    throw new Error(`the menu's add did not land on the folder it added: ${selected}`)
  }
  await shot('added-from-the-menu')
}
