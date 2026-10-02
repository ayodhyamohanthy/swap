import { expect, test } from '@playwright/test'
import { assertOnlyHydration, seed, trip, watchPage } from './support'

/* Home with trips — docs/04 A and the design-1a / 25a split. `/` is the one
   prerendered route, so it is also the one place where a hydration error is
   NEVER acceptable: the client must render exactly what the server wrote. */
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

  assertOnlyHydration(watch, 0)
})

/* Rule 11 — the positioning line ships in the shell, on every phone. */
test('the shell carries the not-an-official-service line', async ({ page }) => {
  await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  await page.goto('/')
  await expect(page.getByText('SeatSwap is not an official railway service.')).toBeVisible()
})
