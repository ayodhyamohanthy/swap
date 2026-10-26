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
})
