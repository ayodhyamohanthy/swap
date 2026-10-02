# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pay.spec.ts >> the pay screen states ₹99 = ₹49 + ₹50 with no timer
- Location: e2e/pay.spec.ts:8:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Pay ₹99' })
Expected: visible
Timeout: 7000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'Pay ₹99' }) with timeout 7000ms
  - waiting for getByRole('button', { name: 'Pay ₹99' })

```

```yaml
- banner:
  - link "Back":
    - /url: /
  - text: SeatSwap
- main:
  - heading "Traveller said yes!" [level=1]
  - paragraph: Complete payment to confirm the swap.
  - text: You give Lower You get Upper
  - term: SeatSwap fee ₹49
  - definition: ₹49
  - term: Thank-you credit for Traveller ₹50
  - definition: ₹50
  - term: To pay ₹99
  - definition: ₹99
  - paragraph: The swap locks once you pay. Until then, your other matches can still accept.
  - text: You pay ₹99 No swap? ₹99 goes to your credit
  - link "Pay ₹99":
    - /url: /pay/req_1/method?useCredit=1
  - paragraph: Keep your original ticket and ID with you.
  - paragraph: SeatSwap is not an official railway service.
- navigation "SeatSwap":
  - link "Home":
    - /url: /
  - link "Swaps, 1 new":
    - /url: /swaps
    - text: Swaps
  - link "Profile":
    - /url: /profile
- status
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
  25 |   await page.goto('/pay/req_1')
  26 |   await expect(page.getByText('Traveller said yes!')).toBeVisible()
  27 |   await expect(page.getByText('SeatSwap fee ₹49')).toBeVisible()
  28 |   await expect(page.getByText('Thank-you credit for Traveller ₹50')).toBeVisible()
  29 |   await expect(page.getByText('You pay ₹99')).toBeVisible()
  30 |   await expect(page.getByText('No swap? ₹99 goes to your credit')).toBeVisible()
  31 |   await expect(
  32 |     page.getByText('The swap locks once you pay. Until then, your other matches can still accept.'),
  33 |   ).toBeVisible()
> 34 |   await expect(page.getByRole('button', { name: 'Pay ₹99' })).toBeVisible()
     |                                                               ^ Error: expect(locator).toBeVisible() failed
  35 | })
  36 | 
  37 | /* Rule 2 — once the swap is locked there is nothing left to pay, and the
  38 |    screen must say so rather than render a live "Pay ₹99" (L4's payGate work,
  39 |    now asserted through the DOM on the built bundle). */
  40 | test('a locked swap offers no Pay ₹99 button', async ({ page }) => {
  41 |   await seed(page, {
  42 |     trips: [
  43 |       trip({ id: 't_mine', pnr_last4: '9630' }),
  44 |       trip({
  45 |         id: 't_theirs',
  46 |         pnr_last4: '9648',
  47 |         open_to_swap: true,
  48 |         passengers: [
  49 |           { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  50 |         ],
  51 |       }),
  52 |     ],
  53 |     requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'locked', locked_offer_id: 'off_1' })],
  54 |     offers: [offerRow({ id: 'off_1', request_id: 'req_1', acceptor_trip_id: 't_theirs' })],
  55 |   })
  56 | 
  57 |   await page.goto('/pay/req_1')
  58 |   await expect(page.getByText('This swap is already paid for.')).toBeVisible()
  59 |   await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0)
  60 | })
  61 | 
  62 | /* Rule 2, the other side: before anyone accepts there is no charge at all. */
  63 | test('an unpaid request cannot be charged before acceptance', async ({ page }) => {
  64 |   await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  65 |   await page.goto('/pay/req_missing')
  66 |   await expect(page.getByText('Nobody has said yes yet. You pay ₹99 only after someone accepts.')).toBeVisible()
  67 |   await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0)
  68 | })
  69 | 
```