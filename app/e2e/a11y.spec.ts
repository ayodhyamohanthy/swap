/* docs/17 W6.1: accessibility is part of the shipped flow, so axe scans the
   main journey screens and must report zero critical or serious violations
   at both W6.1 viewports. Self-contained on purpose: no imports from the
   add-PNR spec, so either file can change without breaking the other. */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const PNR = '4512789630'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const bad = results.violations.filter((v) =>
    ['critical', 'serious'].includes(v.impact ?? ''),
  )
  if (bad.length > 0) {
    console.error(
      `axe ${label}:`,
      JSON.stringify(bad.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))),
    )
  }
  expect(bad, `${label}: critical/serious axe violations`).toEqual([])
}

test('main journey screens pass axe critical/serious', async ({ page }) => {
  const errors = collectErrors(page)
  await openHome(page)
  await scan(page, 'home')
  await page.fill('#home-pnr', PNR)
  await page.getByRole('button', { name: 'Find my berth' }).first().click()
  await expect(page).toHaveURL(/\/trips\/add/)
  await scan(page, 'trips/add')
  await page.fill('#train', '12951')
  await page.fill('#date', '2026-11-05')
  await page.getByRole('button', { name: 'Find my berth' }).click()
  await expect(page).toHaveURL(/\/trips\/[^/]+$/)
  await scan(page, 'trip detail')
  await page.getByRole('link', { name: 'Ask for a swap' }).click()
  await expect(page).toHaveURL(/\/swaps/)
  await page.getByRole('link', { name: 'Ask for a swap' }).click()
  await expect(page).toHaveURL(/\/request\/new/)
  await scan(page, 'request/new')
  await page.getByText('Lower').first().click()
  await page.getByRole('button', { name: 'See matches' }).click()
  await expect(page).toHaveURL(/\/request\/[^/]+\/matches/)
  await scan(page, 'matches')
  expect(errors).toEqual([])
})
