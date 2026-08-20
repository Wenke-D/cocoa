// Cancel a bench run: one confirmation, several members stopped at once
// (specification §16.2).

export async function run({ page, shot, log, wait_text }) {
  await wait_text('nightly-benchmark', 20_000)
  await page.locator('aside').getByText('nightly-benchmark').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('label:has-text("sweep") input').fill('nightly')
  await page.locator('button[type="submit"]').click()

  await page.locator('button.cancel').waitFor({ timeout: 20_000 })
  // Wait until the dispatched runs have reached the cluster, or there is
  // nothing to cancel yet.
  await wait_text('Running', 25_000)
  log('bench header:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  await shot('bench-run')

  await page.locator('button.cancel').click()
  await page.locator('dialog').waitFor({ timeout: 5_000 })
  log('modal copy:', (await page.locator('dialog').innerText()).replace(/\n/g, ' | '))
  await shot('bench-confirm')

  await page.locator('dialog button.primary').click({ timeout: 10_000 })
  await page.locator('dialog').waitFor({ state: 'detached', timeout: 20_000 })
  await wait_text('Cancelling', 10_000)
  log('after confirm:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  await shot('bench-cancelling')

  await wait_text('Cancelled', 25_000)
  log('after poll:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  log('members:', (await page.locator('tbody').innerText()).replace(/\n/g, ' | '))
  await shot('bench-cancelled')
}
