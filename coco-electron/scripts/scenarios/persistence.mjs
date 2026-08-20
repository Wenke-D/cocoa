// What survives quitting. The arrangement is written by the renderer (route,
// sidebar width, report wrap) and by the main process (window geometry) into
// one file, and `sanitize` decides what a relaunch is allowed to restore —
// the route back, but never a report page and never a half-filled Start form.

import fs from 'node:fs'

export async function run({ page, shot, log, waitText, relaunch, uiStatePath }) {
  await waitText('solver-gpu', 20_000)

  // Somewhere worth coming back to, and a sidebar that is visibly not default.
  await page.locator('aside').getByText('nightly-benchmark').click()
  await page.locator('button.start').waitFor({ timeout: 10_000 })
  const divider = page.locator('.divider')
  const box = await divider.boundingBox()
  await page.mouse.move(box.x + 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(330, box.y + 200, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  await shot('arranged')

  const written = JSON.parse(fs.readFileSync(uiStatePath, 'utf8'))
  log('persisted:', JSON.stringify(written.route), 'sidebar', written.sidebarWidth)
  // An entity id is the folder it lives in, not its name.
  if (!String(written.route.entityId).endsWith('nightly-benchmark')) {
    throw new Error(`the route was not remembered: ${JSON.stringify(written.route)}`)
  }
  if (Math.abs(written.sidebarWidth - 330) > 4) {
    throw new Error(`the sidebar width was not remembered: ${written.sidebarWidth}`)
  }
  if (written.window === null) {
    throw new Error('the window geometry was not remembered')
  }

  ;({ page } = await relaunch())

  // Back where we were: the same experiment selected, the same sidebar.
  await page.locator('button.start').waitFor({ timeout: 20_000 })
  const width = await page.locator('aside').evaluate((node) => node.getBoundingClientRect().width)
  log('restored sidebar width:', width)
  if (Math.abs(width - 330) > 4) {
    throw new Error(`the sidebar came back at ${width}`)
  }
  const selected = await page.locator('aside .row.selected, aside li.selected').first().innerText()
  log('restored selection:', selected.trim())
  await shot('restored')

  // A Start page is a route, but its draft is not persisted — restoring it
  // would open an empty form nobody asked for, so it lands on the experiment.
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(600)
  // The file records what was true — a Start route. `sanitize` turns it into
  // the experiment on the way back in, not on the way out.
  const onStart = JSON.parse(fs.readFileSync(uiStatePath, 'utf8')).route
  log('persisted while on start:', JSON.stringify(onStart))
  if (onStart.page !== 'start') {
    throw new Error(`the file should record the Start page it was on: ${JSON.stringify(onStart)}`)
  }
  ;({ page } = await relaunch())

  await page.locator('button.start').waitFor({ timeout: 20_000 })
  if (await page.locator('form').isVisible()) {
    throw new Error('a relaunch reopened the Start page')
  }
  await shot('start-not-restored')
  log('the Start page became its experiment, as §15 asks')
}
