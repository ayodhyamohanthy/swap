/* docs/17 W6.1: "offline mode renders Trips + Swap summary". The worker
   itself never registers on local origins (docs/08: local hosts and
   frames stay worker-free), so this exercises the local-first half of
   the promise that a browser CAN prove here: with the network cut, the
   in-memory shell still renders the trips and swaps summaries. Route
   chunks load once while online, then every navigation below is offline. */
import { expect, test, type Page } from '@playwright/test'

const PNR = '4512789630'

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

test('trips and swaps summaries render with the network cut', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error}`))

  await openHome(page)
  await page.fill('#home-pnr', PNR)
  await page.getByRole('button', { name: 'Find my berth' }).first().click()
  await expect(page).toHaveURL(/\/trips\/add/)
  await page.fill('#train', '12951')
  await page.fill('#date', '2026-11-05')
  await page.getByRole('button', { name: 'Find my berth' }).click()
  await expect(page).toHaveURL(/\/trips\/[^/]+$/)

  /* Warm both summaries while online: the tabs' chunks must be in memory
     before the network is cut, since the worker does not exist locally. */
  await page.getByRole('link', { name: 'Swaps' }).first().click()
  await expect(page).toHaveURL(/\/swaps/)
  /* The trip is CNF, so swaps shows its ask CTA, not the no-trips empty state. */
  await expect(page.getByRole('link', { name: 'Ask for a swap' })).toBeVisible()

  await page.context().setOffline(true)

  /* Home again, offline: the shell says so, and the trip just added is
     there from local state (the Home card shows the train, not the PNR). */
  await page.getByRole('link', { name: 'Home' }).first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("You're offline. Your trips stay on this device.")).toBeVisible()
  await expect(page.getByRole('link', { name: /Train 12951/ })).toBeVisible()
  expect(errors).toEqual([])

  /* Swaps again, offline: the summary screen still renders. */
  await page.getByRole('link', { name: 'Swaps' }).first().click()
  await expect(page).toHaveURL(/\/swaps/)
  expect(errors).toEqual([])
})
