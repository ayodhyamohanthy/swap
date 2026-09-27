/* Quote + receipt + pay-state machine + outcome-to-credit (rules 1-6, 9). */
import { describe, expect, it } from 'vitest'
import { GROUP_PRICE_PAISE, PRICE_PAISE } from '@/lib/money'
import { buildQuote, nextPayState, outcomeToCredit, receiptNumber, splitReceipt } from '@/lib/payments'
import { planConsumeCredit } from '@/server/payments'
import { spendableCreditPaise, type CreditLedgerRow } from '@/lib/payments'

describe('buildQuote', () => {
  it('charges full price with no credit', () => {
    expect(buildQuote(0)).toEqual({ total: 9900, creditUsed: 0, due: 9900, provider: null })
  })
  it('applies partial credit and still needs a provider', () => {
    expect(buildQuote(3000)).toEqual({ total: 9900, creditUsed: 3000, due: 6900, provider: null })
  })
  it('covers the full price by credit with no provider', () => {
    expect(buildQuote(9900)).toEqual({ total: 9900, creditUsed: 9900, due: 0, provider: 'credit' })
    expect(buildQuote(20000).provider).toBe('credit')
  })
  it('quotes the group price', () => {
    const q = buildQuote(0, true)
    expect(q.total).toBe(GROUP_PRICE_PAISE)
    expect(q.due).toBe(GROUP_PRICE_PAISE)
  })
  it('clamps bad input to zero credit', () => {
    expect(buildQuote(-500).creditUsed).toBe(0)
    expect(buildQuote(Number.NaN).creditUsed).toBe(0)
  })
})
describe('splitReceipt', () => {
  it('lists fee 4900 + thank-you 5000 = 9900', () => {
    const r = splitReceipt(9900, 0)
    expect(r.total).toBe(PRICE_PAISE)
    expect(r.lines.find((l) => l.label === 'fee')?.amountPaise).toBe(4900)
    expect(r.lines.find((l) => l.label === 'thank_you')?.amountPaise).toBe(5000)
  })
  it('shows credit used when applied', () => {
    const r = splitReceipt(6900, 3000)
    expect(r.lines.find((l) => l.label === 'credit_used')?.amountPaise).toBe(-3000)
    expect(r.total).toBe(9900)
  })
})
describe('nextPayState', () => {
  it('walks created->pending->paid', () => {
    expect(nextPayState('created', 'authorize')).toBe('pending')
    expect(nextPayState('pending', 'capture')).toBe('paid')
  })
  it('fails from created or pending', () => {
    expect(nextPayState('created', 'fail')).toBe('failed')
    expect(nextPayState('pending', 'fail')).toBe('failed')
  })
  it('keeps terminal states', () => {
    expect(nextPayState('paid', 'fail')).toBe('paid')
    expect(nextPayState('failed', 'capture')).toBe('failed')
  })
})
describe('outcomeToCredit', () => {
  it('awards nothing when swapped', () => {
    expect(outcomeToCredit('swapped').amountPaise).toBe(0)
  })
  it('moves 9900 to requester credit when the swap did not happen', () => {
    for (const o of ['no_show', 'not_possible', 'changed_mind'] as const) {
      const c = outcomeToCredit(o)
      expect(c).toMatchObject({ to: 'requester', amountPaise: 9900, kind: 'swap_to_credit', expiresMonths: 12 })
    }
  })
  it('never refunds to bank except bank failure', () => {
    expect(outcomeToCredit('failed_bank').amountPaise).toBe(0)
  })
})
describe('receiptNumber', () => {
  it('formats SS-#####', () => {
    expect(receiptNumber(10482)).toMatch(/^SS-\d{5}$/)
  })
})

describe('planConsumeCredit', () => {
  const tx = (id: string, amount_paise: number, expires_at: string | null) => ({ id, amount_paise, expires_at })
  it('spends oldest-expiry-first and stops at the need', () => {
    const rows = [
      tx('late', 5000, '2027-06-01T00:00:00.000Z'),
      tx('early', 5000, '2026-12-01T00:00:00.000Z'),
      tx('never', 5000, null),
    ]
    const plan = planConsumeCredit(rows, 7000, Date.parse('2026-11-12T00:00:00.000Z'))
    expect(plan.usedTxIds).toEqual(['early', 'late'])
    expect(plan.usedTotal).toBe(7000)
  })
  it('skips expired and non-positive rows', () => {
    const rows = [
      tx('dead', 5000, '2026-01-01T00:00:00.000Z'),
      tx('neg', -2000, null),
      tx('good', 5000, '2027-01-01T00:00:00.000Z'),
    ]
    const plan = planConsumeCredit(rows, 9900, Date.parse('2026-11-12T00:00:00.000Z'))
    expect(plan.usedTxIds).toEqual(['good'])
    expect(plan.usedTotal).toBe(5000)
  })
  it('needs nothing when nothing is owed', () => {
    expect(planConsumeCredit([], 0, Date.now())).toEqual({ usedTxIds: [], usedTotal: 0 })
  })
})

/* Rule 4 + rule 2: a wallet holding ONLY expired credit is worth nothing. The
   balance a checkout quotes and the rows it plans to consume must agree, or the
   quote says "nothing due", no gateway is ever called, and the swap locks for
   free. */
describe('spendableCreditPaise', () => {
  const NOW = Date.parse('2026-09-27T00:00:00.000Z')
  const row = (over: Partial<CreditLedgerRow>): CreditLedgerRow => ({
    id: 'w1', amount_paise: 5000, expires_at: null, ...over,
  })

  it('counts unexpired credit', () => {
    expect(spendableCreditPaise([row({}), row({ id: 'w2', expires_at: '2027-01-01T00:00:00.000Z' })], NOW)).toBe(10000)
  })

  it('ignores expired credit entirely', () => {
    expect(spendableCreditPaise([row({ expires_at: '2026-01-01T00:00:00.000Z' })], NOW)).toBe(0)
  })

  it('agrees with planConsumeCredit on what is spendable', () => {
    const rows = [row({ expires_at: '2026-01-01T00:00:00.000Z' }), row({ id: 'w2' })]
    const balance = spendableCreditPaise(rows, NOW)
    const plan = planConsumeCredit(rows, balance, NOW)
    expect(plan.usedTotal).toBe(balance)
    expect(plan.usedTxIds).toEqual(['w2'])
  })

  it('a wallet of only expired credit still owes the full price', () => {
    const rows = [row({ amount_paise: 9900, expires_at: '2026-01-01T00:00:00.000Z' })]
    expect(buildQuote(spendableCreditPaise(rows, NOW))).toEqual({
      total: PRICE_PAISE, creditUsed: 0, due: PRICE_PAISE, provider: null,
    })
  })
})
