import { expect, test } from '@playwright/test'
import { offerRow, requestRow, seed, trip } from './support'

/* docs/04 A.9 — "Someone says yes → Pay ₹99 screen: breakdown ₹49 + ₹50".
   These strings are rules 1 and 2 in the browser: the price, the split, the
   credit line, and "no payment timer". A unit test reading lib/money cannot
   see that the screen failed to print them. */
test('the pay screen states ₹99 = ₹49 + ₹50 with no timer', async ({ page }) => {
  await seed(page, {
    trips: [
      trip({ id: 't_mine', pnr_last4: '9630' }),
      trip({
        id: 't_theirs',
        pnr_last4: '9648',
        open_to_swap: true,
        passengers: [
          { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
        ],
      }),
    ],
    requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'accepted_awaiting_payment' })],
    offers: [offerRow({ id: 'off_1', request_id: 'req_1', acceptor_trip_id: 't_theirs' })],
  })

  await page.goto('/pay/req_1')
  await expect(page.getByText('Traveller said yes!')).toBeVisible()
  await expect(page.getByText('SeatSwap fee ₹49')).toBeVisible()
  await expect(page.getByText('Thank-you credit for Traveller ₹50')).toBeVisible()
  await expect(page.getByText('You pay ₹99')).toBeVisible()
  await expect(page.getByText('No swap? ₹99 goes to your credit')).toBeVisible()
  await expect(
    page.getByText('The swap locks once you pay. Until then, your other matches can still accept.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pay ₹99' })).toBeVisible()
})

/* Rule 2 — once the swap is locked there is nothing left to pay, and the
   screen must say so rather than render a live "Pay ₹99" (L4's payGate work,
   now asserted through the DOM on the built bundle). */
test('a locked swap offers no Pay ₹99 button', async ({ page }) => {
  await seed(page, {
    trips: [
      trip({ id: 't_mine', pnr_last4: '9630' }),
      trip({
        id: 't_theirs',
        pnr_last4: '9648',
        open_to_swap: true,
        passengers: [
          { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
        ],
      }),
    ],
    requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'locked', locked_offer_id: 'off_1' })],
    offers: [offerRow({ id: 'off_1', request_id: 'req_1', acceptor_trip_id: 't_theirs' })],
  })

  await page.goto('/pay/req_1')
  await expect(page.getByText('This swap is already paid for.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0)
})

/* Rule 2, the other side: before anyone accepts there is no charge at all. */
test('an unpaid request cannot be charged before acceptance', async ({ page }) => {
  await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  await page.goto('/pay/req_missing')
  await expect(page.getByText('Nobody has said yes yet. You pay ₹99 only after someone accepts.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Pay ₹/ })).toHaveCount(0)
})
