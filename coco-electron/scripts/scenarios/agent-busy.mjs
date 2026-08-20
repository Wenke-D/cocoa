// A second coco must not take the socket the first one is answering on: two
// owners of one store is the situation §43's design exists to avoid. The
// window still runs — without an interface — and says so.
//
// The stand-in "first coco" is bound here, at module load, which the driver
// does before it launches the app.

import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

const SOCKET = process.env.COCO_SOCKET_PATH ?? path.join(process.cwd(), '.drive/coco.sock')
fs.mkdirSync(path.dirname(SOCKET), { recursive: true })
fs.rmSync(SOCKET, { force: true })
const squatter = net.createServer(() => {})
squatter.listen(SOCKET)

export async function run({ page, shot, log, waitText }) {
  await waitText('solver-gpu', 20_000)

  // The refusal is a notice, not a crash — and it is not lost to a window that
  // was still loading when the socket was refused.
  const notice = page.locator('.notice.error')
  await notice.waitFor({ timeout: 15_000 })
  const text = (await notice.innerText()).replace(/\n/g, ' ')
  log('notice:', text)
  if (!text.includes('already answering')) {
    throw new Error(`the refusal does not explain itself: ${text}`)
  }
  await shot('agent-interface-refused')

  // The workbench itself is unaffected: the Explorer is there and pages open.
  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('button.start').waitFor({ timeout: 10_000 })
  log('the window works without an interface')

  squatter.close()
  fs.rmSync(SOCKET, { force: true })
}
