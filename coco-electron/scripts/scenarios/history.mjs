// The history's row menu (§22.6): a run's parameters used again — at once,
// and as a draft on the Start page.

export async function run({ page, shot, log, wait_text }) {
  await wait_text('solver-gpu', 20_000)
  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('label:has-text("nodes") input').fill('2')
  await page.locator('label:has-text("gpu") input').fill('0')
  await page.locator('button[type="submit"]').click()
  await page.locator('button.cancel').waitFor({ timeout: 15_000 })

  // Back on the overview, the history carries the parameters, last and widest.
  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('table.runs').waitFor({ timeout: 5_000 })
  log('history:', (await page.locator('table.runs').innerText()).replace(/\n/g, ' | '))
  await shot('history')

  // Start again: a new row, the same parameters, the page does not move.
  await page.locator('table.runs tbody tr').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Start over' }).click()
  await wait_text('Run 1 started', 15_000)
  await page.locator('table.runs tbody tr').nth(1).waitFor({ timeout: 5_000 })
  const rows = await page.locator('table.runs tbody tr').allInnerTexts()
  log('after start again:', rows.map((row) => row.replace(/\n/g, ' | ')).join(' // '))
  if (!rows.every((row) => row.includes('--gpu 0 --nodes 2'))) {
    throw new Error('the new run does not carry the same parameters')
  }
  await shot('started-again')

  // Start with…: the Start page, filled in.
  await page.locator('table.runs tbody tr').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Refill…' }).click()
  await page.locator('form').waitFor({ timeout: 5_000 })
  const nodes = await page.locator('label:has-text("nodes") input').inputValue()
  const gpu = await page.locator('label:has-text("gpu") input').inputValue()
  log('prefilled:', { nodes, gpu })
  if (nodes !== '2' || gpu !== '0') {
    throw new Error('the Start page was not filled from the run')
  }
  await wait_text('filled in', 5_000)
  await shot('prefilled')
}
