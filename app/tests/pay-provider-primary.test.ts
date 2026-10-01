/* Rule 9 / build-plan item 7: Razorpay is the SINGLE primary gateway, domestic
 * AND international. PayPal is a fallback the passenger chooses explicitly.
 *
 * WHY THIS NEEDS A GUARD, and why reading the JSX was not enough. The method
 * screen said "international ⇒ PayPal" by STRUCTURE, not by any sentence: one
 * section headed `pay.inIndia` held the whole card rail, and a second headed
 * `pay.intl` held nothing but the PayPal button. Every string involved was
 * individually correct, which is why the defect survived review and a by-locale
 * copy check. The section headings ARE the claim, so the headings are what this
 * file pins.
 *
 * Three ways it could come back, one per describe block:
 *   1. A country-scoped heading over the primary rail.
 *   2. The fallback section without the correction line — rule 9's mandated
 *      label names PayPal, so a section going straight from that label to the
 *      button still reads "abroad ⇒ PayPal", and the correction has to sit ABOVE
 *      the button.
 *   3. docs/06 describing a screen that no longer exists.
 */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'

const REPO = join(import.meta.dirname, '..', '..')
const METHOD_ROUTE = join(import.meta.dirname, '..', 'src', 'routes', 'pay.$requestId.method.tsx')

/** AGENTS.md rule 9, verbatim: the label the PayPal fallback must carry. */
const RULE_9_LABEL = 'International traveller? Pay with PayPal'

/** The leaf inside the `pay` namespace the correction line lives under. */
const CORRECTION_LEAF = 'intlNote'

/** The same key as the route and docs/06 spell it. */
const CORRECTION_KEY = `pay.${CORRECTION_LEAF}`

/** The key the screen renders for the primary card rail's heading. */
const PRIMARY_RAIL_HEADING = 'pay.razorpay'

const src = readFileSync(METHOD_ROUTE, 'utf8')
const docs06 = readFileSync(join(REPO, 'docs', '06-PAYMENTS.md'), 'utf8')

/** `pay.*` from either catalogue. */
function pay(lang: 'en' | 'hi'): Record<string, string> {
  return (lang === 'en' ? en : hi).pay as unknown as Record<string, string>
}

/**
 * `pay.razorpay` → `razorpay`.
 *
 * The route and the docs spell these keys fully qualified while the catalogue
 * nests them, so every lookup goes through here. Doing it in one place is what
 * stops a `pay(lang)[key]` from quietly reading `undefined` — which is how the
 * first run of this file reported a TypeError instead of a failed assertion.
 */
function leaf(key: string): string {
  return key.startsWith('pay.') ? key.slice('pay.'.length) : key
}

/**
 * The screen's gateway section headings, in render order.
 *
 * Read out of the SHIPPED file rather than asserted as literals, so the guard
 * survives a rename and still fails on a reordering — a test hardcoding
 * `['pay.razorpay', 'pay.intl']` passes happily on a screen whose first section
 * is scoped to India.
 *
 * `uppercase` is what makes a paragraph a heading here: these are the tracked
 * labels naming a gateway section, not body copy inside a card.
 */
function headings(source: string): string[] {
  return [...source.matchAll(/<p[^>]*uppercase[^>]*>\s*\{t\('([^']+)'\)\}\s*<\/p>/g)].map(
    (m) => m[1],
  )
}

describe('the method screen is read before anything is asserted about it', () => {
  /* A guard whose pattern matches nothing reports green. */
  it('scans the real route', () => {
    expect(src.length).toBeGreaterThan(1000)
    expect(src).toContain('MethodScreen')
    expect(src).toContain('pay.payPal')
  })

  it('finds exactly the two gateway sections it pins', () => {
    expect(headings(src)).toHaveLength(2)
  })
})

describe('Razorpay is primary for everyone (rule 9, build-plan item 7)', () => {
  it('heads the card rail with the ungated rail, not a country-scoped one', () => {
    const [primary] = headings(src)
    expect(primary).toBe(PRIMARY_RAIL_HEADING)
    /* The check that is actually about the rule rather than about a key's name:
       no language may restrict the rail to one country. */
    for (const lang of ['en', 'hi'] as const) {
      const value = pay(lang)[leaf(primary)]
      expect(value, `${lang}.${primary} must exist in the catalogue`).toBeTruthy()
      expect(value, `${lang}.${primary} must not scope the card rail by country`).not.toMatch(
        /\bin india\b|इंडिया/iu,
      )
    }
  })

  it('has no key whose job was to scope the primary rail to India', () => {
    /* `pay.inIndia` WAS that key, and asserting it is GONE is stronger than
       asserting it is unused: dead copy is otherwise indistinguishable from
       reserved copy, and a key named for the framing item 7 removes is the one
       case where returning it is a regression rather than a wiring mistake. */
    for (const lang of ['en', 'hi'] as const) {
      expect(Object.keys(pay(lang)).filter((key) => /india/i.test(key))).toEqual([])
    }
  })

  it('renders the card rail before the PayPal fallback', () => {
    /* Order is the claim: whichever gateway a passenger reaches first is the one
       the screen offers as the normal way to pay. */
    const rail = src.indexOf("pay('razorpay', method)")
    const fallback = src.indexOf("pay('paypal'")
    expect(rail).toBeGreaterThan(-1)
    expect(fallback).toBeGreaterThan(-1)
    expect(rail).toBeLessThan(fallback)
  })
})

describe('the PayPal fallback is explicit, and says so above the button', () => {
  it("carries rule 9's mandated label, in both languages", () => {
    const [, fallbackHeading] = headings(src)
    expect(pay('en')[leaf(fallbackHeading)]).toBe(RULE_9_LABEL)
    /* Hindi asserted rather than assumed: `pay.paypalAlt` shipped an English
       string under a Hindi key for a week unnoticed, because the parity test
       compares key SETS and never values. */
    expect(pay('hi')[leaf(fallbackHeading)]).toBe('अंतरराष्ट्रीय यात्री? PayPal से भुगतान करें')
    expect(pay('hi')[leaf(fallbackHeading)]).not.toBe(pay('en')[leaf(fallbackHeading)])
  })

  it('states that the card rail above works from abroad, above the button', () => {
    const correction = src.indexOf(`t('${CORRECTION_KEY}')`)
    const button = src.indexOf('pay.payPal')
    expect(correction, `${CORRECTION_KEY} is not rendered`).toBeGreaterThan(-1)
    expect(
      correction,
      'the correction must come BEFORE the PayPal button — below it the section still reads "abroad ⇒ PayPal"',
    ).toBeLessThan(button)
  })

  it('has a correction line that adds something the label does not', () => {
    for (const lang of ['en', 'hi'] as const) {
      const value = pay(lang)[CORRECTION_LEAF]
      expect(value, `${lang}.${CORRECTION_KEY} must exist`).toBeTruthy()
      expect(value).not.toBe(pay(lang).intl)
      /* Not the estimate sentence: `pay.paypalNote` is the PayPal dollar line
         rendered under the button, and reusing it here would print the same
         paragraph twice on one screen. */
      expect(value).not.toBe(pay(lang).paypalNote)
    }
  })

  it('leaves no second key carrying the same sentence as the fallback heading', () => {
    /* The relay that first touched this item set `pay.intl` to the mandated
       label and left `pay.paypalAlt` already holding it — two keys, one
       sentence, so the label could be reworded on one and not the other.
       Compared per language, because the Hindi value is a Hindi sentence: an
       English literal here would find nothing in `hi` and report a clean bill of
       health for a duplicated key. */
    for (const lang of ['en', 'hi'] as const) {
      const label = pay(lang).intl
      const copies = Object.entries(pay(lang))
        .filter(([, value]) => value === label)
        .map(([key]) => key)
      expect(copies, `${lang} carries the PayPal heading sentence twice`).toEqual(['intl'])
    }
  })
})

describe('docs/06 describes the screen that exists (item 7\'s docs clause)', () => {
  it('states Razorpay is primary for both, in words the code agrees with', () => {
    /* Two facts rather than one phrase, so the guard survives a reword of
       either clause — what it must not survive is dropping "international",
       which is the clause build-plan item 7 exists to add. */
    expect(docs06).toMatch(/single primary gateway/i)
    expect(docs06).toMatch(/domestic and international/i)
  })

  it('no longer claims the method screen frames PayPal as the international option', () => {
    /* The stale sentence, verbatim. It is a defect to leave behind because it
       is what kept the item open for three passes with the code half-changed. */
    expect(docs06).not.toContain('still frames PayPal as the international option')
  })

  it('names the correction key, so the doc and the screen cannot drift apart', () => {
    expect(docs06).toContain(CORRECTION_KEY)
  })
})