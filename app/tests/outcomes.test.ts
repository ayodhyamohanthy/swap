/* Confirmations: both swapped -> confirmed +50; agreed miss -> voided +99;
   differ -> disputed (no promised time); cancel -> voided; 12h auto-confirm. */
import { describe, expect, it } from 'vitest'
import { cancelAfterPay, creditExpiresAt, resolveConfirmations, shouldAutoConfirm } from '@/lib/outcomes'

describe('resolveConfirmations', () => {
  it('confirms with acceptor +5000 when both swapped', () => {
    const r = resolveConfirmations('swapped', 'swapped')
    expect(r.status).toBe('confirmed')
    expect(r.credits).toMatchObject([{ to: 'acceptor', amountPaise: 5000, kind: 'acceptor_credit', expiresMonths: 12 }])
  })
  it('voids with requester +9900 when both agree it did not happen', () => {
    for (const o of ['no_show', 'not_possible', 'changed_mind'] as const) {
      const r = resolveConfirmations(o, o)
      expect(r.status).toBe('voided')
      expect(r.credits).toMatchObject([{ to: 'requester', amountPaise: 9900, kind: 'swap_to_credit' }])
    }
  })
  it('disputes when answers differ', () => {
    expect(resolveConfirmations('swapped', 'no_show').status).toBe('disputed')
    expect(resolveConfirmations('swapped', 'no_show').credits).toEqual([])
  })
})
describe('cancelAfterPay', () => {
  it('voids with requester +9900 credit', () => {
    expect(cancelAfterPay()).toMatchObject({ status: 'voided', resultKey: 'credit_added' })
    expect(cancelAfterPay().credits[0].amountPaise).toBe(9900)
  })
})
describe('shouldAutoConfirm', () => {
  const arrival = Date.parse('2026-11-12T10:00:00Z')
  it('confirms after 12h of silence', () => {
    expect(shouldAutoConfirm(arrival + 12 * 3600 * 1000, arrival, 1)).toBe(true)
    expect(shouldAutoConfirm(arrival + 11 * 3600 * 1000, arrival, 1)).toBe(false)
  })
  it('never auto-confirms once both answered', () => {
    expect(shouldAutoConfirm(arrival + 48 * 3600 * 1000, arrival, 2)).toBe(false)
  })
})
describe('creditExpiresAt', () => {
  it('expires 12 months later', () => {
    const got = new Date(creditExpiresAt(Date.parse('2026-01-15T00:00:00Z')))
    expect(got.getUTCFullYear()).toBe(2027)
    expect(got.getUTCMonth()).toBe(0)
  })
})
