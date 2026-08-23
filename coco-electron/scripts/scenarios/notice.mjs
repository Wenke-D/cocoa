// A refresh that cannot run has nowhere else to report itself: no run row can
// carry "the poll script will not start", because the failure is that there is
// no answer. This drives the whole of step 6 — the error notice appears, it
// stays until it is dismissed, it is *not* said again on every three-second
// tick, and the status bar's own refresh answers even when all is well.

import fs from 'node:fs'
import path from 'node:path'

const BROKEN_POLL = `import sys
sys.stderr.write("qstat: command not found\\n")
sys.exit(1)
`

export async function run({ page, shot, log, wait_text, library }) {
  const poll = path.join(library, 'jobs/solver-gpu/poll.py')
  const healthy = fs.readFileSync(poll)

  const notice = page.locator('.notice')
  const error_notice = page.locator('.notice.error')

  await wait_text('solver-gpu', 20_000)
  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-nodes').fill('2')
  await page.locator('#param-gpu').fill('1')
  await page.locator('button[type="submit"]').click()

  // The poll can only fail once there is something to poll: a run whose
  // launch has been harvested, so the engine has a submission id to ask about.
  await page.locator('button.cancel').waitFor({ timeout: 15_000 })
  await wait_text('Running', 20_000)
  await shot('running')

  log('breaking the poll script')
  fs.writeFileSync(poll, BROKEN_POLL)

  await error_notice.waitFor({ timeout: 15_000 })
  const text = (await error_notice.innerText()).replace(/\n/g, ' | ')
  log('error notice:', text)
  if (!text.includes('poll.py')) {
    throw new Error(`the notice does not name the script that failed: ${text}`)
  }
  await shot('error-notice')

  // A failure does not fade: it is still there long after the four seconds an
  // ordinary message gets.
  await page.waitForTimeout(6_000)
  if (!(await error_notice.isVisible())) {
    throw new Error('the error notice faded; a failure must wait to be read')
  }

  await page.locator('.notice .dismiss').click()
  await notice.waitFor({ state: 'detached', timeout: 5_000 })
  await shot('dismissed')

  // The poll is still broken and the tick still runs, so without the gate in
  // `notices.ts` the same sentence would be back within three seconds.
  log('holding for two ticks with the poll still broken')
  await page.waitForTimeout(8_000)
  if (await notice.isVisible()) {
    const repeat = (await notice.innerText()).replace(/\n/g, ' | ')
    throw new Error(`the same failure was announced again: ${repeat}`)
  }
  log('the repeated failure stayed quiet')

  log('healing the poll script')
  fs.writeFileSync(poll, healthy)

  // The status bar's refresh always answers — a button that can do nothing
  // visible is a button you cannot tell is working.
  await page.locator('button.refresh').click()
  await wait_text('Refreshed.', 10_000)
  log('manual refresh:', (await notice.innerText()).trim())
  await shot('refreshed')

  // And the run the broken poll had left Unknown finds its way home.
  await wait_text('Succeeded', 30_000)
  await shot('succeeded')
}
