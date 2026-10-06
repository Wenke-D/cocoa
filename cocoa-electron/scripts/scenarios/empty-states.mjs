// The empty page's three states (§12), photographed. Launched with
// COCOA_BOOTSTRAP_DELAY_MS so the Starting state exists long enough to see;
// then the daily state over the seeded library; then a relaunch against an
// emptied store for the no-experiments state.

import fs from 'node:fs'
import path from 'node:path'

export async function run({ page, shot, log, wait_text, relaunch }) {
  // 1. Starting: the bootstrap answer is held by the delay.
  await page.getByText('Reading registered experiment folders').waitFor({ timeout: 10_000 })
  await shot('empty-1-starting')
  log('starting state captured')

  // 2. The daily state: experiments registered, none selected.
  await wait_text('solver-gpu', 20_000)
  await page.getByText('Select an experiment in the Explorer').waitFor({ timeout: 10_000 })
  await shot('empty-3-experiments')
  log('daily state captured:', await page.locator('.glance').innerText())

  // 3. Nothing registered: empty the store and come back up.
  const store_path = process.env.COCOA_STORE_PATH ?? path.join('.drive', 'store.json')
  fs.writeFileSync(store_path, JSON.stringify({ jobs: [], campaigns: [] }))
  ;({ page } = await relaunch())
  await page.getByText('No experiments are registered').waitFor({ timeout: 20_000 })
  await shot('empty-2-no-experiments')
  log('no-experiments state captured')
}
