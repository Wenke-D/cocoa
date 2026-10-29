import fs from 'node:fs'
import path from 'node:path'

// A campaign call that did not succeed, run again in its place (§18.3,
// convention §8.5). One call's job fails it; then the job is fixed and gains
// a parameter — it changed after the call failed — and the row's Refill
// opens the job's Start page with the call's values, the new parameter
// empty. The run launched takes the call's place: its page lists both
// attempts, and the campaign's table says `attempt 2`.

// The breadcrumbs; the activity bar is a <nav> of its own.
const CRUMBS = 'nav:not([aria-label="Views"])'

export async function run({ page, shot, log, wait_text, library }) {
  // flaky-solver's cluster fails every run until the job is fixed below.
  const poll = path.join(library, 'jobs/flaky-solver/poll.py')
  const working_poll = fs.readFileSync(poll, 'utf8')
  fs.writeFileSync(poll, 'print("COCOA_RETURN: FAILED mock: solver diverged")\n')

  await wait_text('nightly-benchmark', 20_000)
  await page.locator('aside').getByText('nightly-benchmark').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-sweep').fill('nightly')
  await page.locator('button[type="submit"]').click()
  const rows = page.locator('table tbody tr')
  await rows.nth(2).waitFor({ timeout: 20_000 })
  const campaign_run_id = (await page.locator('header h1').innerText()).trim()

  // Call 2 is flaky-solver's run 0, as call 0 is solver-gpu's: run ids are
  // per job, and the page must still open the right one.
  await rows.nth(2).click()
  await page.locator('dl').waitFor({ timeout: 10_000 })
  const job_fact = await page.locator('button.job-link').innerText()
  log('call 2 opens:', job_fact.trim())
  if (!job_fact.includes('flaky-solver')) {
    throw new Error(`call 2 opened ${job_fact.trim()}, not flaky-solver's run`)
  }
  await page.locator('header', { hasText: 'Failed' }).waitFor({ timeout: 30_000 })

  // The job is fixed after the call failed, and takes a new parameter.
  fs.writeFileSync(poll, working_poll)
  fs.appendFileSync(
    path.join(library, 'jobs/flaky-solver/cocoa.toml'),
    '\n[[launch.params]]\nname        = "precision"\ntype        = "enum"\n' +
      'values      = ["single", "double"]\ndescription = "Floating-point precision"\n'
  )

  await page.locator(`${CRUMBS} button.crumb`).last().click()
  await rows.nth(2).waitFor({ timeout: 10_000 })
  await rows.nth(0).click({ button: 'right' })
  const succeeded_menu = page.getByRole('menu')
  await succeeded_menu.waitFor({ timeout: 5_000 })
  log('menu on call 0:', (await succeeded_menu.innerText()).replace(/\n/g, ' | '))
  await page.keyboard.press('Escape')

  await rows.nth(2).click({ button: 'right' })
  const menu = page.getByRole('menu')
  await menu.waitFor({ timeout: 5_000 })
  log('menu on call 2:', (await menu.innerText()).replace(/\n/g, ' | '))
  await shot('call-menu')

  // The changed manifest is read on the next tick; Refill reads it then.
  await page.waitForTimeout(4_000)
  await page.getByRole('menuitem', { name: 'Refill', exact: true }).click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  log('replacing:', await page.locator('p.replacing').innerText())
  log(
    'notice:',
    await page
      .locator('[role="status"]')
      .first()
      .innerText()
      .catch(() => '(none)')
  )
  await page.locator('#param-precision').waitFor({ timeout: 10_000 })
  log('nodes filled:', await page.locator('#param-nodes').inputValue())
  await shot('start-in-place')

  await page.locator('#param-precision').click()
  await page.getByRole('option', { name: 'double' }).click()
  await page.locator('button[type="submit"]').click()

  // The new run is the call now, seen in the campaign's context.
  await page.locator('dd.attempts').waitFor({ timeout: 20_000 })
  const attempts = (await page.locator('dd.attempts').innerText()).replace(/\n/g, ' ')
  log('attempts:', attempts)
  log('trail:', (await page.locator(CRUMBS).innerText()).replace(/\n/g, ' '))
  if (!(await page.locator(CRUMBS).innerText()).includes(campaign_run_id)) {
    throw new Error('the new run is not shown in its campaign run’s context')
  }
  await shot('new-attempt')

  await page.locator(`${CRUMBS} button.crumb`).last().click()
  await rows.nth(2).waitFor({ timeout: 10_000 })
  log('row:', (await rows.nth(2).innerText()).replace(/\s+/g, ' '))
  log('header:', (await page.locator('header').first().innerText()).replace(/\n/g, ' '))
  await shot('campaign-after')
}
