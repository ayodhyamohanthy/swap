import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seed, trip } from './support'

/* Each rank is a Card whose second paragraph is the helper line
   ("Pick a berth for 1st choice") and whose ChipRow holds that rank's berth
   buttons — so scoping from that paragraph to its parent is what keeps the
   click inside ONE rank's chips instead of matching the first "Upper" on the
   page (the rank label itself is a paragraph, not a heading). */
function rankCard(page: Page, rank: string) {
  return page.getByText(`Pick a berth for ${rank}`, { exact: true }).locator('..')
}

/* The match pool is THIS device's own trips (`lib/requests.ts localPool`), so
   "one trip" is the honest way to reproduce the zero-match state — the same
   reason the app itself shows "You're the first". */
test('zero matches shows You are the first, not an empty list', async ({ page }) => {
  await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })

  await page.goto('/request/new')
  await expect(page.getByRole('heading', { name: 'What would you like?' })).toBeVisible()

  await rankCard(page, '1st choice').getByRole('button', { name: 'Upper' }).click()
  await page.getByRole('button', { name: 'See matches' }).click()

  await expect(page).toHaveURL(/\/request\/req_[^/]+\/matches$/)
  await expect(page.getByText("You're the first on 12951")).toBeVisible()
  await expect(page.getByText('Share this link so others on your train can join.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share coach link' })).toBeVisible()
})

/* A second open trip on the same train/date/class with a berth that is one of
   the ranked choices is a real match — same filters the ranking rules apply
   (`rankMatches`), fed through the UI instead of the store API. */
test('a matching open trip offers Send to 1 · free, and sending is free', async ({
  page,
}) => {
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
  })

  await page.goto('/request/new')
  await rankCard(page, '1st choice').getByRole('button', { name: 'Upper' }).click()
  await page.getByRole('button', { name: 'See matches' }).click()

  await expect(page.getByRole('button', { name: 'Send to 1 · free' })).toBeVisible()
  await page.getByRole('button', { name: 'Send to 1 · free' }).click()

  /* signin_asked is seeded as seen, so rule 8 does not interrupt: sending goes
     straight through and costs nothing (rules 1–2: free until someone accepts). */
  await expect(page).toHaveURL(/\/request\/req_[^/]+\/matches$/)
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Searching').first()).toBeVisible()
})

/* Rule 8 in the browser: the FIRST send asks for sign-in, and only Google. */
test('the first send asks for sign-in before sending', async ({ page }) => {
  await seed(page, {
    seen: { signin_asked: false },
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
  })

  await page.goto('/request/new')
  await rankCard(page, '1st choice').getByRole('button', { name: 'Upper' }).click()
  await page.getByRole('button', { name: 'See matches' }).click()
  await page.getByRole('button', { name: 'Send to 1 · free' }).click()

  await expect(page).toHaveURL(/\/signin\?redirect=/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  /* Rule 8: Google only — no phone, no OTP, no password anywhere on the screen. */
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByText(/OTP|password|phone number/i)).toHaveCount(0)
  await expect(page.getByText('Not now')).toBeVisible()
})

/* docs/04 B — the acceptor side is seeded as one open trip, and the device
   models a stand-in incoming request for it ("Priya"). */
test('an open trip shows the ₹99 rules before anyone accepts', async ({ page }) => {
  await seed(page, {
    trips: [trip({ id: 't_open', pnr_last4: '9648', open_to_swap: true })],
  })
  await page.goto('/swaps')
  await expect(page.getByRole('heading', { name: 'Swaps' })).toBeVisible()
  await expect(page.getByText('SeatSwap fee ₹49')).toBeVisible()
  await expect(page.getByText('₹99 for one swap')).toBeVisible()
  await expect(page.getByText('You pay only after someone accepts. No payment timer.')).toBeVisible()
  await expect(page.getByText('Credit lowers future SeatSwap fees. Never cash, never transferable. Valid 12 months.')).toBeVisible()
  /* Rule 3 — the acceptor never pays. */
  await expect(page.getByText('The other traveller pays nothing and earns ₹50 credit when the swap is done.')).toBeVisible()
})
