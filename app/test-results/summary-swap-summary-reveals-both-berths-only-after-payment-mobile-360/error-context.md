# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: summary.spec.ts >> swap summary reveals both berths only after payment
- Location: e2e/summary.spec.ts:22:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/swaps/req_1/summary
Call log:
  - navigating to "http://127.0.0.1:4319/swaps/req_1/summary", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { offerRow, requestRow, seed, trip } from './support'
  3  | 
  4  | const seeded = () => ({
  5  |   trips: [
  6  |     trip({ id: 't_mine', pnr_last4: '9630' }),
  7  |     trip({
  8  |       id: 't_theirs',
  9  |       pnr_last4: '9648',
  10 |       open_to_swap: true,
  11 |       passengers: [
  12 |         { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  13 |       ],
  14 |     }),
  15 |   ],
  16 |   requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'locked', locked_offer_id: 'off_1' })],
  17 |   offers: [offerRow({ id: 'off_1', request_id: 'req_1', acceptor_trip_id: 't_theirs' })],
  18 | })
  19 | 
  20 | /* docs/04 A12 + rule 13 — the offline ticket stub, with exact berth numbers
  21 |    revealed ONLY because the request is locked (paid). */
  22 | test('swap summary reveals both berths only after payment', async ({ page }) => {
  23 |   await seed(page, seeded())
> 24 |   await page.goto('/swaps/req_1/summary')
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/swaps/req_1/summary
  25 | 
  26 |   await expect(page.getByRole('heading', { name: 'Swap summary' })).toBeVisible()
  27 |   await expect(page.getByText('Works without network')).toBeVisible()
  28 |   await expect(page.getByText('Coach B6 · Berth 27 ↔ Berth 41')).toBeVisible()
  29 |   await expect(page.getByText('Keep your original ticket and ID with you.')).toBeVisible()
  30 | })
  31 | 
  32 | /* The same screen with a request that has NOT been paid: berths stay masked —
  33 |    rule 13 is a privacy property, not a formatting choice. */
  34 | test('berths stay masked until payment', async ({ page }) => {
  35 |   await seed(page, {
  36 |     ...seeded(),
  37 |     requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'accepted_awaiting_payment' })],
  38 |   })
  39 |   await page.goto('/swaps/req_1/summary')
  40 |   await expect(page.getByText('Berth ••').first()).toBeVisible()
  41 |   await expect(page.getByText(/Berth 27 ↔ Berth 41/)).toHaveCount(0)
  42 |   await expect(page.getByText(/41/)).toHaveCount(0)
  43 | })
  44 | 
  45 | /* docs/04 A12 "works offline" and docs/17 — go offline AFTER the screen has
  46 |    loaded and it must keep rendering from local state, with the offline bar. */
  47 | test('the summary keeps working with the network off', async ({ page, context }) => {
  48 |   await seed(page, seeded())
  49 |   await page.goto('/swaps/req_1/summary')
  50 |   await expect(page.getByRole('heading', { name: 'Swap summary' })).toBeVisible()
  51 | 
  52 |   await context.setOffline(true)
  53 |   await expect(page.getByText("You're offline. Your trips stay on this device.")).toBeVisible()
  54 |   await expect(page.getByRole('heading', { name: 'Swap summary' })).toBeVisible()
  55 |   await expect(page.getByText('Coach B6 · Berth 27 ↔ Berth 41')).toBeVisible()
  56 | })
  57 | 
```