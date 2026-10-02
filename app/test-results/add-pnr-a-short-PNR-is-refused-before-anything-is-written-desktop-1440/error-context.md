# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: add-pnr.spec.ts >> a short PNR is refused before anything is written
- Location: e2e/add-pnr.spec.ts:35:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/trips/add
Call log:
  - navigating to "http://127.0.0.1:4319/trips/add", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { assertOnlyHydration, journeyDate, seed, watchPage } from './support'
  3  | 
  4  | /* docs/04 A.4 — Add PNR → "Your berth". Drives the real form on the built
  5  |    bundle: ids are the form's own (`#pnr`, `#train`, `#date`, `#coach-0`,
  6  |    `#berth-0`), so this exercises validation, `hashPnr`, the store write and the
  7  |    navigation — none of which any unit test does through the DOM. */
  8  | test('add a PNR and land on the Your berth card', async ({ page }) => {
  9  |   const watch = watchPage(page)
  10 |   await seed(page)
  11 | 
  12 |   await page.goto('/trips/add')
  13 |   await expect(page.getByRole('heading', { name: 'Add your PNR' })).toBeVisible()
  14 | 
  15 |   await page.locator('#pnr').fill('4512789630')
  16 |   await page.locator('#train').fill('12951')
  17 |   await page.locator('#date').fill(journeyDate())
  18 |   await page.locator('#coach-0').fill('B3')
  19 |   await page.locator('#berth-0').fill('27')
  20 |   await page.getByRole('button', { name: 'Find my berth' }).click()
  21 | 
  22 |   /* `uid()` is a uuid, so pin the shape rather than a value. */
  23 |   await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/)
  24 |   await expect(page.getByText('Your berth')).toBeVisible()
  25 |   await expect(page.getByText('Coach B3')).toBeVisible()
  26 |   await expect(page.getByText('Berth 27')).toBeVisible()
  27 |   await expect(page.getByText('PNR ends 9630')).toBeVisible()
  28 | 
  29 |   /* A deep link on the built app hydrates the prerendered home shell: exactly
  30 |      one documented hydration error, and nothing else (see support.ts). */
  31 |   assertOnlyHydration(watch, 1)
  32 | })
  33 | 
  34 | /* docs/04 A.4 — the PNR rule itself: "Check the 10 digits". */
  35 | test('a short PNR is refused before anything is written', async ({ page }) => {
  36 |   await seed(page)
> 37 |   await page.goto('/trips/add')
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/trips/add
  38 |   await page.locator('#pnr').fill('12345')
  39 |   await page.locator('#train').fill('12951')
  40 |   await page.locator('#date').fill(journeyDate())
  41 |   await page.getByRole('button', { name: 'Find my berth' }).click()
  42 |   await expect(page.getByText('Check the 10 digits')).toBeVisible()
  43 |   await expect(page).toHaveURL(/\/trips\/add/)
  44 | })
  45 | 
```