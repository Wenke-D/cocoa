// Start a mock run, cancel it, and watch the cluster confirm — the flow the
// cancel modal exists for (specification §16).

export async function run({ page, shot, log, wait_text }) {
  await wait_text('solver-gpu', 20_000)
  await shot('library')

  await page.locator('aside').getByText('solver-gpu').click()
  await page.locator('button.start').waitFor({ timeout: 10_000 })
  await shot('entity')

  await page.locator('button.start').click()
  await page.locator('form').waitFor({ timeout: 10_000 })
  await page.locator('label:has-text("nodes") input').fill('4')
  await page.locator('label:has-text("gpu") input').fill('0')
  await shot('start-form')

  await page.locator('button[type="submit"]').click()

  // The start page navigates to the new run's detail on success. Wait for
  // the run to actually reach the cluster: until the launch script is
  // harvested there is no submission to cancel, and the engine says so.
  await page.locator('button.cancel').waitFor({ timeout: 15_000 })
  await wait_text('Running', 20_000)
  const status = await page.locator('header').innerText()
  log('run detail header:', status.replace(/\n/g, ' | '))
  await shot('run-detail')

  await page.locator('button.cancel').click()
  await page.locator('[role="dialog"]').waitFor({ timeout: 5_000 })
  log('modal copy:', (await page.locator('[role="dialog"]').innerText()).replace(/\n/g, ' | '))
  await shot('confirm-modal')

  log(
    'dialog probe:',
    JSON.stringify(
      await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        const button = dialog?.querySelector('button.confirm')
        if (!dialog || !button) {
          return { dialog: Boolean(dialog), button: false }
        }
        const box = button.getBoundingClientRect()
        const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return {
          open: dialog.getAttribute('data-state'),
          label: button.textContent?.trim(),
          box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) },
          topmost: at?.tagName + '.' + at?.className
        }
      })
    )
  )
  await page.locator('[role="dialog"] button.confirm').click({ timeout: 10_000 })

  // The modal closes only when the backend answers, and the run must read
  // Cancelling — never Cancelled before the cluster confirms it (§16.3).
  await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 15_000 })
  await wait_text('Cancelling', 10_000)
  log('after confirm:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  await shot('cancelling')

  // The mock poll confirms the cancellation on its next pass.
  await wait_text('Cancelled', 20_000)
  log('after poll:', (await page.locator('header').innerText()).replace(/\n/g, ' | '))
  await shot('cancelled')
}
