/* docs/17 W7.1 + W7.3: the whole E2E suite runs under the shipped _headers,
   because the static server applies them the way Cloudflare does — a CSP
   that breaks the app must fail here, not at the next deploy (CSP is where
   payment integrations break). This spec pins the header itself: the hash
   injection must have run, the pay origins must be allowed, and the core
   local-first flow must produce zero CSP violations. Self-contained on
   purpose, like the other specs. */
import { expect, test, type Page } from '@playwright/test'

function collectCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('pageerror', (error) => {
    if (/Content-Security-Policy/i.test(error.message)) violations.push(`pageerror: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content-Security-Policy/i.test(message.text()))
      violations.push(`console: ${message.text()}`)
  })
  return violations
}

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Got it' }).click()
}

async function addTrip(page: Page, pnr: string) {
  await page.goto('/')
  const homePnr = page.locator('#home-pnr')
  if ((await homePnr.count()) > 0) {
    await homePnr.fill(pnr)
    await page.getByRole('button', { name: 'Find my berth' }).first().click()
  } else {
    await page.getByRole('link', { name: 'Add PNR' }).click()
    await page.fill('#pnr', pnr)
  }
  await expect(page).toHaveURL(/\/trips\/add/)
  await page.fill('#train', '12951')
  await page.fill('#date', '2026-11-05')
  await page.getByRole('button', { name: 'Find my berth' }).click()
  await expect(page).toHaveURL(/\/trips\/[^/]+$/)
}

test('the served CSP is the full policy with build-time inline-script hashes', async ({ page }) => {
  const response = await page.goto('/')
  expect(response, 'the shell must answer').not.toBeNull()
  const csp = response!.headers()['content-security-policy'] ?? ''

  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain('checkout.razorpay.com')
  expect(csp).toContain('www.paypal.com')
  expect(csp).toContain('api.qrserver.com')
  expect(csp).toContain('*.supabase.co')
  expect(csp).toContain('*.ingest.sentry.io')
  expect(csp).toContain('object-src \'none\'')

  /* The build must have hashed the shell's inline scripts: without the
     tokens the app cannot boot, and a malformed token would silently drop
     the whole policy, so both are asserted. */
  expect(csp).toContain("'sha256-")

  expect(response!.headers()['x-frame-options']).toBe('DENY')
  expect(response!.headers()['x-content-type-options']).toBe('nosniff')
  expect(response!.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
})

test('the core local-first flow runs clean under the real CSP', async ({ page }) => {
  const violations = collectCspViolations(page)
  await openHome(page)
  await addTrip(page, '4512789632')
  await page.getByRole('link', { name: 'Ask for a swap' }).click()
  await expect(page).toHaveURL(/\/swaps/)
  await page.getByRole('link', { name: 'Ask for a swap' }).click()
  await expect(page).toHaveURL(/\/request\/new/)
  await page.getByText('Lower').first().click()
  await page.getByRole('button', { name: 'See matches' }).click()
  await expect(page).toHaveURL(/\/request\/[^/]+\/matches/)

  /* The share screen loads its QR from api.qrserver.com: the one external
     image the app pulls at runtime, so img-src must allow it. A network
     failure in the sandbox is fine; a CSP refusal is not. */
  await page.goto('/share/12951-2026-11-05')
  /* The QR image sits behind the Show QR toggle, so the img-src grant for
     api.qrserver.com is only exercised after opening it. */
  await page.getByRole('button', { name: 'Show QR' }).click()
  await expect(page.locator('img[src*="api.qrserver.com"]').first()).toBeAttached()

  expect(violations, `CSP violations: ${violations.join(' | ')}`).toEqual([])
})
