// What survives quitting — and what deliberately does not. The renderer keeps
// its layout (sidebar width, divider, report wrap) in localStorage, written
// once as the page unloads; the main process keeps the window's geometry in
// `window-state.json`. Where the user *was* survives nothing: every launch
// opens on the Explorer with no experiment selected (§32) — a day later
// nobody remembers where they were, and the page that helps is the list.

import fs from 'node:fs'

/** The renderer's stored arrangement, as the page it runs in sees it. */
async function stored_ui(page) {
  const text = await page.evaluate(() => window.localStorage.getItem('ui-state'))
  return text === null ? null : JSON.parse(text)
}

export async function run({ page, shot, log, wait_text, relaunch, window_state_path }) {
  await wait_text('solver-gpu', 20_000)

  // Somewhere specific, and a sidebar that is visibly not default.
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

  // The layout came back; the place did not get written at all.
  const written = await stored_ui(page)
  log('persisted:', JSON.stringify(written))
  if ('route' in written) {
    throw new Error(`a route reached storage: ${JSON.stringify(written.route)}`)
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

  // The Explorer, nothing selected, the empty page — with the tuned sidebar.
  await wait_text('solver-gpu', 20_000)
  const width = await page.locator('aside').evaluate((node) => node.getBoundingClientRect().width)
  log('restored sidebar width:', width)
  if (Math.abs(width - 330) > 4) {
    throw new Error(`the sidebar came back at ${width}`)
  }
  const selected = await page.locator('aside .row.selected').count()
  if (selected !== 0) {
    throw new Error('a launch restored a selection; it must open with none')
  }
  const prompt = await page.getByText('Select an experiment in the Explorer to begin.').isVisible()
  if (!prompt) {
    throw new Error('a launch did not open on the empty page')
  }
  await shot('opened-empty')
  log('layout restored, place forgotten, as §32 asks')
}
