// Cancel a campaign run: one confirmation, several members stopped at once
// (specification §16.2).

import http from 'node:http'

function get(socket_path, route_path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: socket_path, path: route_path }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => (text += chunk))
      response.on('end', () => resolve(JSON.parse(text)))
    })
    request.on('error', reject)
    request.end()
  })
}

/**
 * Until every member has launched. A member still deploying or launching has
 * no submission to cancel, and the cancel would rightly refuse it (convention
 * §7.4, §7.6); the first start of the library deploys solver-gpu first.
 */
async function members_launched(socket_path, log) {
  const deadline = Date.now() + 30_000
  for (;;) {
    const campaign = await get(socket_path, '/campaigns/nightly-benchmark')
    const calls = campaign.runs.at(-1)?.calls ?? []
    const statuses = []
    for (const call of calls) {
      const job = await get(socket_path, `/jobs/${encodeURIComponent(call.job)}`)
      statuses.push(job.runs.find((run) => run.id === call.run_id)?.status)
    }
    if (
      calls.length > 0 &&
      statuses.every((status) => !['Deploying', 'Starting'].includes(status))
    ) {
      log('members launched:', statuses.join(', '))
      return
    }
    if (Date.now() > deadline) {
      throw new Error(`members never all launched: ${statuses.join(', ')}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

export async function run({ page, shot, log, wait_text, socket_path }) {
  await wait_text('nightly-benchmark', 20_000)
  await page.locator('aside').getByText('nightly-benchmark').click()
  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('#param-sweep').fill('nightly')
  await page.locator('button[type="submit"]').click()

  await page.locator('button.cancel').waitFor({ timeout: 20_000 })
  await members_launched(socket_path, log)
  log('campaign header:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  await shot('campaign-run')

  await page.locator('button.cancel').click()
  await page.locator('[role="dialog"]').waitFor({ timeout: 5_000 })
  log('modal copy:', (await page.locator('[role="dialog"]').innerText()).replace(/\n/g, ' | '))
  await shot('campaign-confirm')

  await page.locator('[role="dialog"] button.confirm').click({ timeout: 10_000 })
  await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 20_000 })
  await wait_text('Cancelling', 10_000)
  log('after confirm:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  await shot('campaign-cancelling')

  await wait_text('Cancelled', 25_000)
  log('after poll:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  log('members:', (await page.locator('tbody').innerText()).replace(/\n/g, ' | '))
  await shot('campaign-cancelled')
}
