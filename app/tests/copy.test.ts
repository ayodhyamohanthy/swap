/* Copy + privacy guard for the React app (AGENTS.md rules 1, 4, 5, 8, 10, 11, 13).
   `locales.test.ts` checks the catalogs; this file checks the same rules against
   the route/component source, so a banned word typed straight into JSX or a raw
   PNR printed next to a passenger name fails the build. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import { FEE_PAISE, PRICE_PAISE, THANK_YOU_PAISE } from '@/lib/money'
import { maskPnr } from '@/lib/pnr'

const SRC = join(import.meta.dirname, '..', 'src')

/** Only the files a traveller can actually read copy from. */
const COPY_DIRS = ['routes', 'components'].map((dir) => join(SRC, dir))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/**
 * Every route and component, as one blob of text per file with comments
 * removed. Scanning the whole file (not just quoted strings) is deliberate: JSX
 * text sits between tags, so a banned word typed straight into a heading would
 * never appear inside quotes.
 */
const UI_COPY: Array<[string, string]> = COPY_DIRS.flatMap((dir) =>
  sourceFiles(dir).map((file): [string, string] => {
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    return [file.slice(SRC.length + 1), text]
  }),
)

/** The mandated footer disclaimer is the one place "official" may appear (rule 11). */
const BANNED: Array<[string, RegExp]> = [
  ['TTE', /\btte\b/i],
  ['pass / swap pass', /\b(?:swap\s+)?pass(?:es)?\b/i],
  ['Indian Railways', /indian\s+railways/i],
  ['IRCTC approved', /irctc\s+approved/i],
  ['authorised', /authoris|authoriz/i],
  ['legal', /\blegal\b/i],
  ['grievance', /\bgrievance/i],
  ['official', /\bofficial\b/i],
]

/** Rule 7: the exact dispute line, with no promised reply time. */
const DISPUTE_LINE = "We'll look at both sides and reply as soon as we can."

/** Short "…surrounding text…" so a failure points at the word, not the whole file. */
function hitsFor(pattern: RegExp): string[] {
  const found: string[] = []
  for (const [file, text] of UI_COPY) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))) {
      const from = Math.max(0, match.index - 30)
      const to = Math.min(text.length, match.index + match[0].length + 30)
      found.push(`${file}: …${text.slice(from, to).replace(/\s+/g, ' ').trim()}…`)
    }
  }
  return found
}

describe('banned words in app source', () => {
  it('scans a real number of files (guards against an empty scan)', () => {
    /* One blob per route/component file — well over 30 screens today. */
    expect(UI_COPY.length).toBeGreaterThan(30)
    for (const [file, text] of UI_COPY) {
      expect(text.length, `${file} scanned as empty`).toBeGreaterThan(0)
    }
  })

  it.each(BANNED)('never uses %s in a route or component', (_label, pattern) => {
    expect(hitsFor(pattern)).toEqual([])
  })

  it('keeps "official" only inside the mandated footer disclaimer', () => {
    expect(en.footer.line2).toContain('not an official railway service')
  })
})

describe('pricing copy (rules 1, 4, 5)', () => {
  it('₹99 is always ₹49 + ₹50', () => {
    expect(FEE_PAISE + THANK_YOU_PAISE).toBe(PRICE_PAISE)
    expect(PRICE_PAISE).toBe(9900)
  })

  it('never advertises a discount, coupon or free reward', () => {
    const promo = /\b(discount|coupon|promo code|free reward|sign-?up bonus)\b/i
    expect(promo.test(JSON.stringify(en))).toBe(false)
  })

  it('says credit is never cash and lasts 12 months', () => {
    expect(en.profile.creditBody).toMatch(/never cash/i)
    expect(en.profile.creditBody).toMatch(/12 months/i)
    expect(en.swaps.creditRule).toMatch(/never cash/i)
  })

  it('says the requester pays only after an acceptance, with no timer', () => {
    expect(en.swaps.onlyAfter).toMatch(/only after someone accepts/i)
    expect(en.swaps.onlyAfter).toMatch(/no payment timer/i)
    expect(en.payments.empty).toMatch(/only after someone accepts/i)
  })

  it('says an unspent ₹99 goes to credit, never back to the bank', () => {
    expect(en.swaps.noSwap).toMatch(/goes to your credit/i)
    expect(en.pay.under).toMatch(/credit/i)
  })
})

describe('dispute copy promises no timeline (rule 7)', () => {
  it('uses the mandated sentence verbatim', () => {
    expect(en.dispute.body).toContain(DISPUTE_LINE)
  })

  it('never promises a number of hours or days', () => {
    const promise = /\b(within|reply|resolve)[^.]{0,30}\b\d+\s*(hour|day|days)/i
    expect(promise.test(en.dispute.body)).toBe(false)
  })

  it('tells the traveller their money is held safely', () => {
    expect(en.dispute.body).toMatch(/money is held safely/i)
  })
})

describe('sign-in is Google only (rule 8)', () => {
  it('offers Google and nothing else', () => {
    expect(en.signin.google).toMatch(/google/i)
    const forbidden = /\b(otp|phone number|sms code|whatsapp otp|email address|password)\b/i
    expect(forbidden.test(JSON.stringify(en.signin))).toBe(false)
  })

  it('is only asked when sending or accepting', () => {
    expect(en.signin.body).toMatch(/only to send or accept/i)
    expect(en.signin.note).toMatch(/without sign-in/i)
  })
})

describe('privacy wording (rule 13)', () => {
  it('states the full PNR is never shown', () => {
    expect(en.help.pnrABody).toMatch(/^never\./i)
    expect(en.privacy.pnrNeverBody).toMatch(/private, always/i)
  })

  it('lists exactly what other travellers see before payment', () => {
    const rows = [en.privacy.body, en.help.pnrABody, en.incoming.privacy, en.invite.privacy]
    for (const value of rows) {
      expect(value).toMatch(/first name and initial/i)
      expect(value).toMatch(/class, coach and berth type/i)
    }
  })

  it('masks a PNR to its last four digits', () => {
    expect(maskPnr('4512789630')).toBe('••••••9630')
    expect(maskPnr('4512789630')).not.toContain('4512')
  })

  it('never hard-codes a 10-digit PNR in app source', () => {
    expect(hitsFor(/\b\d{10}\b/)).toEqual([])
  })
})

describe('positioning and navigation (rules 11, 12)', () => {
  it('carries the mandated footer line on setup screens', () => {
    expect(en.footer.line2).toBe('SeatSwap is not an official railway service.')
  })

  it('has exactly three bottom tabs', () => {
    expect(Object.keys(en.nav)).toEqual(['home', 'swaps', 'profile'])
  })

  it('stays in scope: Indian trains, no bus or flight copy', () => {
    expect(JSON.stringify(en)).not.toMatch(/\b(bus|flight|airline)\b/i)
  })
})
