# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.ts >> the shell carries the not-an-official-service line
- Location: e2e/home.spec.ts:44:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/
Call log:
  - navigating to "http://127.0.0.1:4319/", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { assertOnlyHydration, seed, trip, watchPage } from './support'
  3  | 
  4  | /* Home with trips — docs/04 A and the design-1a / 25a split. `/` is the one
  5  |    prerendered route, so a DIRECT load of it is where server markup and client
  6  |    render are compared.
  7  | 
  8  |    Measured on the built bundle (see support.ts): the prerender emits only
  9  |    React's redirect/suspense markers, so any `/` load that stays on Home —
  10 |    trips seeded or not — reports exactly ONE hydration error (#418), and zero
  11 |    would be the surprise. `assertOnlyHydration(watch, 1)` still fails every
  12 |    OTHER console error, and onboarding.spec.ts keeps the honest zero on the
  13 |    first-open path (which redirects before hydration). */
  14 | test('home lists my trips under exactly three tabs', async ({ page }) => {
  15 |   const watch = watchPage(page)
  16 |   await seed(page, {
  17 |     trips: [
  18 |       trip({ id: 't_mine', pnr_last4: '9630' }),
  19 |       trip({
  20 |         id: 't_theirs',
  21 |         pnr_last4: '9648',
  22 |         open_to_swap: true,
  23 |         passengers: [{ id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null }],
  24 |       }),
  25 |     ],
  26 |   })
  27 | 
  28 |   await page.goto('/')
  29 |   await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible()
  30 |   await expect(page.getByText('12951').first()).toBeVisible()
  31 | 
  32 |   /* agents.md rule 12 — exactly 3 bottom tabs, named Home / Swaps / Profile. */
  33 |   const tabs = page.locator('nav[aria-label="SeatSwap"] a')
  34 |   await expect(tabs).toHaveCount(3)
  35 |   await expect(tabs).toHaveText(['Home', 'Swaps', 'Profile'])
  36 | 
  37 |   assertOnlyHydration(watch, 1)
  38 | })
  39 | 
  40 | /* Rule 11 — the positioning line ships in the shell, on every phone. Seeded
  41 |    EMPTY so the only console-error budget this run pays is the one documented
  42 |    direct-Home-load mismatch above — i.e. no trip data is what makes any
  43 |    OTHER error here unambiguously a shell bug. */
  44 | test('the shell carries the not-an-official-service line', async ({ page }) => {
  45 |   const watch = watchPage(page)
  46 |   await seed(page, { trips: [] })
> 47 |   await page.goto('/')
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/
  48 |   await expect(page.getByText('SeatSwap is not an official railway service.')).toBeVisible()
  49 |   assertOnlyHydration(watch, 1)
  50 | })
  51 | 
```