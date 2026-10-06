// Registration and deploy over the agent socket (§43, convention §7.5,
// §7.6), with the window watching. Nothing is registered at launch: the
// agent registers `solver-gpu` itself, its first start finds nothing
// deployed and deploys, and a start made after its config changed — while
// that first run is still live — is refused by the check's CONFLICT.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export const seed = 'library-only'

function call(socket_path, method, route_path, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: socket_path,
        path: route_path,
        method,
        headers: { 'Content-Type': 'application/json' }
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (text += chunk))
        response.on('end', () => resolve({ status: response.statusCode, text }))
      }
    )
    request.on('error', reject)
    if (body !== undefined) {
      request.write(body)
    }
    request.end()
  })
}

function expect_status(answer, status, what) {
  if (answer.status !== status) {
    throw new Error(`${what}: expected ${status}, got ${answer.status} ${answer.text}`)
  }
}

export async function run({ page, shot, log, wait_text, library, socket_path }) {
  await wait_text('Explorer', 20_000)
  const folder = path.join(library, 'jobs/solver-gpu')

  // Registration takes the + path: the folder appears in the window.
  const registered = await call(
    socket_path,
    'POST',
    '/experiments',
    JSON.stringify({ path: folder })
  )
  log('POST /experiments →', registered.status, registered.text)
  expect_status(registered, 201, 'register')
  await page.locator('aside').getByText('solver-gpu').waitFor({ timeout: 10_000 })

  const again = await call(socket_path, 'POST', '/experiments', JSON.stringify({ path: folder }))
  log('POST /experiments again →', again.status, again.text)
  expect_status(again, 200, 'register again')
  const relative = await call(
    socket_path,
    'POST',
    '/experiments',
    JSON.stringify({ path: 'jobs/solver-gpu' })
  )
  log('POST /experiments relative →', relative.status, relative.text)
  expect_status(relative, 400, 'register relative')

  // Nothing deployed yet: the first start deploys before it launches.
  const started = await call(
    socket_path,
    'POST',
    '/experiments/solver-gpu/runs',
    JSON.stringify({ parameters: { nodes: '8', gpu: '1' } })
  )
  log('POST /experiments/solver-gpu/runs →', started.status, started.text)
  expect_status(started, 201, 'start')
  const detail = JSON.parse((await call(socket_path, 'GET', '/jobs/solver-gpu')).text)
  log('the run reads', detail.runs[0].status, 'deploy', JSON.stringify(detail.runs[0].deploy))
  if (detail.runs[0].status !== 'Deploying') {
    throw new Error(`expected Deploying, got ${detail.runs[0].status}`)
  }

  await page.locator('aside').getByText('solver-gpu').click()
  // A history row leads with the status dot alone; the run page spells it out.
  await page.locator('table tr', { hasText: '--gpu 1 --nodes 8' }).first().click()
  await wait_text('Deploying…', 5_000)
  await shot('run-deploying')

  // The run page's Deploy row, once the tick has collected the deploy —
  // not the check's reason, which may say "deployed" too.
  await page.locator('dd', { hasText: /^Deployed / }).waitFor({ timeout: 20_000 })
  await shot('run-deployed')
  const after = JSON.parse((await call(socket_path, 'GET', '/jobs/solver-gpu')).text)
  log('then', after.runs[0].status, 'deploy', JSON.stringify(after.runs[0].deploy))
  if (after.runs[0].deploy.at === null) {
    throw new Error('the page says deployed, the socket does not')
  }

  // A changed config while that run is live is the check's CONFLICT.
  fs.appendFileSync(path.join(folder, 'solver.cfg'), 'damping = 0.5\n')
  const refused = await call(
    socket_path,
    'POST',
    '/experiments/solver-gpu/runs',
    JSON.stringify({ parameters: { nodes: '8', gpu: '1' } })
  )
  log('start after the config changed →', refused.status, refused.text)
  expect_status(refused, 400, 'conflicting start')
  const runs = JSON.parse((await call(socket_path, 'GET', '/jobs/solver-gpu')).text).runs
  if (runs.length !== 1) {
    throw new Error(`a refused start left a run behind: ${runs.length} runs`)
  }
  log('registration, deploy and conflict all went through the socket')
}
