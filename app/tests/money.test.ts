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
  rupees,
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
