/* Every external origin named in app/src, checked against docs/12 §2's vendor
 * ledger — the enforcement half of the ledger's "an agent never adds a
 * vendor" rule. Three kinds of host are legitimate here:
 *
 *   1. the product's own domain, used for canonical/og URLs;
 *   2. share-intent targets the user taps (WhatsApp / Telegram / Facebook
 *      share links, the support inbox) — destinations the user chooses, not
 *      services the app calls;
 *   3. vendors whose ledger row says WIRED ("SDK/API allowed in code").
 *
 * A new host string anywhere under src/ (code or comment) fails the guard
 * until the allowlist below gains it with a reason — that edit IS the review
 * the ledger rule asks for. The scan is raw text on purpose: a vendor
 * sneaking in through a string built at runtime is caught the same way as
 * one pasted into JSX. */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', 'src')
const LEDGER = join(__dirname, '..', '..', 'docs', '12-INFRA-CREDITS.md')

type Entry = { why: string; vendor?: string }

/* Exact host strings, each annotated with why it is here. An entry whose host
 * src no longer names is a lie the next reader inherits, so check 2 fails on
 * it too — the list must stay exact, not merely closed. */
const ALLOWED: Record<string, Entry> = {
  /* Known pending gap, not a legit entry: api.qrserver.com is an unlisted
   * vendor fo/swap-qr-local removes from both share routes. The moment that
   * branch merges, check 2 fires on this entry and forces its deletion —
   * the guard then proves the vendor is gone rather than trusting it. */
  'api.qrserver.com': {
    why: 'UNLISTED vendor pending removal by fo/swap-qr-local; must not survive that merge',
  },
  'toyoufromme.website': {
    why: "the product's own domain — og:url / og:image / twitter:image in routes/__root.tsx (the docs/16 Cloudflare zone)",
  },
  'us.i.posthog.com': { why: 'product analytics', vendor: 'PostHog' },
  'api.razorpay.com': { why: 'orders API — payments primary', vendor: 'Razorpay' },
  'checkout.razorpay.com': { why: 'checkout script — payments primary', vendor: 'Razorpay' },
  'api-m.paypal.com': { why: 'orders API — international fallback', vendor: 'PayPal' },
  'www.paypal.com': { why: 'SDK — international fallback', vendor: 'PayPal' },
  'wa.me': { why: 'WhatsApp share intent the user taps' },
  't.me': { why: 'Telegram share intent the user taps' },
  'www.facebook.com': { why: 'Facebook share intent the user taps' },
  'www.instagram.com': { why: 'support inbox link (INSTAGRAM_INBOX_URL)' },
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p)
  }
  return out
}

function originsInSrc(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of walk(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = m[1].toLowerCase().replace(/\.+$/, '')
      if (!found.has(host)) found.set(host, [])
      found.get(host)!.push(file)
    }
  }
  return found
}

describe('external origins in src/ vs the vendor ledger (docs/12 §2)', () => {
  const found = originsInSrc()

  it('every host src names is on the annotated allowlist', () => {
    const unknown = [...found.keys()].filter((h) => !ALLOWED[h])
    if (unknown.length > 0) {
      for (const h of unknown) console.error(`unallowlisted origin: ${h} — ${found.get(h)!.join(', ')}`)
    }
    expect(unknown).toEqual([])
  })

  it('the allowlist stays exact: every entry is still named by src', () => {
    const stale = Object.keys(ALLOWED).filter((h) => !found.has(h))
    if (stale.length > 0) console.error(`allowlist entries src no longer names: ${stale.join(', ')}`)
    expect(stale).toEqual([])
  })

  it('vendor hosts cite a vendor that exists on the docs/12 §2 ledger', () => {
    const ledger = readFileSync(LEDGER, 'utf8').toLowerCase()
    const missing = Object.entries(ALLOWED)
      .filter(([, e]) => e.vendor && !ledger.includes(e.vendor.toLowerCase()))
      .map(([h, e]) => `${h} → ${e.vendor} not on the ledger`)
    expect(missing).toEqual([])
  })
})
