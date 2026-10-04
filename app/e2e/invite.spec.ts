import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seed, trip } from './support'

/* The invite link is the one artefact that leaves the device and is opened by
   someone who is not the user (design 14b, `lib/share.ts`). Unit tests pin the
   string; this pins the loop at the browser level with two devices: context A
   (the traveller, seeded) produces the link on screen, context B (a stranger,
   empty localStorage — no seeding call at all) opens it. A stranger device is
   what the `?date=2026` bug actually broke: the sender's screen always looked
   fine. Needs no backend — the train page is public by design. */

/* Same rank scoping as request.spec.ts: "Upper" is a substring of
   "Side upper", so the chip match must be exact and scoped to one rank. */
async function pickUpperFirst(page: Page) {
  await page.goto('/request/new')
  await expect(page.getByRole('heading', { name: 'What would you like?' })).toBeVisible()
  await page
    .getByText('Pick a berth for 1st choice', { exact: true })
    .locator('..')
    .getByRole('button', { name: 'Upper', exact: true })
    .click()
  await page.getByRole('button', { name: 'See matches' }).click()
  await expect(page).toHaveURL(/\/request\/req_[^/]+\/matches$/)
}

test('an invite link opens a readable train page on a stranger device', async ({
  page,
  browser,
}) => {
  await seed(page, { trips: [trip({ id: 't_mine', pnr_last4: '9630' })] })
  await pickUpperFirst(page)

  /* Zero matches on purpose: one trip means "You're the first", and the
     screen answers with the share path — the exact state an inviter is in. */
  await expect(page.getByText("You're the first on 12951")).toBeVisible()
  await page.getByText('Share coach link').click()
  await expect(page).toHaveURL(/\/share\/12951-/)

  /* The link card carries the full journey date — the regression that
     motivated `splitTrainDate` truncated it to the year (`?date=2026`). */
  const card = page.locator('.break-all')
  await expect(card).toContainText(/\/train\/12951\?date=\d{4}-\d{2}-\d{2}/)
  const linkText = (await card.innerText()).trim()
  const strangerPath = new URL(linkText).pathname + new URL(linkText).search

  /* Second device: fresh context, nothing seeded, nothing signed in. */
  const stranger = await browser.newContext()
  const strangerPage = await stranger.newPage()
  try {
    await strangerPage.goto(strangerPath)
    await expect(strangerPage).toHaveURL(/\/train\/12951\?date=\d{4}-\d{2}-\d{2}/)
    await expect(
      strangerPage.getByRole('heading', { name: /12951/ }),
    ).toBeVisible()
    /* Rule 13 from the stranger's side: the inviter's last4 is nowhere on
       the public page. (The page is generic by design, so this also pins
       that it stays generic — a peer-data section added later fails here.) */
    await expect(strangerPage.getByText('9630')).toHaveCount(0)
  } finally {
    await stranger.close()
  }
})
