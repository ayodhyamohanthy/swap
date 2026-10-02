import { expect, test } from '@playwright/test'
import { assertOnlyHydration, journeyDate, seed, watchPage } from './support'

/* docs/04 A.4 — Add PNR → "Your berth". Drives the real form on the built
   bundle: ids are the form's own (`#pnr`, `#train`, `#date`, `#coach-0`,
   `#berth-0`), so this exercises validation, `hashPnr`, the store write and the
   navigation — none of which any unit test does through the DOM. */
test('add a PNR and land on the Your berth card', async ({ page }) => {
  const watch = watchPage(page)
  await seed(page)

  await page.goto('/trips/add')
  await expect(page.getByRole('heading', { name: 'Add your PNR' })).toBeVisible()

  await page.locator('#pnr').fill('4512789630')
  await page.locator('#train').fill('12951')
  await page.locator('#date').fill(journeyDate())
  await page.locator('#coach-0').fill('B3')
  await page.locator('#berth-0').fill('27')
  await page.getByRole('button', { name: 'Find my berth' }).click()

  /* `uid()` is a uuid, so pin the shape rather than a value. */
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/)
  await expect(page.getByText('Your berth')).toBeVisible()
  await expect(page.getByText('Coach B3')).toBeVisible()
  await expect(page.getByText('Berth 27')).toBeVisible()
  await expect(page.getByText('PNR ends 9630')).toBeVisible()

  /* A deep link on the built app hydrates the prerendered home shell: exactly
     one documented hydration error, and nothing else (see support.ts). */
  assertOnlyHydration(watch, 1)
})

/* docs/04 A.4 — the PNR rule itself: "Check the 10 digits". */
test('a short PNR is refused before anything is written', async ({ page }) => {
  await seed(page)
  await page.goto('/trips/add')
  await page.locator('#pnr').fill('12345')
  await page.locator('#train').fill('12951')
  await page.locator('#date').fill(journeyDate())
  await page.getByRole('button', { name: 'Find my berth' }).click()
  await expect(page.getByText('Check the 10 digits')).toBeVisible()
  await expect(page).toHaveURL(/\/trips\/add/)
})
