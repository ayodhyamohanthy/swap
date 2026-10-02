# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: request.spec.ts >> the first send asks for sign-in before sending
- Location: e2e/request.spec.ts:59:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('heading', { name: '1st choice' }).locator('..').getByRole('button', { name: 'Upper' })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]: SeatSwap
    - main [ref=e5]:
      - generic [ref=e6]:
        - heading "What would you like?" [level=1] [ref=e7]
        - paragraph [ref=e8]: Pick up to 3 choices. Sending is free.
        - generic [ref=e9]:
          - button "12951" [pressed] [ref=e10]
          - button "12951" [ref=e11]
        - generic [ref=e12]:
          - paragraph [ref=e13]: 1st choice
          - paragraph [ref=e14]: Pick a berth for 1st choice
          - generic [ref=e15]:
            - button "Lower" [ref=e16]
            - button "Middle" [ref=e17]
            - button "Upper" [ref=e18]
            - button "Side lower" [ref=e19]
            - button "Side upper" [ref=e20]
        - generic [ref=e21]:
          - paragraph [ref=e22]: 2nd choice
          - paragraph [ref=e23]: Pick a berth for 2nd choice
          - generic [ref=e24]:
            - button "Lower" [ref=e25]
            - button "Middle" [ref=e26]
            - button "Upper" [ref=e27]
            - button "Side lower" [ref=e28]
            - button "Side upper" [ref=e29]
        - generic [ref=e30]:
          - paragraph [ref=e31]: 3rd choice
          - paragraph [ref=e32]: Pick a berth for 3rd choice
          - generic [ref=e33]:
            - button "Lower" [ref=e34]
            - button "Middle" [ref=e35]
            - button "Upper" [ref=e36]
            - button "Side lower" [ref=e37]
            - button "Side upper" [ref=e38]
        - generic [ref=e39]:
          - generic [ref=e40]:
            - generic [ref=e41]: Same coach only
            - generic [ref=e42]: Show people in B3 first.
          - switch "Same coach only" [ref=e43]
        - generic [ref=e45]:
          - generic [ref=e46]:
            - generic [ref=e47]: Keep us together
            - generic [ref=e48]: Your group stays close.
          - switch "Keep us together" [ref=e49]
        - generic [ref=e51]:
          - paragraph [ref=e52]: Why do you need this swap?
          - generic [ref=e53]:
            - button "Family needs to sit together" [ref=e54]
            - button "Elder prefers a lower berth" [ref=e55]
            - button "Medical need" [ref=e56]
            - button "Travelling in a group" [ref=e57]
            - button "Prefers a window seat" [ref=e58]
            - button "Prefer not to say" [ref=e59]
        - button "See matches" [ref=e60]
        - paragraph [ref=e64]: Sending requests is free.
    - navigation "SeatSwap" [ref=e68]:
      - link "Home" [ref=e69] [cursor=pointer]:
        - /url: /
      - link "Swaps" [ref=e73] [cursor=pointer]:
        - /url: /swaps
      - link "Profile" [ref=e77] [cursor=pointer]:
        - /url: /profile
  - status
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | import { seed, trip } from './support'
  3   | 
  4   | /* The match pool is THIS device's own trips (`lib/requests.ts localPool`), so
  5   |    "one trip" is the honest way to reproduce the zero-match state — the same
  6   |    reason the app itself shows "You're the first". */
  7   | test('zero matches shows You are the first, not an empty list', async ({ page }) => {
  8   |   await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  9   | 
  10  |   await page.goto('/request/new')
  11  |   await expect(page.getByRole('heading', { name: 'What would you like?' })).toBeVisible()
  12  | 
  13  |   const firstChoice = page.getByRole('heading', { name: '1st choice' }).locator('..')
  14  |   await firstChoice.getByRole('button', { name: 'Upper' }).click()
  15  |   await page.getByRole('button', { name: 'See matches' }).click()
  16  | 
  17  |   await expect(page).toHaveURL(/\/request\/req_[^/]+\/matches$/)
  18  |   await expect(page.getByText("You're the first on 12951")).toBeVisible()
  19  |   await expect(page.getByText('Share this link so others on your train can join.')).toBeVisible()
  20  |   await expect(page.getByRole('button', { name: 'Share coach link' })).toBeVisible()
  21  | })
  22  | 
  23  | /* A second open trip on the same train/date/class with a berth that is one of
  24  |    the ranked choices is a real match — same filters the ranking rules apply
  25  |    (`rankMatches`), fed through the UI instead of the store API. */
  26  | test('a matching open trip offers Send to 1 · free, and sending is free', async ({
  27  |   page,
  28  | }) => {
  29  |   await seed(page, {
  30  |     trips: [
  31  |       trip({ id: 't_mine', pnr_last4: '9630' }),
  32  |       trip({
  33  |         id: 't_theirs',
  34  |         pnr_last4: '9648',
  35  |         open_to_swap: true,
  36  |         passengers: [
  37  |           { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  38  |         ],
  39  |       }),
  40  |     ],
  41  |   })
  42  | 
  43  |   await page.goto('/request/new')
  44  |   const firstChoice = page.getByRole('heading', { name: '1st choice' }).locator('..')
  45  |   await firstChoice.getByRole('button', { name: 'Upper' }).click()
  46  |   await page.getByRole('button', { name: 'See matches' }).click()
  47  | 
  48  |   await expect(page.getByRole('button', { name: 'Send to 1 · free' })).toBeVisible()
  49  |   await page.getByRole('button', { name: 'Send to 1 · free' }).click()
  50  | 
  51  |   /* signin_asked is seeded as seen, so rule 8 does not interrupt: sending goes
  52  |      straight through and costs nothing (rules 1–2: free until someone accepts). */
  53  |   await expect(page).toHaveURL(/\/request\/req_[^/]+\/matches$/)
  54  |   await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible()
  55  |   await expect(page.getByText('Searching').first()).toBeVisible()
  56  | })
  57  | 
  58  | /* Rule 8 in the browser: the FIRST send asks for sign-in, and only Google. */
  59  | test('the first send asks for sign-in before sending', async ({ page }) => {
  60  |   await seed(page, {
  61  |     seen: { signin_asked: false },
  62  |     trips: [
  63  |       trip({ id: 't_mine', pnr_last4: '9630' }),
  64  |       trip({
  65  |         id: 't_theirs',
  66  |         pnr_last4: '9648',
  67  |         open_to_swap: true,
  68  |         passengers: [
  69  |           { id: 'p_t_theirs', label: 'Passenger 1', coach: 'B6', berth_no: '41', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false, board_code: null, drop_code: null },
  70  |         ],
  71  |       }),
  72  |     ],
  73  |   })
  74  | 
  75  |   await page.goto('/request/new')
  76  |   const firstChoice = page.getByRole('heading', { name: '1st choice' }).locator('..')
> 77  |   await firstChoice.getByRole('button', { name: 'Upper' }).click()
      |                                                            ^ Error: locator.click: Test timeout of 30000ms exceeded.
  78  |   await page.getByRole('button', { name: 'See matches' }).click()
  79  |   await page.getByRole('button', { name: 'Send to 1 · free' }).click()
  80  | 
  81  |   await expect(page).toHaveURL(/\/signin\?redirect=/)
  82  |   await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  83  |   /* Rule 8: Google only — no phone, no OTP, no password anywhere on the screen. */
  84  |   await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  85  |   await expect(page.getByText(/OTP|password|phone number/i)).toHaveCount(0)
  86  |   await expect(page.getByText('Not now')).toBeVisible()
  87  | })
  88  | 
  89  | /* docs/04 B — the acceptor side is seeded as one open trip, and the device
  90  |    models a stand-in incoming request for it ("Priya"). */
  91  | test('an open trip shows the ₹99 rules before anyone accepts', async ({ page }) => {
  92  |   await seed(page, {
  93  |     trips: [trip({ id: 't_open', pnr_last4: '9648', open_to_swap: true })],
  94  |   })
  95  |   await page.goto('/swaps')
  96  |   await expect(page.getByRole('heading', { name: 'Swaps' })).toBeVisible()
  97  |   await expect(page.getByText('SeatSwap fee ₹49')).toBeVisible()
  98  |   await expect(page.getByText('₹99 for one swap')).toBeVisible()
  99  |   await expect(page.getByText('You pay only after someone accepts. No payment timer.')).toBeVisible()
  100 |   await expect(page.getByText('Credit lowers future SeatSwap fees. Never cash, never transferable. Valid 12 months.')).toBeVisible()
  101 |   /* Rule 3 — the acceptor never pays. */
  102 |   await expect(page.getByText('The other traveller pays nothing and earns ₹50 credit when the swap is done.')).toBeVisible()
  103 | })
  104 | 
```