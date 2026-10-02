# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pay.spec.ts >> the pay screen states ₹99 = ₹49 + ₹50 with no timer
- Location: e2e/pay.spec.ts:8:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/pay/req_1
Call log:
  - navigating to "http://127.0.0.1:4319/pay/req_1", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { offerRow, requestRow, seed, trip } from './support'
  3  | 
  4  | /* docs/04 A.9 — "Someone says yes → Pay ₹99 screen: breakdown ₹49 + ₹50".
  5  |    These strings are rules 1 and 2 in the browser: the price, the split, the
  6  |    credit line, and "no payment timer". A unit test reading lib/money cannot
  7  |    see that the screen failed to print them. */
  8  | test('the pay screen states ₹99 = ₹49 + ₹50 with no timer', async ({ page }) => {
  9  |   await seed(page, {
  10 |     trips: [
  11 |       trip({ id: 't_mine', pnr_last4: '9630' }),
  12 |       trip({
  13 |         id: 't_theirs',
  14 |         pnr_last4: '9648',
  15 |         open_to_swap: true,
  16 |         passengers: [
  17 |           { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  18 |         ],
  19 |       }),
  20 |     ],
  21 |     requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'accepted_awaiting_payment' })],
  22 |     offers: [offerRow({ id: 'off_1', request_id: 'req_1', acceptor_trip_id: 't_theirs' })],
  23 |   })
  24 | 
> 25 |   await page.goto('/pay/req_1')
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/pay/req_1
  26 |   await expect(page.getByText('Traveller said yes!')).toBeVisible()
  27 |   await expect(page.getByText('SeatSwap fee ₹49')).toBeVisible()
  28 |   await expect(page.getByText('Thank-you credit for Traveller ₹50')).toBeVisible()
  29 |   await expect(page.getByText('You pay ₹99')).toBeVisible()
  30 |   await expect(page.getByText('No swap? ₹99 goes to your credit')).toBeVisible()
  31 |   await expect(
  32 |     page.getByText('The swap locks once you pay. Until then, your other matches can still accept.'),
  33 |   ).toBeVisible()
  34 |   /* The CTA is `Button asChild` over a TanStack `Link`, so on the built bundle
  35 |      it is an <a> — asserting role "button" here would pass vacuously. */
  36 |   await expect(page.getByRole('link', { name: 'Pay ₹99' })).toBeVisible()
  37 | })
  38 | 
  39 | /* Rule 2 — once the swap is locked there is nothing left to pay, and the
  40 |    screen must say so rather than render a live "Pay ₹99" (L4's payGate work,
  41 |    now asserted through the DOM on the built bundle). */
  42 | test('a locked swap offers no Pay ₹99 button', async ({ page }) => {
  43 |   await seed(page, {
  44 |     trips: [
  45 |       trip({ id: 't_mine', pnr_last4: '9630' }),
  46 |       trip({
  47 |         id: 't_theirs',
  48 |         pnr_last4: '9648',
  49 |         open_to_swap: true,
  50 |         passengers: [
  51 |           { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  52 |         ],
  53 |       }),
  54 |     ],
  55 |     requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'locked', locked_offer_id: 'off_1' })],
  56 |     offers: [offerRow({ id: 'off_1', request_id: 'req_1', acceptor_trip_id: 't_theirs' })],
  57 |   })
  58 | 
  59 |   await page.goto('/pay/req_1')
  60 |   await expect(page.getByText('This swap is already paid for.')).toBeVisible()
  61 |   /* Both roles: the CTA renders as an <a> (see above), so a button-only check
  62 |      would miss a live "Pay ₹99" that had come back as a link. */
  63 |   await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0)
  64 |   await expect(page.getByRole('link', { name: /^Pay ₹/ })).toHaveCount(0)
  65 | })
  66 | 
  67 | /* Rule 2, the other side: before anyone accepts there is no charge at all. */
  68 | test('an unpaid request cannot be charged before acceptance', async ({ page }) => {
  69 |   await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  70 |   await page.goto('/pay/req_missing')
  71 |   await expect(page.getByText('Nobody has said yes yet. You pay ₹99 only after someone accepts.')).toBeVisible()
  72 |   await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0)
  73 |   await expect(page.getByRole('link', { name: /^Pay ₹/ })).toHaveCount(0)
  74 | })
  75 | 
```