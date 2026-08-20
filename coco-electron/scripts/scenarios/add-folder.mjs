// Add a folder through the Explorer's `+` (§11.5, minus the scan: one pick,
// one folder).
//
// The picker is a native modal, which Playwright cannot drive. It is stubbed
// in the *main process* instead — the product code keeps its real dialog and
// has no test-only path through it.

import path from 'node:path'

/** Makes the next folder pick answer with `folder`, or cancel if null. */
async function pick(app, folder) {
  await app.evaluate(async ({ dialog }, chosen) => {
    dialog.showOpenDialog = async () =>
      chosen === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [chosen] }
  }, folder)
}

/** Nothing registered at launch: this scenario adds the folders itself. */
export const seed = 'library-only'

export async function run({ app, page, shot, log, waitText, library }) {
  await waitText('No jobs or benches have been added', 20_000)
  await shot('empty')

  // Cancelling the picker does nothing at all.
  await pick(app, null)
  await page.locator('main button.primary').click()
  await page.waitForTimeout(500)
  log('after cancel:', (await page.locator('main').innerText()).split('\n')[0])

  await pick(app, path.join(library, 'jobs/solver-gpu'))
  await page.locator('main button.primary').click()
  await waitText('solver-gpu', 10_000)
  log('after add:', (await page.locator('aside').innerText()).replace(/\n/g, ' | '))
  log('landed on:', (await page.locator('main h1').innerText()))
  await shot('added')

  // Picking the same folder again is a no-op, not a duplicate.
  await page.locator('aside button.add').click()
  await waitText('already in the Explorer', 10_000)
  log('second pick:', (await page.locator('aside').innerText()).replace(/\n/g, ' | '))

  // The picked folder is the pick: `mock/` itself holds no manifest, so it is
  // refused rather than adding everything beneath it.
  await pick(app, library)
  await page.locator('aside button.add').click()
  await waitText('no coco.toml', 10_000)
  log('picked the library root:', (await page.locator('.notice').innerText()))
  await shot('refused')

  await pick(app, path.join(library, 'benches/nightly-benchmark'))
  await page.locator('aside button.add').click()
  await waitText('nightly-benchmark', 10_000)
  log('explorer:', (await page.locator('aside').innerText()).replace(/\n/g, ' | '))
  await shot('two-folders')
}
