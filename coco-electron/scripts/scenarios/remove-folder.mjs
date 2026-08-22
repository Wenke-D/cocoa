/** Only solver-gpu registered, so removing it empties the Explorer. */
export const seed = ['jobs/solver-gpu']

// Right-click an experiment and take it out of the Explorer (§36: removed
// from the Explorer, never deleted from disk).

import fs from 'node:fs'
import path from 'node:path'

export async function run({ page, shot, log, wait_text, library }) {
  await wait_text('solver-gpu', 20_000)

  // Start a run first, so the modal has to say what happens to it.
  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('label:has-text("nodes") input').fill('2')
  await page.locator('label:has-text("gpu") input').fill('0')
  await page.locator('button[type="submit"]').click()
  await page.locator('button.cancel').waitFor({ timeout: 15_000 })

  // The Explorer dot and the status bar count come from different places —
  // the run index and the run map. When only one of them lights up, the index
  // has stopped notifying, which no state test in this repo can see.
  const dots = await page.locator('aside .active-dot').count()
  log('active dot:', dots)
  if (dots !== 1) {
    throw new Error(`expected the Explorer to show one active run, saw ${dots}`)
  }

  await page.locator('aside').getByText('solver-gpu').click({ button: 'right' })
  await page.locator('[role="menu"]').waitFor({ timeout: 5_000 })
  log('menu:', await page.locator('[role="menu"]').innerText())
  await shot('context-menu')

  await page.getByRole('menuitem', { name: 'Remove from Explorer' }).click()
  await page.locator('[role="dialog"]').waitFor({ timeout: 5_000 })
  log('modal:', (await page.locator('[role="dialog"]').innerText()).replace(/\n/g, ' | '))
  await shot('confirm-remove')

  // Escape dismisses it, and nothing happens.
  await page.keyboard.press('Escape')
  await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 5_000 })
  log('after escape:', (await page.locator('aside').innerText()).replace(/\n/g, ' | '))

  await page.locator('aside').getByText('solver-gpu').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove from Explorer' }).click()
  await page.locator('[role="dialog"] button.confirm').click({ timeout: 10_000 })
  await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 15_000 })
  await wait_text('No jobs or benches have been added', 10_000)
  log('after remove:', (await page.locator('aside').innerText()).replace(/\n/g, ' | '))
  // The confirmation lands with the answer, a moment after the events do.
  await wait_text('Removed from the Explorer', 10_000)
  log('notice:', await page.locator('.notice').innerText())
  await shot('removed')

  // The folder is exactly where it was, run record and all.
  const folder = path.join(library, 'jobs/solver-gpu')
  log(
    'on disk:',
    JSON.stringify({
      manifest: fs.existsSync(path.join(folder, 'coco.toml')),
      run: fs.existsSync(path.join(folder, 'runs/0/run.json'))
    })
  )
}
