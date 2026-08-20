// What survives quitting. The arrangement lives in two places now: the
// renderer keeps route, sidebar width and report wrap in its own
// localStorage, and the main process keeps the window's geometry in
// `window-state.json`. `sanitize` decides what a relaunch is allowed to
// restore — the route back, but never a report page and never a half-filled
// Start form.
//
// localStorage is written once, as the page unloads, so every assertion
// about the renderer's half is made after a relaunch, reading what the
// closing page wrote.

import fs from 'node:fs'

/** The renderer's stored arrangement, as the page it runs in sees it. */
async function stored_ui(page) {
  const text = await page.evaluate(() => window.localStorage.getItem('ui-state'))
  return text === null ? null : JSON.parse(text)
}

export async function run({ page, shot, log, wait_text, relaunch, window_state_path }) {
  await wait_text('solver-gpu', 20_000)

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

  // Arranging does not reach storage: what is stored now is still whatever
  // was there before this session touched anything — nothing, on a fresh
  // profile.
  const mid_session = await stored_ui(page)
  log('mid-session storage:', JSON.stringify(mid_session))
  if (mid_session !== null && Math.abs(mid_session.sidebar_width - 330) < 4) {
    throw new Error('the arrangement reached storage before the page unloaded')
  }

  ;({ page } = await relaunch())

  const written = await stored_ui(page)
  log('persisted:', JSON.stringify(written.route), 'sidebar', written.sidebar_width)
  // An entity id is the folder it lives in, not its name.
  if (!String(written.route.entity_id).endsWith('nightly-benchmark')) {
    throw new Error(`the route was not remembered: ${JSON.stringify(written.route)}`)
  }
  if (Math.abs(written.sidebar_width - 330) > 4) {
    throw new Error(`the sidebar width was not remembered: ${written.sidebar_width}`)
  }

  // The main process's half: the geometry file the closing window wrote.
  const window_state = JSON.parse(fs.readFileSync(window_state_path, 'utf8'))
  log('window state:', JSON.stringify(window_state))
  if (typeof window_state.size?.width !== 'number') {
    throw new Error('the window geometry was not remembered')
  }

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
  ;({ page } = await relaunch())

  // Storage records what was true — a Start route. `sanitize` turns it into
  // the experiment on the way back in, not on the way out.
  const on_start = (await stored_ui(page)).route
  log('persisted while on start:', JSON.stringify(on_start))
  if (on_start.page !== 'start') {
    throw new Error(`storage should record the Start page it was on: ${JSON.stringify(on_start)}`)
  }

  await page.locator('button.start').waitFor({ timeout: 20_000 })
  if (await page.locator('form').isVisible()) {
    throw new Error('a relaunch reopened the Start page')
  }
  await shot('start-not-restored')
  log('the Start page became its experiment, as §15 asks')
}
