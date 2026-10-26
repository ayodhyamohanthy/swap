/* docs/17 W6.1: the sign-in gate on the first send (rule 8). The first
   send must route through /signin?redirect=…, "Not now" must return to
   the matches screen without unlocking the send, and the next send must
   route through the gate again. Self-contained on purpose: a second trip
   on the same train (opened to swap) plays the candidate, so no backend
   is needed. */
import { expect, test, type Page } from '@playwright/test'

const PNR_A = '4512789630'
const PNR_B = '4512789631'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

async function addTrip(page: Page, pnr: string) {
  await page.goto('/')
  /* Empty home takes the PNR inline; once trips exist it shows the list
     and the add form lives behind its "Add PNR" link. */
  const homePnr = page.locator('#home-pnr')
  if ((await homePnr.count()) > 0) {
    await homePnr.fill(pnr)
    await page.getByRole('button', { name: 'Find my berth' }).first().click()
  } else {
    await page.getByRole('link', { name: 'Add PNR' }).click()
    await page.fill('#pnr', pnr)
  }
  await expect(page).toHaveURL(/\/trips\/add/)
  await page.fill('#train', '12951')
  await page.fill('#date', '2026-11-05')
  await page.getByRole('button', { name: 'Find my berth' }).click()
  await expect(page).toHaveURL(/\/trips\/[^/]+$/)
}

test('first send routes through the sign-in gate and Not now keeps it closed', async ({ page }) => {
  const errors = collectErrors(page)
  await openHome(page)

  /* Trip A: add the PNR, create a swap request for a lower berth. */
  await addTrip(page, PNR_A)
  await page.getByRole('link', { name: 'Ask for a swap' }).click()
  await expect(page).toHaveURL(/\/swaps/)
  await page.getByRole('link', { name: 'Ask for a swap' }).click()
  await expect(page).toHaveURL(/\/request\/new/)
  await page.getByText('Lower').first().click()
  await page.getByRole('button', { name: 'See matches' }).click()
  await expect(page).toHaveURL(/\/request\/[^/]+\/matches/)
  const matchesUrl = page.url()

  /* No candidate yet, so there is nothing to send. */
  await expect(page.getByRole('button', { name: /Send to/ })).toHaveCount(0)

  /* Trip B on the same train and date, opened to swap: it becomes the
     device-local candidate the matches screen ranks. */
  await addTrip(page, PNR_B)
  await page.getByRole('switch', { name: "I'm open to swap" }).click()

  await page.goto(matchesUrl)
  const send = page.getByRole('button', { name: /Send to/ })
  await expect(send).toBeVisible()

  /* Rule 8: the first send asks for sign-in first, aimed back here. */
  await send.click()
  await expect(page).toHaveURL(/\/signin\?/)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(new URL(matchesUrl).pathname)

  /* "Not now" returns without unlocking the send. */
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page).toHaveURL(matchesUrl)

  /* The gate is still closed: the next send routes through sign-in again. */
  await page.getByRole('button', { name: /Send to/ }).click()
  await expect(page).toHaveURL(/\/signin\?/)
  expect(errors).toEqual([])
})
