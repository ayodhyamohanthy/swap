/* Build plan: Razorpay is the single primary gateway for domestic AND
   international; PayPal is demoted to the fallback path only (docs/06).
   Source-based guard: the method screen must not style PayPal as a featured
   primary, must name the fallback in rendered copy, and must keep Razorpay's
   methods above the PayPal section. */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'

const APP = join(import.meta.dirname, '..')

function read(rel: string): string {
  return readFileSync(join(APP, rel), 'utf8')
}

describe('Razorpay is the single primary gateway (docs/06)', () => {
  const method = read('src/routes/pay.$requestId.method.tsx')

  it('demotes PayPal: no featured-accent styling on the PayPal control', () => {
    expect(method, 'the PayPal button still wears the featured primary styling').not.toContain('bg-accent')
  })

  it('names PayPal a fallback in the rendered copy', () => {
    expect(method).toContain("t('pay.paypalFallback')")
  })

  it('keeps the Razorpay methods above the PayPal section', () => {
    const upi = method.indexOf("t('pay.inIndia')")
    const intl = method.indexOf("t('pay.intl')")
    expect(upi, 'the inIndia section is missing').toBeGreaterThan(-1)
    expect(intl).toBeGreaterThan(upi)
  })

  it('defines the fallback copy in both catalogues', () => {
    expect(en.pay.paypalFallback).toBeTruthy()
    expect(hi.pay.paypalFallback).toBeTruthy()
    expect(en.pay.paypalFallback).not.toEqual(hi.pay.paypalFallback)
  })
})
