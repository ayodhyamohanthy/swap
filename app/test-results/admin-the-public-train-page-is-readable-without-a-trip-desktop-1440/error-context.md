# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin.spec.ts >> the public train page is readable without a trip
- Location: e2e/admin.spec.ts:30:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/train/12951
Call log:
  - navigating to "http://127.0.0.1:4319/train/12951", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { seed, trip } from './support'
  3  | 
  4  | /* docs/04 D + docs/05 A1–A6. The admin console is the one surface that must
  5  |    work at 1440 (desktop sidebar) while still not clipping at 360 — docs/05
  6  |    makes both viewports the definition of done, which is why this suite runs
  7  |    every file twice. */
  8  | test('admin overview renders its tiles and sidebar', async ({ page }) => {
  9  |   await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  10 |   await page.goto('/admin')
  11 | 
  12 |   await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  13 |   await expect(page.getByText('PNRs added today')).toBeVisible()
  14 |   await expect(page.getByText('Money in today')).toBeVisible()
  15 |   await expect(page.getByText('Counts come from this device until the backend is connected.')).toBeVisible()
  16 | 
  17 |   for (const item of ['Activity log', 'Users', 'Swaps', 'Payments', 'Credits', 'Reports']) {
  18 |     await expect(page.getByRole('link', { name: item, exact: true })).toBeVisible()
  19 |   }
  20 |   await expect(page.getByRole('link', { name: 'Back to the app' })).toBeVisible()
  21 | 
  22 |   /* No horizontal scroll at either viewport (docs/05: 360 → 1440). */
  23 |   const overflow = await page.evaluate(
  24 |     () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  25 |   )
  26 |   expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1)
  27 | })
  28 | 
  29 | /* Growth extra (build-plan 13): the public train page, reachable signed out. */
  30 | test('the public train page is readable without a trip', async ({ page }) => {
  31 |   await seed(page)
> 32 |   await page.goto('/train/12951')
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/train/12951
  33 | 
  34 |   await expect(page.getByRole('heading', { name: 'Train 12951' })).toBeVisible()
  35 |   await expect(page.getByText('Add PNR to swap on this train')).toBeVisible()
  36 |   await expect(page.getByRole('link', { name: 'Add PNR to swap on this train' })).toBeVisible()
  37 | })
  38 | 
```