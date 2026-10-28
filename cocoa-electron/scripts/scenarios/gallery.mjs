// Every page once, in both schemes: the screens to look at after a change to
// the palette or a page's layout (ui-system.md, "Drawing a new screen").
// Nothing is asserted beyond getting there.

/** Shoots the window as it is, light then dark. */
async function both(page, shot, name) {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(150)
  await shot(`${name}-light`)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(150)
  await shot(`${name}-dark`)
  await page.emulateMedia({ colorScheme: null })
}

async function open(page, name) {
  await page.locator('aside').getByText(name, { exact: true }).click()
}

async function start(page, name, fill) {
  await open(page, name)
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await fill()
  await page.locator('button[type="submit"]').click()
  await page.locator('header h1').waitFor({ timeout: 15_000 })
}

async function choose(page, id, value) {
  await page.locator(`#${id}`).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}

export async function run({ page, shot, wait_text }) {
  await wait_text('solver-gpu', 20_000)
  await both(page, shot, 'empty')

  await open(page, 'solver-gpu')
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-nodes').fill('8')
  await page.locator('#param-gpu').fill('0')
  await both(page, shot, 'start')
  await page.locator('button[type="submit"]').click()
  await page.locator('button.cancel').waitFor({ timeout: 15_000 })
  await both(page, shot, 'job-run-active')

  await start(page, 'failing-solver', async () => {
    await page.locator('#param-nodes').fill('4')
    await choose(page, 'param-mode', 'fail')
    await choose(page, 'param-profile', 'false')
    await page.locator('#param-tags').fill('gallery')
  })
  await start(page, 'solver-gpu', async () => {
    await page.locator('#param-nodes').fill('16')
    await page.locator('#param-gpu').fill('1')
  })
  await start(page, 'nightly-benchmark', async () => {
    await page.locator('#param-sweep').fill('nightly')
  })
  await page.locator('table tbody tr').first().waitFor({ timeout: 20_000 })
  await both(page, shot, 'campaign-run-active')

  await page.getByRole('button', { name: 'Active Runs' }).click()
  await both(page, shot, 'active-runs')
  await page.getByRole('button', { name: 'Explorer' }).click()

  // The first solver run finishes at about 15 s, the failing one at 8.
  await open(page, 'solver-gpu')
  await page.locator('table.runs tbody tr').last().click()
  await wait_text('Succeeded', 60_000)
  await page.getByRole('button', { name: 'HTML', exact: true }).waitFor({ timeout: 20_000 })
  await both(page, shot, 'job-run-succeeded')

  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.locator('.body').waitFor({ timeout: 15_000 })
  await page.locator('input[type="search"]').fill('residual')
  await both(page, shot, 'report-text')

  await open(page, 'failing-solver')
  await page.locator('table.runs tbody tr').first().click()
  await wait_text('Failed', 60_000)
  await both(page, shot, 'job-run-failed')

  await open(page, 'nightly-benchmark')
  await page.locator('table.runs tbody tr').first().click()
  await page.locator('table tbody tr').nth(1).click()
  await page.locator('dl').waitFor({ timeout: 10_000 })
  await both(page, shot, 'campaign-child')

  await page.getByRole('button', { name: 'Events' }).click()
  await both(page, shot, 'events')
  await page.getByRole('button', { name: 'Explorer' }).click()

  await open(page, 'solver-gpu')
  await page.locator('table.runs').waitFor({ timeout: 5_000 })
  await both(page, shot, 'job-overview')

  await open(page, 'nightly-benchmark')
  await page.locator('table.runs').waitFor({ timeout: 5_000 })
  await both(page, shot, 'campaign-overview')
}
