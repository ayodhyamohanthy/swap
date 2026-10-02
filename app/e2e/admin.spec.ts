import { expect, test } from '@playwright/test'
import { seed, trip } from './support'

/* docs/04 D + docs/05 A1–A6. The admin console is the one surface that must
   work at 1440 (desktop sidebar) while still not clipping at 360 — docs/05
   makes both viewports the definition of done, which is why this suite runs
   every file twice. */
test('admin overview renders its tiles and sidebar', async ({ page }) => {
  await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  await page.goto('/admin')

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('PNRs added today')).toBeVisible()
  await expect(page.getByText('Money in today')).toBeVisible()
  await expect(page.getByText('Counts come from this device until the backend is connected.')).toBeVisible()

  for (const item of ['Activity log', 'Users', 'Swaps', 'Payments', 'Credits', 'Reports']) {
    await expect(page.getByRole('link', { name: item, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'Back to the app' })).toBeVisible()

  /* No horizontal scroll at either viewport (docs/05: 360 → 1440). */
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1)
})

/* Growth extra (build-plan 13): the public train page, reachable signed out. */
test('the public train page is readable without a trip', async ({ page }) => {
  await seed(page)
  await page.goto('/train/12951')

  await expect(page.getByRole('heading', { name: 'Train 12951' })).toBeVisible()
  await expect(page.getByText('Add PNR to swap on this train')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add PNR to swap on this train' })).toBeVisible()
})
