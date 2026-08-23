// The activity bar's views and the status bar's last change: what happened,
// in sentences, and when the world last moved (§8.2, §8.5, §11.1).

export async function run({ page, shot, log, wait_text }) {
  await wait_text('solver-gpu', 20_000)

  // Nothing has happened yet: the journal is empty at launch.
  await page.getByRole('button', { name: 'Events' }).click()
  await wait_text('Nothing has happened yet', 5_000)
  await shot('events-empty')

  await page.getByRole('button', { name: 'Explorer' }).click()
  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-nodes').fill('2')
  await page.locator('#param-gpu').fill('0')
  await page.locator('button[type="submit"]').click()
  await page.locator('button.cancel').waitFor({ timeout: 15_000 })

  // The journal has the start, and soon the first status move.
  await page.getByRole('button', { name: 'Events' }).click()
  await wait_text('started by you', 5_000)
  await page.locator('aside').getByText('Running').first().waitFor({ timeout: 20_000 })
  log('events:', (await page.locator('aside').innerText()).replace(/\n/g, ' | '))
  await shot('events')

  // The status bar names the moment of the last change, not the tick.
  const bar = (await page.locator('footer').innerText()).replace(/\n/g, ' | ')
  log('status bar:', bar)
  if (!/last change \d\d:\d\d:\d\d/.test(bar)) {
    throw new Error('the status bar does not name the last change')
  }

  // Active Runs lists the run once, with its badge on the activity bar.
  await page.getByRole('button', { name: 'Active Runs' }).click()
  await page.locator('aside').getByText('solver-gpu').waitFor({ timeout: 5_000 })
  log('active runs:', (await page.locator('aside').innerText()).replace(/\n/g, ' | '))
  log('badge:', await page.locator('nav .badge').innerText())
  await shot('active-runs')

  // Clicking the open view collapses the sidebar (§8.2).
  await page.getByRole('button', { name: 'Active Runs' }).click()
  await page.locator('aside').waitFor({ state: 'detached', timeout: 5_000 })
  log('sidebar collapsed')
  await shot('collapsed')

  // An entry is a link to its run.
  await page.getByRole('button', { name: 'Events' }).click()
  await page.locator('aside').getByText('started by you').click()
  await page.locator('button.cancel').waitFor({ timeout: 5_000 })
  log('an entry led to the run:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
}
