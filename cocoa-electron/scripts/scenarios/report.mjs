import fs from 'node:fs'
import path from 'node:path'

// Open both kinds of report in the app: plain text with search, and HTML
// rendered in place (§20, with this form's divergence — no system browser).
// The mock writes both files, so the run shows one button for each (§17.5).

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

  await page.getByRole('button', { name: 'Plain text', exact: true }).click()
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
  const text_button = page.getByRole('button', { name: 'Plain text', exact: true })
  log(
    'report row:',
    (await page.locator('dd', { has: text_button }).innerText()).replace(/\n/g, ' | ')
  )
  await shot('run-text-only')
}
