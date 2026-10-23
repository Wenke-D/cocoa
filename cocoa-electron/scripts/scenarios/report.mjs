import fs from 'node:fs'
import path from 'node:path'

// Open both kinds of report in the app: plain text with search, and HTML
// rendered in place (§20, with this form's divergence — no system browser).
// The mock writes both files, so the run offers a choice: `Text` and `HTML`
// (§17.5). With one file left, it is a single `View report`.

export async function run({ page, shot, log, wait_text, library }) {
  await wait_text('solver-gpu', 20_000)
  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-nodes').fill('8')
  await page.locator('#param-gpu').fill('0')
  await page.locator('button[type="submit"]').click()

  // The mock completes at 15 s and the tick reports it right after.
  await wait_text('Succeeded', 40_000)
  const html_button = page.getByRole('button', { name: 'HTML', exact: true })
  await html_button.waitFor({ timeout: 10_000 })
  log(
    'report row:',
    (await page.locator('dd', { has: html_button }).innerText()).replace(/\n/g, ' | ')
  )
  await shot('run-succeeded')

  // The mock also attaches its status history (convention §7.3); the button
  // opens the file manager, which is not driven here.
  const attachments = page.getByRole('button', { name: 'Attachments', exact: true })
  log('attachments:', await attachments.getAttribute('title'))
  log(
    'attached:',
    fs.readdirSync(path.join(library, 'jobs/solver-gpu/runs/0/report/attachment')).join(', ')
  )

  // The mock's viewer opens a browser, which is not driven here: a stand-in
  // records what it was given (convention §7.7), then one that fails shows
  // the notice a broken viewer gets.
  const solver = path.join(library, 'jobs/solver-gpu')
  const viewer = path.join(solver, 'visualize.py')
  const visualized = path.join(solver, 'visualized')
  fs.writeFileSync(
    viewer,
    `import sys\nopen(${JSON.stringify(visualized)}, "w").write(" ".join(sys.argv[1:]))\n`
  )
  const visualize = page.getByRole('button', { name: 'Visualize', exact: true })
  log('visualize:', await visualize.getAttribute('title'))
  await shot('run-visualize')
  await visualize.click()
  for (let waited = 0; !fs.existsSync(visualized) && waited < 10_000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  log('visualized with:', fs.readFileSync(visualized, 'utf8'))
  fs.writeFileSync(viewer, 'import sys\nsys.exit("no display to open")\n')
  await visualize.click()
  await wait_text('no display to open', 10_000)
  log('viewer failure notice shown')
  await shot('visualize-failed')

  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.locator('pre.body').waitFor({ timeout: 10_000 })
  log('report head:', (await page.locator('pre.body').innerText()).split('\n')[0])
  log('header:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  await shot('report-text')

  // Search counts matches (§20.2).
  await page.locator('input[type="search"]').fill('params')
  log('search:', await page.locator('.count').innerText())
  await shot('report-search')

  await page.locator('input[type="search"]').fill('')
  await page.getByRole('button', { name: 'Copy' }).click()
  await wait_text('Report copied.', 5_000)
  log('copy notice shown')

  // Now the HTML report the same mock also wrote: its own button, back on
  // the run's page
  await page.locator('nav button.crumb').nth(1).click()
  await html_button.click()
  await page.locator('iframe.rendered').waitFor({ timeout: 10_000 })
  log('header:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))

  const framed = page.frameLocator('iframe.rendered')
  log('rendered body:', (await framed.locator('body').innerText()).split('\n')[0])
  await shot('report-html')

  // A report must never be able to reach the app it is displayed in.
  log(
    'frame reach:',
    await framed.locator('body').evaluate(() => ({
      has_cocoa: typeof window.cocoa !== 'undefined',
      same_origin: (() => {
        try {
          return window.parent.location.href.length > 0
        } catch {
          return false
        }
      })()
    }))
  )

  // The source is still one click away, so search and copy work on HTML too.
  await page.getByRole('button', { name: 'Source' }).click()
  await page.locator('pre.body').waitFor({ timeout: 5_000 })
  log('source head:', (await page.locator('pre.body').innerText()).slice(0, 60))
  await shot('report-html-source')

  // With the HTML file gone, the next tick re-reads the folder: one button
  fs.rmSync(path.join(library, 'jobs/solver-gpu/report/0.html'))
  await page.locator('nav button.crumb').nth(1).click()
  await html_button.waitFor({ state: 'detached', timeout: 15_000 })
  const text_button = page.getByRole('button', { name: 'View report', exact: true })
  log(
    'report row:',
    (await page.locator('dd', { has: text_button }).innerText()).replace(/\n/g, ' | ')
  )
  await shot('run-text-only')
}
