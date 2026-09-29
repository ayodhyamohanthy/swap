/* Quote + receipt + pay-state machine + outcome-to-credit (rules 1-6, 9). */
import { describe, expect, it } from 'vitest'
import { GROUP_PRICE_PAISE, PRICE_PAISE } from '@/lib/money'
import { buildQuote, nextPayState, outcomeToCredit, receiptNumber, splitReceipt, usdEstimateFor } from '@/lib/payments'
import { planConsumeCredit } from '@/server/payments'
import { isCreditSpendable, spendableCreditPaise, type CreditLedgerRow } from '@/lib/payments'

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
  it('shows credit used when applied, and totals the cash actually captured', () => {
    const r = splitReceipt(9900, 3000)
    expect(r.lines.find((l) => l.label === 'credit_used')?.amountPaise).toBe(-3000)
    expect(r.total).toBe(6900)
  })
  /* The one property a receipt has to have, and the one it did not have. The
     credit-used line was a deduction while `total` returned the gross ₹99, so a
     credit-covered swap printed lines adding to ₹49 underneath a "Total ₹99".
     Design 29b's lines sum to its total exactly; design 29a shows the same
     split in words ("₹49 + ₹50 credit"). Swept across the range rather than
     pinned at a point, including ₹0 cash and the group price. */
  it('lines always sum to the total', () => {
    const cases: [number, number, boolean][] = [
      [9900, 0, false],
      [9900, 3000, false],
      [9900, 4900, false],
      [9900, 9900, false],
      [19900, 0, true],
      [19900, 5000, true],
      [19900, 19900, true],
    ]
    for (const [gross, credit, isGroup] of cases) {
      const r = splitReceipt(gross, credit, isGroup)
      const sum = r.lines.reduce((s, l) => s + l.amountPaise, 0)
      expect(sum, `gross ${gross} credit ${credit} group ${isGroup}`).toBe(r.total)
    }
  })
  it('a fully credit-covered swap totals zero, not the gross price', () => {
    expect(splitReceipt(9900, 9900).total).toBe(0)
  })
  it('never lets credit exceed the charge and drive the total negative', () => {
    const r = splitReceipt(9900, 999999)
    expect(r.total).toBe(0)
    expect(r.lines.find((l) => l.label === 'credit_used')?.amountPaise).toBe(-9900)
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

/* wallet_tx is a SIGNED ledger (docs/02: "balance = sum(amount) where not
   expired"; spends are negative `used` rows with no expiry). Reading it as
   "sum of the positive rows" let spent credit fund swaps for ever. */
describe('spendableCreditPaise', () => {
  const NOW = Date.parse('2026-09-27T00:00:00.000Z')
  const row = (over: Partial<CreditLedgerRow>): CreditLedgerRow => ({
    id: 'w1', amount_paise: 5000, expires_at: null, ...over,
  })
  const spent = (id: string, paise: number): CreditLedgerRow =>
    row({ id, amount_paise: -paise, expires_at: null })

  it('counts unexpired credit', () => {
    expect(spendableCreditPaise([row({}), row({ id: 'w2', expires_at: '2027-01-01T00:00:00.000Z' })], NOW)).toBe(10000)
  })

  it('ignores expired credit entirely', () => {
    expect(spendableCreditPaise([row({ expires_at: '2026-01-01T00:00:00.000Z' })], NOW)).toBe(0)
  })

  it('SUBTRACTS a spend instead of ignoring it', () => {
    expect(spendableCreditPaise([row({ amount_paise: 9900 }), spent('u1', 9900)], NOW)).toBe(0)
  })

  it('spent credit cannot fund a second swap', () => {
    /* The exploit: one earned ₹99, already spent on swap A, quoted as if it were
       still there, so swap B and every swap after it cost SeatSwap nothing. */
    const ledger = [row({ id: 'c1', amount_paise: 9900 }), spent('u1', 9900)]
    expect(spendableCreditPaise(ledger, NOW)).toBe(0)
    expect(buildQuote(spendableCreditPaise(ledger, NOW))).toEqual({
      total: PRICE_PAISE, creditUsed: 0, due: PRICE_PAISE, provider: null,
    })
  })

  it('a partial spend leaves only the remainder', () => {
    expect(spendableCreditPaise([row({ amount_paise: 9900 }), spent('u1', 4000)], NOW)).toBe(5900)
  })

  it('never reports a negative balance', () => {
    expect(spendableCreditPaise([row({ amount_paise: 1000 }), spent('u1', 9900)], NOW)).toBe(0)
  })

  it('an expired credit row does not cancel a spend that already happened', () => {
    /* +9900 expires, the -9900 `used` row never does: the wallet is empty, not
       negative, and the user simply sees no credit. */
    expect(spendableCreditPaise(
      [row({ amount_paise: 9900, expires_at: '2026-01-01T00:00:00.000Z' }), spent('u1', 9900)], NOW,
    )).toBe(0)
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

/* The plan only ever CONSUMES credit rows, so a debit is never a candidate —
   otherwise it would re-spend the same rupee it just released. */
describe('isCreditSpendable', () => {
  const NOW = Date.parse('2026-09-27T00:00:00.000Z')
  const row = (over: Partial<CreditLedgerRow>): CreditLedgerRow => ({
    id: 'w1', amount_paise: 5000, expires_at: null, ...over,
  })

  it('accepts positive unexpired credit only', () => {
    expect(isCreditSpendable(row({}), NOW)).toBe(true)
    expect(isCreditSpendable(row({ amount_paise: 0 }), NOW)).toBe(false)
    expect(isCreditSpendable(row({ amount_paise: -9900 }), NOW)).toBe(false)
    expect(isCreditSpendable(row({ expires_at: '2026-01-01T00:00:00.000Z' }), NOW)).toBe(false)
  })

  it('never plans a debit row for consumption', () => {
    const plan = planConsumeCredit([row({ id: 'c1', amount_paise: 9900 }), row({ id: 'u1', amount_paise: -9900 })], 9900, NOW)
    expect(plan.usedTxIds).toEqual(['c1'])
    expect(plan.usedTotal).toBe(9900)
  })
})

/* The "about US$X" hint has to survive every amount the two PayPal-facing
   screens can be reached with — including a fully credit-covered order, where
   the charge is 0, and the small remainders below about ₹4.13 where the rate
   hint rounds to zero tenths. `formatUsdTenths` throws on zero, so both screens
   used to fail during render on exactly the orders where credit had done most
   of the work. */
describe('usdEstimateFor', () => {
  it('estimates from the amount actually charged, not the list price', () => {
    expect(usdEstimateFor(9900)).toBe('US$1.2')
    expect(usdEstimateFor(4900)).toBe('US$0.6')
  })
  it('never throws on a zero, negative or tiny charge', () => {
    for (const paise of [0, 1, 100, 412, 413, 4900, 9900, -5, Number.NaN]) {
      expect(() => usdEstimateFor(paise), `charge ${paise}`).not.toThrow()
      expect(usdEstimateFor(paise), `charge ${paise}`).toMatch(/^US\$\d+\.\d$/)
    }
  })
  it('degrades to one tenth rather than a thrown US$0.0', () => {
    expect(usdEstimateFor(0)).toBe('US$0.1')
    expect(usdEstimateFor(1)).toBe('US$0.1')
    expect(usdEstimateFor(412)).toBe('US$0.1')
    expect(usdEstimateFor(413)).toBe('US$0.1')
  })
})

/* The receipt screen renders the same lines in two branches (a single swap and
   a group trip). The group branch looked its label key up raw, and
   `pay.creditUsed` is "Credit used ₹{amount}" — `fill` substitutes a variable it
   was not given with an empty string, silently, so a group payment that spent
   credit printed "Credit used ₹" with no number in it. Nothing failed, because
   a missing figure that leaves a well-formed sentence behind reads as finished
   copy. Both branches must now go through one helper. */
describe('receipt labels cannot drift between the two branches', () => {
  const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
  const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
  const src = readFileSync(join(import.meta.dirname, '..', 'src/routes/pay.$requestId.done.tsx'), 'utf8')

  it('labels lines through the shared helper in both branches', () => {
    expect(src).toMatch(/const labelFor = /)
    expect((src.match(/labelFor\(line, /g) ?? []).length, 'both branches must use it').toBe(2)
  })

  it('never reaches a receipt key directly from JSX', () => {
    /* `{t(LINE_KEY[…])}` takes no variables, so any key with a placeholder
       reached that way loses its figure. */
    expect(src).not.toMatch(/\{t\(LINE_KEY\[/)
  })

  it('passes the credit amount to the one key that needs it', () => {
    expect(src).toMatch(/t\('pay\.creditUsed', \{ amount:/)
  })

  /* Both branches state the amount paid, and it must be the cash the gateway
     captured. This file has two of them and a fix landed in one: the group
     branch was corrected while the single-swap branch — the one a credit-
     covered swap actually renders — kept printing the GROSS, telling the payer
     Razorpay had taken ₹99 when it took ₹49. An edit that succeeds is not an
     edit that reached everywhere. */
  it('states the captured cash on every paid line, in both branches', () => {
    const amounts = [...src.matchAll(/t\('pay\.paidLine', \{\s*amount: ([^,]+),/g)].map((m) => m[1].trim())
    expect(amounts.length, 'both branches render paidLine').toBe(2)
    for (const expr of amounts) expect(expr).toBe('formatRupees(receipt.total)')
  })

  it('never prints the gross price as an amount paid', () => {
    /* `payment.amount_paise` is the right INPUT to splitReceipt and the wrong
       thing to print. */
    expect(src).not.toMatch(/formatRupees\(payment\.amount_paise\)/)
  })
})
