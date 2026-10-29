// A campaign's report regenerated at both depths (§17.5, convention §8.3).
// `Regenerate` is a split button: its face is the campaign's report alone; its
// menu adds every member's report first, which asks (§16.5) and then counts
// the members down in the Report row before the campaign's own lands.

export async function run({ page, shot, log, wait_text }) {
  await wait_text('nightly-benchmark', 20_000)
  await page.locator('aside').getByText('nightly-benchmark').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-sweep').fill('nightly')
  await page.locator('button[type="submit"]').click()
  await page.locator('table tbody tr').first().waitFor({ timeout: 20_000 })

  // The face is there once the campaign's own report has run.
  const face = page.getByRole('button', { name: 'Regenerate', exact: true })
  await face.waitFor({ timeout: 120_000 })
  const chevron = page.getByRole('button', { name: 'Choose what to regenerate' })
  await chevron.waitFor({ timeout: 5_000 })
  log('header:', (await page.locator('header').first().innerText()).replace(/\n/g, ' '))
  await shot('split-button')

  await chevron.click()
  const menu = page.getByRole('menu')
  await menu.waitFor({ timeout: 5_000 })
  log('menu:', (await menu.innerText()).replace(/\n/g, ' | '))
  await shot('split-menu')

  await page.getByRole('menuitem', { name: /Members, then campaign/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 5_000 })
  log('modal:', (await dialog.innerText()).replace(/\n/g, ' | '))
  await shot('confirm-members')

  await dialog.getByRole('button', { name: 'Regenerate All' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  const row = page.locator('dd', { hasText: /Regenerating member reports|being generated/ })
  await row.waitFor({ timeout: 10_000 })
  log('row while waiting:', (await row.innerText()).trim())
  await shot('members-regenerating')

  // Back to a report: the split button returns when the campaign's lands.
  await face.waitFor({ timeout: 120_000 })
  log('header after:', (await page.locator('header').first().innerText()).replace(/\n/g, ' '))
  await shot('regenerated')
}
