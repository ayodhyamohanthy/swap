/* Money rules (AGENTS.md rules 1, 4, 6). Money is always integer paise. */
import { describe, expect, it } from 'vitest'

import {
  CREDIT_VALIDITY_MONTHS,
  FEE_PAISE,
  GROUP_PRICE_PAISE,
  PAYMENT_PROVIDERS,
  PRICE_PAISE,
  PRICE_SPLIT_OK,
  THANK_YOU_PAISE,
  formatRupees,
  formatUsdTenths,
  paiseToDecimalString,
  rupees,
  decimalStringToPaise,
  usdTenthsFor,
} from '@/lib/money'

describe('the swap price', () => {
  it('is exactly ₹99: ₹49 fee + ₹50 thank-you credit', () => {
    expect(PRICE_PAISE).toBe(9900)
    expect(FEE_PAISE).toBe(4900)
    expect(THANK_YOU_PAISE).toBe(5000)
    expect(FEE_PAISE + THANK_YOU_PAISE).toBe(PRICE_PAISE)
    expect(PRICE_SPLIT_OK).toBe(true)
  })

  it('offers no other price to Indian payers or international travellers', () => {
    expect(GROUP_PRICE_PAISE).toBe(19900) // ₹199 group trip, up to 3 swaps (step 10)
    expect(formatRupees(PRICE_PAISE)).toBe('₹99')
  })

  it('keeps credit valid for 12 months (rule 4)', () => {
    expect(CREDIT_VALIDITY_MONTHS).toBe(12)
  })

  it('knows the payment providers of the build plan', () => {
    expect([...PAYMENT_PROVIDERS]).toEqual(['razorpay', 'paypal', 'credit'])
  })
})

/* PayPal estimate (docs/06): "about US$X" is a hint, never the charge. The
   charge is always the INR paise figure; the estimate scales with it so a
   partly credit-covered payment estimates on what is actually charged. */
describe('the PayPal USD estimate', () => {
  it('shows about US$1.2 for the full ₹99 charge', () => {
    expect(formatUsdTenths(usdTenthsFor(9900))).toBe('US$1.2')
  })

  it('shrinks with the credit-covered charge instead of staying at US$1.20', () => {
    expect(formatUsdTenths(usdTenthsFor(4900))).toBe('US$0.6')
  })

  it('uses integer maths and refuses non-charges', () => {
    expect(() => usdTenthsFor(0)).toThrow()
    expect(() => usdTenthsFor(99.5)).toThrow()
    expect(() => formatUsdTenths(0)).toThrow()
  })
})

describe('formatting', () => {
  it('rounds paise to whole rupees', () => {
    expect(rupees(9900)).toBe(99)
    expect(rupees(5000)).toBe(50)
    expect(rupees(49)).toBe(0)
  })

  it('formats in Indian digits grouping', () => {
    expect(formatRupees(0)).toBe('₹0')
    expect(formatRupees(5000)).toBe('₹50')
    expect(formatRupees(19900)).toBe('₹199')
    expect(formatRupees(123400)).toBe('₹1,234')
    expect(formatRupees(12345600)).toBe('₹1,23,456')
  })
})

/* Reading an amount back off a gateway receipt. Integer maths only: a rupee
   disappearing through a float is a real money bug, and a malformed value must
   never be read as zero. */
describe('decimalStringToPaise', () => {
  it('round-trips paiseToDecimalString', () => {
    for (const paise of [9900, 5000, 19900, 1, 99, 100]) {
      expect(decimalStringToPaise(paiseToDecimalString(paise))).toBe(paise)
    }
  })
  it('parses plain and single-decimal forms', () => {
    expect(decimalStringToPaise('99.00')).toBe(9900)
    expect(decimalStringToPaise('99.5')).toBe(9950)
    expect(decimalStringToPaise('99')).toBe(9900)
    expect(decimalStringToPaise(' 99.00 ')).toBe(9900)
  })
  it('returns null rather than guessing', () => {
    expect(decimalStringToPaise('')).toBeNull()
    expect(decimalStringToPaise('99.999')).toBeNull()
    expect(decimalStringToPaise('1e2')).toBeNull()
    expect(decimalStringToPaise('-99.00')).toBeNull()
    expect(decimalStringToPaise('INR 99')).toBeNull()
    expect(decimalStringToPaise(undefined)).toBeNull()
    expect(decimalStringToPaise(99)).toBeNull()
  })
})
