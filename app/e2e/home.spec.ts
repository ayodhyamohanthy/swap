import { expect, test } from '@playwright/test'
import { assertOnlyHydration, seed, trip, watchPage } from './support'

/* Home with trips — docs/04 A and the design-1a / 25a split. `/` is the one
   prerendered route, so it is the one place where the client is checked
   against what the server actually wrote.

   The seed is written before first paint and the prerendered HTML was built
   with an EMPTY store (a server has no localStorage), so the trips branch can
   never be in the server's markup: React reports exactly ONE documented
   hydration mismatch (#418, caught by support.ts's budget), and zero would
   mean the client silently ignored the seeded trips. Every OTHER console
   error still fails. The empty-state `/` runs below keep the honest zero. */
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
   EMPTY so this run matches the prerendered Home exactly: it is the suite's
   proof that `/` with state the server could have written costs ZERO console
   errors (the trips test above pays the one documented #418 for its seed). */
test('the shell carries the not-an-official-service line', async ({ page }) => {
  const watch = watchPage(page)
  await seed(page, { trips: [] })
  await page.goto('/')
  await expect(page.getByText('SeatSwap is not an official railway service.')).toBeVisible()
  assertOnlyHydration(watch, 0)
})
