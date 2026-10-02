import { expect, test } from '@playwright/test'
import { assertOnlyHydration, seed, trip, watchPage } from './support'

/* Home with trips — docs/04 A and the design-1a / 25a split. `/` is the one
   prerendered route, so a DIRECT load of it is where server markup and client
   render are compared.

   Measured on the built bundle (see support.ts): the prerender emits only
   React's redirect/suspense markers, so any `/` load that stays on Home —
   trips seeded or not — reports exactly ONE hydration error (#418), and zero
   would be the surprise. `assertOnlyHydration(watch, 1)` still fails every
   OTHER console error, and onboarding.spec.ts keeps the honest zero on the
   first-open path (which redirects before hydration). */
test('home lists my trips under exactly three tabs', async ({ page }) => {
  const watch = watchPage(page)
  await seed(page, {
    trips: [
      trip({ id: 't_mine', pnr_last4: '9630' }),
      trip({
        id: 't_theirs',
        pnr_last4: '9648',
        open_to_swap: true,
        passengers: [{ id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null }],
      }),
    ],
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible()
  await expect(page.getByText('12951').first()).toBeVisible()

  /* agents.md rule 12 — exactly 3 bottom tabs, named Home / Swaps / Profile. */
  const tabs = page.locator('nav[aria-label="SeatSwap"] a')
  await expect(tabs).toHaveCount(3)
  await expect(tabs).toHaveText(['Home', 'Swaps', 'Profile'])

  assertOnlyHydration(watch, 1)
})

/* Rule 11 — the positioning line ships in the shell, on every phone. Seeded
   EMPTY so the only console-error budget this run pays is the one documented
   direct-Home-load mismatch above — i.e. no trip data is what makes any
   OTHER error here unambiguously a shell bug. */
test('the shell carries the not-an-official-service line', async ({ page }) => {
  const watch = watchPage(page)
  await seed(page, { trips: [] })
  await page.goto('/')
  await expect(page.getByText('SeatSwap is not an official railway service.')).toBeVisible()
  assertOnlyHydration(watch, 1)
})
