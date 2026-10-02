import { expect, test } from '@playwright/test'
import { assertOnlyHydration, seed, watchPage } from './support'

/* docs/04 A.1–A.3 — first open. The ONLY gated route in the app is `/`
   (`routes/index.tsx` beforeLoad), so this is the one flow that proves the
   onboarding chain end to end: language → note → home, and nothing else in
   between (privacy and alerts are reached from Profile, not from here). */
test('first open walks language → note → home', async ({ page }) => {
  const watch = watchPage(page)
  await seed(page, { fresh: true })

  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome\/language$/)
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/welcome\/note$/)
  await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible()

  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: "Where's your train taking you?" })).toBeVisible()

  /* `/` is prerendered as Home and this run renders the same thing the server
     wrote — the redirect happens before paint, so hydration has nothing to
     disagree with. The two welcome pages are deep links with 1 hydration error
     each (docs/14 L1 row: "`/` 0 console errors, every deep link exactly 1"). */
  assertOnlyHydration(watch, 2)
})

/* Rule 8: sign-in is asked only when a request is first sent or accepted.
   PNR entry works signed out — asserted as the home pitch's own line, plus the
   fuller promise on the sign-in screen itself (where rule 8 allows it to
   appear; home only carries the short "No sign-in needed"). */
test('the pitch promises no sign-in to add a PNR', async ({ page }) => {
  await seed(page, { fresh: true })
  await page.goto('/')
  await page.goto('/welcome/language')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.getByText('No sign-in needed')).toBeVisible()

  await page.goto('/signin')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(
    page.getByText('PNR entry works signed out. Sign-in is asked only when you first send or accept a request.'),
  ).toBeVisible()
  /* Google only — no phone, no OTP, no password on the screen (rule 8). */
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByText(/OTP|password|phone number/i)).toHaveCount(0)
})
