// One run, two addresses (§2.3.1). A dispatched run opened from the bench's
// plan keeps the bench selected in the Explorer, carries a trail back to the
// bench run, names its call, and reads its report — which lives in the job's
// folder — under the bench's breadcrumbs (§19, §20.1). Asking for the job by
// name is the one move that hands the Explorer over.

export async function run({ page, shot, log, wait_text }) {
  await wait_text('nightly-benchmark', 20_000)
  await page.locator('aside').getByText('nightly-benchmark').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-sweep').fill('nightly')
  await page.locator('button[type="submit"]').click()

  // The bench run detail lists what it dispatched.
  await page.locator('table tbody tr').first().waitFor({ timeout: 20_000 })
  const bench_run_id = (await page.locator('header h1').innerText()).trim()
  log(
    'bench run:',
    bench_run_id,
    '·',
    (await page.locator('table').innerText()).replace(/\n/g, ' | ')
  )
  await shot('bench-run')

  await page.locator('table tbody tr').nth(1).click()
  await page.locator('dl').waitFor({ timeout: 10_000 })

  const trail = (await page.locator('nav').innerText()).replace(/\n/g, ' ')
  log('breadcrumbs:', trail)
  if (!trail.includes(bench_run_id)) {
    throw new Error(`the trail does not lead back to the bench run: ${trail}`)
  }
  if (!/call \d/.test(trail)) {
    throw new Error(`the leaf does not say which call this is: ${trail}`)
  }

  const facts = (await page.locator('dl').innerText()).replace(/\n/g, ' | ')
  log('facts:', facts)
  if (!facts.includes('Call')) {
    throw new Error('the call index is missing from the facts')
  }

  // The Explorer must still be on the bench, not on the job that ran it.
  const selected = await page.locator('aside .selected').first().innerText()
  log('explorer selection:', selected.trim())
  if (!selected.includes('nightly-benchmark')) {
    throw new Error(`arriving through the bench moved the Explorer to ${selected.trim()}`)
  }
  await shot('child-in-bench-context')

  // Wait for this call to finish, then read its report from here: the file is
  // in the job's folder, the breadcrumbs are the bench's.
  await wait_text('View report', 60_000)
  await page.locator('button.link', { has_text: 'View report' }).click()
  await page.locator('.body, iframe').first().waitFor({ timeout: 15_000 })
  const report_trail = (await page.locator('nav').innerText()).replace(/\n/g, ' ')
  log('report breadcrumbs:', report_trail)
  if (!report_trail.includes(bench_run_id)) {
    throw new Error(`the report lost the bench context: ${report_trail}`)
  }
  const report_selection = await page.locator('aside .selected').first().innerText()
  if (!report_selection.includes('nightly-benchmark')) {
    throw new Error(`the report moved the Explorer to ${report_selection.trim()}`)
  }
  await shot('report-in-bench-context')

  // Back to the child page, then follow the job by name — the explicit move
  // that is allowed to hand the Explorer over.
  await page.locator('nav button.crumb').last().click()
  await page.locator('dl').waitFor({ timeout: 10_000 })
  await page.locator('button.job-link').click()
  await page.locator('button.start').waitFor({ timeout: 10_000 })
  const after_job = await page.locator('aside .selected').first().innerText()
  log('after following the job:', after_job.trim())
  if (after_job.includes('nightly-benchmark')) {
    throw new Error('following the job name did not move the Explorer')
  }
  await shot('followed-the-job')
}
