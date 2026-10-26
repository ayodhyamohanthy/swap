/* docs/17 W6.1, first slice: the "add PNR" segment of the docs/04 flow,
   at the two W6.1 viewports. Runs keyless against the built static app —
   no backend, no gateway, the local-first path exactly as a traveller sees
   it. Console errors fail the test: a flow that renders but logs is broken. */
import { expect, test, type Page } from '@playwright/test'

const PNR = '4512789630'
const SUBMIT = 'Find my berth' // locales/en.json `first.find`

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

/* First run opens two one-time gates: language, then the note. Every
   traveller (and every test) walks through both before the Home pitch. */
async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

test.describe('W6.1 slice: add PNR from Home', () => {
  test('an invalid PNR shows the error and stays on Home', async ({ page }) => {
    const errors = collectErrors(page)
    await openHome(page)
    await expect(page.locator('#home-pnr')).toBeVisible()
    await page.fill('#home-pnr', '12345')
    await page.getByRole('button', { name: SUBMIT }).click()
    await expect(page.getByText('Check the 10 digits')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    expect(errors).toEqual([])
  })

  test('a valid 10-digit PNR stages and lands on /trips/add prefilled', async ({ page }) => {
    const errors = collectErrors(page)
    await openHome(page)
    await page.fill('#home-pnr', PNR)
    await page.getByRole('button', { name: SUBMIT }).click()
    await expect(page).toHaveURL(/\/trips\/add/)
    /* The staged digits must reach the add form: stagePnr is the handoff
       between the two screens, and a reload starts blank, so this asserts
       the one hop that carries them. */
    await expect(page.locator('#pnr')).toHaveValue(PNR)
    expect(errors).toEqual([])
  })
  test('a completed trip form saves and lands on the trip detail', async ({ page }) => {
    const errors = collectErrors(page)
    await openHome(page)
    await page.fill('#home-pnr', PNR)
    await page.getByRole('button', { name: SUBMIT }).click()
    await expect(page).toHaveURL(/\/trips\/add/)
    /* Only PNR, train and date are required; from/to and the passenger row
       carry defaults, so the minimal honest form is what this fills. */
    await page.fill('#train', '12951')
    await page.fill('#date', '2026-11-05')
    await page.fill('#from', 'BCT')
    await page.fill('#to', 'NDLS')
    await page.getByRole('button', { name: SUBMIT }).click()
    await expect(page).toHaveURL(/\/trips\/(?!add)/)
    await expect(page.getByText('PNR ends 9630')).toBeVisible()
    expect(errors).toEqual([])
  })
  test('a CNF trip can ask for a swap end to end', async ({ page }) => {
    const errors = collectErrors(page)
    await openHome(page)
    await page.fill('#home-pnr', PNR)
    await page.getByRole('button', { name: SUBMIT }).click()
    /* The manual form defaults to class SL and status CNF, so this trip is
       open to swap and the swaps screen offers the request CTA. */
    await page.fill('#train', '12951')
    await page.fill('#date', '2026-11-05')
    await page.getByRole('button', { name: SUBMIT }).click()
    await expect(page).toHaveURL(/\/trips\/(?!add)/)
    /* Both CTAs render Button asChild + Link, so both are role=link. */
    await page.getByRole('link', { name: 'Ask for a swap' }).click()
    await expect(page).toHaveURL(/\/swaps/)
    await page.getByRole('link', { name: 'Ask for a swap' }).click()
    await expect(page).toHaveURL(/\/request\/new/)
    /* An empty form is stopped at the first-choice chip, not sent. */
    await page.getByRole('button', { name: 'See matches' }).click()
    await expect(page.getByText('Pick at least your 1st choice.')).toBeVisible()
    await page.getByRole('button', { name: 'Lower' }).first().click()
    await page.getByRole('button', { name: 'See matches' }).click()
    await expect(page).toHaveURL(/\/request\/[^/]+\/matches/)
    await expect(page.getByText('Request saved. Sending is free.')).toBeVisible()
    expect(errors).toEqual([])
  })
})
