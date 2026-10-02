import { expect, test } from '@playwright/test'
import { offerRow, requestRow, seed, trip } from './support'

const seeded = () => ({
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

/* docs/04 A12 + rule 13 — the offline ticket stub, with exact berth numbers
   revealed ONLY because the request is locked (paid). */
test('swap summary reveals both berths only after payment', async ({ page }) => {
  await seed(page, seeded())
  await page.goto('/swaps/req_1/summary')

  await expect(page.getByRole('heading', { name: 'Swap summary' })).toBeVisible()
  await expect(page.getByText('Works without network')).toBeVisible()
  await expect(page.getByText('Coach B6 · Berth 27 ↔ Berth 41')).toBeVisible()
  await expect(page.getByText('Keep your original ticket and ID with you.')).toBeVisible()
})

/* The same screen with a request that has NOT been paid: berths stay masked —
   rule 13 is a privacy property, not a formatting choice. */
test('berths stay masked until payment', async ({ page }) => {
  await seed(page, {
    ...seeded(),
    requests: [requestRow({ id: 'req_1', trip_id: 't_mine', status: 'accepted_awaiting_payment' })],
  })
  await page.goto('/swaps/req_1/summary')
  await expect(page.getByText('Berth ••').first()).toBeVisible()
  await expect(page.getByText(/Berth 27 ↔ Berth 41/)).toHaveCount(0)
  await expect(page.getByText(/41/)).toHaveCount(0)
})

/* docs/04 A12 "works offline" and docs/17 — go offline AFTER the screen has
   loaded and it must keep rendering from local state, with the offline bar. */
test('the summary keeps working with the network off', async ({ page, context }) => {
  await seed(page, seeded())
  await page.goto('/swaps/req_1/summary')
  await expect(page.getByRole('heading', { name: 'Swap summary' })).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText("You're offline. Your trips stay on this device.")).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Swap summary' })).toBeVisible()
  await expect(page.getByText('Coach B6 · Berth 27 ↔ Berth 41')).toBeVisible()
})
