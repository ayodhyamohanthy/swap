# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: request.spec.ts >> an open trip shows the ₹99 rules before anyone accepts
- Location: e2e/request.spec.ts:99:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/swaps
Call log:
  - navigating to "http://127.0.0.1:4319/swaps", waiting until "load"

```

# Test source

```ts
  3   | import { seed, trip } from './support'
  4   | 
  5   | /* Each rank is a Card whose helper paragraph ("Pick a berth for 1st choice")
  6   |    sits directly above that rank's own ChipRow, so scoping from that paragraph
  7   |    to its parent keeps the click inside ONE rank's cards. `exact: true` is
  8   |    required on the chip: "Upper" is a substring of "Side upper", so an
  9   |    inexact accessible-name match resolves to two buttons even inside a single
  10  |    card. */
  11  | function rankCard(page: Page, rank: string) {
  12  |   return page.getByText(`Pick a berth for ${rank}`, { exact: true }).locator('..')
  13  | }
  14  | 
  15  | /* The match pool is THIS device's own trips (`lib/requests.ts localPool`), so
  16  |    "one trip" is the honest way to reproduce the zero-match state — the same
  17  |    reason the app itself shows "You're the first". */
  18  | test('zero matches shows You are the first, not an empty list', async ({ page }) => {
  19  |   await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  20  | 
  21  |   await page.goto('/request/new')
  22  |   await expect(page.getByRole('heading', { name: 'What would you like?' })).toBeVisible()
  23  | 
  24  |   await rankCard(page, '1st choice').getByRole('button', { name: 'Upper', exact: true }).click()
  25  |   await page.getByRole('button', { name: 'See matches' }).click()
  26  | 
  27  |   await expect(page).toHaveURL(/\/request\/req_[^/]+\/matches$/)
  28  |   await expect(page.getByText("You're the first on 12951")).toBeVisible()
  29  |   await expect(page.getByText('Share this link so others on your train can join.')).toBeVisible()
  30  |   await expect(page.getByRole('button', { name: 'Share coach link' })).toBeVisible()
  31  | })
  32  | 
  33  | /* A second open trip on the same train/date/class with a berth that is one of
  34  |    the ranked choices is a real match — same filters the ranking rules apply
  35  |    (`rankMatches`), fed through the UI instead of the store API. */
  36  | test('a matching open trip offers Send to 1 · free, and sending is free', async ({
  37  |   page,
  38  | }) => {
  39  |   await seed(page, {
  40  |     trips: [
  41  |       trip({ id: 't_mine', pnr_last4: '9630' }),
  42  |       trip({
  43  |         id: 't_theirs',
  44  |         pnr_last4: '9648',
  45  |         open_to_swap: true,
  46  |         passengers: [
  47  |           { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  48  |         ],
  49  |       }),
  50  |     ],
  51  |   })
  52  | 
  53  |   await page.goto('/request/new')
  54  |   await rankCard(page, '1st choice').getByRole('button', { name: 'Upper', exact: true }).click()
  55  |   await page.getByRole('button', { name: 'See matches' }).click()
  56  | 
  57  |   await expect(page.getByRole('button', { name: 'Send to 1 · free' })).toBeVisible()
  58  |   await page.getByRole('button', { name: 'Send to 1 · free' }).click()
  59  | 
  60  |   /* signin_asked is seeded as seen, so rule 8 does not interrupt: sending goes
  61  |      straight through and costs nothing (rules 1–2: free until someone accepts). */
  62  |   await expect(page).toHaveURL(/\/request\/req_[^/]+\/matches$/)
  63  |   await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible()
  64  |   await expect(page.getByText('Searching').first()).toBeVisible()
  65  | })
  66  | 
  67  | /* Rule 8 in the browser: the FIRST send asks for sign-in, and only Google. */
  68  | test('the first send asks for sign-in before sending', async ({ page }) => {
  69  |   await seed(page, {
  70  |     seen: { signin_asked: false },
  71  |     trips: [
  72  |       trip({ id: 't_mine', pnr_last4: '9630' }),
  73  |       trip({
  74  |         id: 't_theirs',
  75  |         pnr_last4: '9648',
  76  |         open_to_swap: true,
  77  |         passengers: [
  78  |           { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  79  |         ],
  80  |       }),
  81  |     ],
  82  |   })
  83  | 
  84  |   await page.goto('/request/new')
  85  |   await rankCard(page, '1st choice').getByRole('button', { name: 'Upper', exact: true }).click()
  86  |   await page.getByRole('button', { name: 'See matches' }).click()
  87  |   await page.getByRole('button', { name: 'Send to 1 · free' }).click()
  88  | 
  89  |   await expect(page).toHaveURL(/\/signin\?redirect=/)
  90  |   await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  91  |   /* Rule 8: Google only — no phone, no OTP, no password anywhere on the screen. */
  92  |   await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  93  |   await expect(page.getByText(/OTP|password|phone number/i)).toHaveCount(0)
  94  |   await expect(page.getByText('Not now')).toBeVisible()
  95  | })
  96  | 
  97  | /* docs/04 B — the acceptor side is seeded as one open trip, and the device
  98  |    models a stand-in incoming request for it ("Priya"). */
  99  | test('an open trip shows the ₹99 rules before anyone accepts', async ({ page }) => {
  100 |   await seed(page, {
  101 |     trips: [trip({ id: 't_open', pnr_last4: '9648', open_to_swap: true })],
  102 |   })
> 103 |   await page.goto('/swaps')
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/swaps
  104 |   await expect(page.getByRole('heading', { name: 'Swaps' })).toBeVisible()
  105 |   await expect(page.getByText('SeatSwap fee ₹49')).toBeVisible()
  106 |   await expect(page.getByText('₹99 for one swap')).toBeVisible()
  107 |   await expect(page.getByText('You pay only after someone accepts. No payment timer.')).toBeVisible()
  108 |   await expect(page.getByText('Credit lowers future SeatSwap fees. Never cash, never transferable. Valid 12 months.')).toBeVisible()
  109 |   /* Rule 3 — the acceptor never pays. */
  110 |   await expect(page.getByText('The other traveller pays nothing and earns ₹50 credit when the swap is done.')).toBeVisible()
  111 | })
  112 | 
```