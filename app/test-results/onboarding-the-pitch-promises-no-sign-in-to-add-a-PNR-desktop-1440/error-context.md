# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: onboarding.spec.ts >> the pitch promises no sign-in to add a PNR
- Location: e2e/onboarding.spec.ts:34:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/
Call log:
  - navigating to "http://127.0.0.1:4319/", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { assertOnlyHydration, seed, watchPage } from './support'
  3  | 
  4  | /* docs/04 A.1–A.3 — first open. The ONLY gated route in the app is `/`
  5  |    (`routes/index.tsx` beforeLoad), so this is the one flow that proves the
  6  |    onboarding chain end to end: language → note → home, and nothing else in
  7  |    between (privacy and alerts are reached from Profile, not from here). */
  8  | test('first open walks language → note → home', async ({ page }) => {
  9  |   const watch = watchPage(page)
  10 |   await seed(page, { fresh: true })
  11 | 
  12 |   await page.goto('/')
  13 |   await expect(page).toHaveURL(/\/welcome\/language$/)
  14 |   await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  15 | 
  16 |   await page.getByRole('button', { name: 'Continue' }).click()
  17 |   await expect(page).toHaveURL(/\/welcome\/note$/)
  18 |   await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible()
  19 | 
  20 |   await page.getByRole('button', { name: 'Got it' }).click()
  21 |   await expect(page).toHaveURL(/\/$/)
  22 |   await expect(page.getByRole('heading', { name: "Where's your train taking you?" })).toBeVisible()
  23 | 
  24 |   /* `/` is prerendered as Home and this run renders the same thing the server
  25 |      wrote — the redirect happens before paint, so hydration has nothing to
  26 |      disagree with. Zero is the budget; one would be a real mismatch. */
  27 |   assertOnlyHydration(watch, 0)
  28 | })
  29 | 
  30 | /* Rule 8: sign-in is asked only when a request is first sent or accepted.
  31 |    PNR entry works signed out — asserted as the home pitch's own line, plus the
  32 |    fuller promise on the sign-in screen itself (where rule 8 allows it to
  33 |    appear; home only carries the short "No sign-in needed"). */
  34 | test('the pitch promises no sign-in to add a PNR', async ({ page }) => {
  35 |   await seed(page, { fresh: true })
> 36 |   await page.goto('/')
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4319/
  37 |   await page.goto('/welcome/language')
  38 |   await page.getByRole('button', { name: 'Continue' }).click()
  39 |   await page.getByRole('button', { name: 'Got it' }).click()
  40 |   await expect(page.getByText('No sign-in needed')).toBeVisible()
  41 | 
  42 |   await page.goto('/signin')
  43 |   await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  44 |   await expect(
  45 |     page.getByText('PNR entry works signed out. Sign-in is asked only when you first send or accept a request.'),
  46 |   ).toBeVisible()
  47 |   /* Google only — no phone, no OTP, no password on the screen (rule 8). */
  48 |   await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  49 |   await expect(page.getByText(/OTP|password|phone number/i)).toHaveCount(0)
  50 | })
  51 | 
```