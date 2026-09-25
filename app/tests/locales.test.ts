/* Copy rules and translation coverage (AGENTS.md rules 1, 4, 5, 10, 11, docs/09).
   These fail the build whenever a banned word or a missing translation slips in. */
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'
import { CATALOGS, LANGUAGES, SHIPPED_LANGS } from '@/lib/i18n'
import { PRICE_PAISE } from '@/lib/money'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** Every "a.b.c" leaf of a catalog, as string values. */
function leaves(node: Json, prefix = ''): Array<[string, string]> {
  if (typeof node !== 'object' || node === null) return [[prefix, String(node)]]
  if (Array.isArray(node)) return node.flatMap((item, i) => leaves(item, `${prefix}[${i}]`))
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  )
}

/** The mandated footer disclaimer is the one place "official" may appear (rule 11). */
const ALLOWED_OFFICIAL_KEYS = new Set(['footer.line2'])

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

describe('locale catalogs', () => {
  it('ships a catalog for every language marked ready', () => {
    for (const option of LANGUAGES) {
      if (option.ready) expect(SHIPPED_LANGS).toContain(option.code)
    }
    expect(SHIPPED_LANGS).toEqual(['en', 'hi'])
    expect(Object.keys(CATALOGS).sort()).toEqual([...SHIPPED_LANGS].sort())
    /* All 22 scheduled languages are listed (docs/01). */
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(22)
    expect(new Set(LANGUAGES.map((option) => option.code)).size).toBe(LANGUAGES.length)
  })

  it('has identical keys in English and Hindi', () => {
    const english = leaves(en as Json).map(([key]) => key).sort()
    const hindi = leaves(hi as Json).map(([key]) => key).sort()
    expect(hindi).toEqual(english)
  })

  it('has no empty strings', () => {
    for (const lang of SHIPPED_LANGS) {
      for (const [key, value] of leaves(CATALOGS[lang] as Json)) {
        expect(value.trim(), `${lang}.${key} is empty`).not.toBe('')
      }
    }
  })

  it('never uses a banned word (rule 10)', () => {
    for (const lang of SHIPPED_LANGS) {
      for (const [key, value] of leaves(CATALOGS[lang] as Json)) {
        if (ALLOWED_OFFICIAL_KEYS.has(key)) continue
        for (const [label, pattern] of BANNED) {
          expect(pattern.test(value), `${lang}.${key} contains banned "${label}": ${value}`).toBe(
            false,
          )
        }
      }
    }
  })

  it('keeps the mandated footer disclaimer (rule 11)', () => {
    expect(CATALOGS.en.footer.line2).toBe('SeatSwap is not an official railway service.')
    expect(CATALOGS.hi.footer.line2).toBe('SeatSwap is not an official railway service.')
    expect(CATALOGS.en.footer.line1.toLowerCase()).toContain('ticket')
  })

  it('shows the one price, ₹99, and never a discount (rules 1, 2, 6)', () => {
    const price = `₹${PRICE_PAISE / 100}`
    for (const lang of SHIPPED_LANGS) {
      const catalog = CATALOGS[lang]
      const copy = leaves(catalog as Json)
        .map(([key, value]) => `${key}:${value}`)
        .join('\n')
      expect(copy).toContain(price)
      expect(copy, `${lang} mentions a coupon`).not.toMatch(/\bcoupon/i)
      expect(copy, `${lang} offers a discount`).not.toMatch(/\b(?:discount|% ?off)\b/i)
    }
    /* Pay only after acceptance, and a swap that didn't happen becomes credit. */
    expect(CATALOGS.en.swaps.sub).toContain('₹99')
    expect(CATALOGS.en.swaps.noSwap).toContain('credit')
    expect(CATALOGS.hi.swaps.noSwap).toContain('₹99')
  })

  it('keeps the credit rules visible (rule 4)', () => {
    const creditCopy = leaves(CATALOGS.en as Json)
      .filter(([key]) => key.startsWith('profile.') || key.startsWith('swaps.'))
      .map(([, value]) => value)
      .join(' ')
    expect(creditCopy).toMatch(/credit/i)
  })
})
