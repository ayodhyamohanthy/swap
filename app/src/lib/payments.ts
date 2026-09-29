/* SeatSwap payments — pure money logic (AGENTS.md rules 1-6, 9; docs/03, 06, 09).
   Money is ALWAYS integer paise. ₹99 = 9900 = ₹49 fee + ₹50 thank-you.
   Group trip: ₹199 covers up to 3 swaps (docs/04 C).
   No discounts, no coupons. Credit is never cash, expires 12 months. */

import {
  CREDIT_VALIDITY_MONTHS,
  FEE_PAISE,
  formatUsdTenths,
  GROUP_PRICE_PAISE,
  PRICE_PAISE,
  THANK_YOU_PAISE,
  usdTenthsFor,
} from './money'

export const PAY_STATES = ['created', 'pending', 'paid', 'failed'] as const
export type PayState = (typeof PAY_STATES)[number]

export type PayProviderKind = 'razorpay' | 'paypal' | 'credit' | null

export interface Quote {
  /** Full price: 9900 single, 19900 group. */
  total: number
  /** Credit applied (oldest-first upstream; here: min(balance, total)). */
  creditUsed: number
  /** Amount the provider must capture. 0 => provider 'credit'. */
  due: number
  /** Null when a provider capture is still needed. */
  provider: 'credit' | null
}

export function priceFor(isGroup: boolean): number {
  return isGroup ? GROUP_PRICE_PAISE : PRICE_PAISE
}

/** buildQuote(balancePaise, isGroup) — never negative, never over total. */
export function buildQuote(balancePaise: number, isGroup = false): Quote {
  const total = priceFor(isGroup)
  const safeBalance = Number.isFinite(balancePaise) ? Math.max(0, Math.floor(balancePaise)) : 0
  const creditUsed = Math.min(safeBalance, total)
  const due = total - creditUsed
  return { total, creditUsed, due, provider: due === 0 ? 'credit' : null }
}

/**
 * What the gateway will actually take — the one number every pay screen that
 * names an amount must agree on. A payment row's own figures win when one
 * exists, because those are what the provider was handed; otherwise the quote
 * the payer was shown is the only honest answer.
 *
 * This exists because the two screens disagreed. `pay.$requestId.upi.tsx` read
 * `payment ? amount - credit : 0`, so on a refresh, a shared link, or a cleared
 * profile — anywhere the request is still payable but no payment row exists yet
 * — the screen told the passenger to **"Approve ₹0 in your UPI app"**. Zero is
 * not a missing value on a payment screen; it is a number, and stating one you
 * do not mean is worse than stating none. `paypal.tsx` had already solved the
 * same problem correctly by falling back to the quote, which is exactly how two
 * inline copies drift apart. One function, so they cannot drift again.
 */
export function chargeDuePaise(
  payment: { amount_paise: number; credit_used_paise: number } | undefined,
  quote: Quote,
): number {
  const charged = payment ? payment.amount_paise - payment.credit_used_paise : quote.due
  return Number.isFinite(charged) ? Math.max(0, Math.floor(charged)) : quote.due
}

/**
 * The "about US$X" hint for a charge, floored at one tenth.
 *
 * Both PayPal-facing screens compute this from the amount the payer is actually
 * charged, so a credit-covered order estimates on what is left (money.test.ts
 * pins that: ₹49 → "US$0.6", not "US$1.2"). But the rate hint rounds to zero
 * below about ₹4.13 — and `formatUsdTenths` *throws* on zero. So any small
 * remainder, including the `due = 0` of a fully credit-covered order, took the
 * screen down during render: a crash on the one screen whose entire job is to
 * state an amount. `Math.max(…, 1)` in the two callers only guarded the ≤ 0
 * case, which is not where the round-to-zero happens.
 *
 * One function so the two screens cannot drift, and a floor so the estimate
 * degrades to a coarse "about US$0.1" instead of throwing.
 */
export function usdEstimateFor(chargePaise: number): string {
  const safe = Number.isFinite(chargePaise) ? Math.max(Math.floor(chargePaise), 1) : 1
  return formatUsdTenths(Math.max(usdTenthsFor(safe), 1))
}

export interface ReceiptLine {
  label: string
  amountPaise: number
}

export interface Receipt {
  lines: ReceiptLine[]
  /** Always `sum(lines)` — the cash the gateway captured, never the gross price. */
  total: number
}

/**
 * Receipt lines: fee ₹49 · thank-you ₹50 · credit used (if any) · Total (docs/06).
 *
 * The Total is what the gateway actually captured, and the lines above it SUM
 * to it — the one property a receipt has to have. It did not have it. `total`
 * returned the full ₹99 while a credit-used line subtracted ₹50 from the list,
 * so a credit-covered swap printed
 *
 *     SeatSwap fee            ₹49
 *     Thank-you credit ₹50
 *     Credit used             -₹50
 *     Total                   ₹99
 *
 * and no arithmetic reaches that total. Design 29b's lines sum to its total
 * exactly; design 29a states the same split in words — "₹49 + ₹50 credit". The
 * gross ₹99 is still the headline everywhere it belongs (`pay.under`, the
 * method screen, the history row); it is just not what a *Total* means.
 *
 * `total` is therefore derived from `lines` rather than stated alongside them,
 * so the two cannot disagree again. `grossPaise` is the payment row's
 * `amount_paise`, which is GROSS (see `admin.ts` `collectedPaise`, which
 * subtracts credit for the same reason); it is what bounds the credit, so a
 * malformed row cannot produce a negative Total.
 */
export function splitReceipt(grossPaise: number, creditUsed: number, isGroup = false): Receipt {
  const gross = Number.isFinite(grossPaise) ? Math.max(0, Math.floor(grossPaise)) : 0
  const used = Number.isFinite(creditUsed) ? Math.max(0, Math.min(Math.floor(creditUsed), gross)) : 0
  const lines: ReceiptLine[] = isGroup
    ? [
        { label: 'group_cover', amountPaise: GROUP_PRICE_PAISE },
        ...(used > 0 ? [{ label: 'credit_used', amountPaise: -used } as ReceiptLine] : []),
      ]
    : [
        { label: 'fee', amountPaise: FEE_PAISE },
        { label: 'thank_you', amountPaise: THANK_YOU_PAISE },
        ...(used > 0 ? [{ label: 'credit_used', amountPaise: -used } as ReceiptLine] : []),
      ]
  const total = lines.reduce((sum, line) => sum + line.amountPaise, 0)
  return { lines, total }
}

/** Minimal wallet row shape the credit planner needs. */
export interface CreditLedgerRow { id: string; amount_paise: number; expires_at: string | null }

/** Is this row still live? `wallet_tx` is a SIGNED ledger (docs/02: "balance =
    sum(amount) where not expired", schema.part3): spends are `used` rows with a
    negative amount and no expiry, so a row with no expiry is permanently live.
    A row with an unparseable expiry is treated as live rather than silently
    becoming zero. */
export function isCreditLive(row: CreditLedgerRow, nowMs: number): boolean {
  if (row.expires_at === null || !Number.isFinite(Date.parse(row.expires_at))) return true
  return Date.parse(row.expires_at) > nowMs
}

/** A row a payment may actually CONSUME: positive and unexpired. Only these
    are candidates to be spent; the balance below is a separate question. */
export function isCreditSpendable(row: CreditLedgerRow, nowMs: number): boolean {
  return row.amount_paise > 0 && isCreditLive(row, nowMs)
}

/** Spendable credit balance in paise at `nowMs` — the signed sum of every live
    row, debits included, floored at zero.

    Filtering negatives out (rather than subtracting them) let an already-spent
    ₹99 keep funding swaps for ever: `[+9900, -9900]` still quoted 9900, so the
    same credit paid for any number of ₹99 swaps and the ₹49 fee was never
    collected. The local mirror already summed negatives (store.creditPaise),
    so server and device disagreed about what a wallet was worth. */
export function spendableCreditPaise(rows: CreditLedgerRow[], nowMs: number): number {
  const total = rows.reduce((sum, r) => (isCreditLive(r, nowMs) ? sum + r.amount_paise : sum), 0)
  return Math.max(0, total)
}

/**
 * Which credit rows a payment spends, earliest expiry first (docs/06). Rows are
 * never partially consumed on the ledger: the plan records the ids and the total
 * actually spent, so a later failure can be reconciled against `wallet_tx`.
 */
export function planConsumeCredit(
  rows: CreditLedgerRow[], neededPaise: number, nowMs: number,
): { usedTxIds: string[]; usedTotal: number } {
  const need = Math.max(0, Math.floor(neededPaise))
  if (need === 0) return { usedTxIds: [], usedTotal: 0 }
  const open = rows
    .filter((r) => isCreditSpendable(r, nowMs))
    .sort((a, b) => {
      if (a.expires_at === null) return 1
      if (b.expires_at === null) return -1
      return Date.parse(a.expires_at) - Date.parse(b.expires_at)
    })
  const usedTxIds: string[] = []
  let remaining = need
  let usedTotal = 0
  for (const row of open) {
    if (remaining <= 0) break
    usedTxIds.push(row.id)
    const take = Math.min(row.amount_paise, remaining)
    usedTotal += take
    remaining -= take
  }
  return { usedTxIds, usedTotal }
}

/** nextPayState machine: created → pending → paid | failed. Terminal states stick. */
export function nextPayState(from: PayState, event: 'authorize' | 'capture' | 'fail'): PayState {
  if (from === 'created' && event === 'authorize') return 'pending'
  if (from === 'created' && event === 'capture') return 'paid'
  if (from === 'pending' && event === 'capture') return 'paid'
  if ((from === 'created' || from === 'pending') && event === 'fail') return 'failed'
  return from
}

export type PayOutcome = 'swapped' | 'no_show' | 'not_possible' | 'changed_mind' | 'failed_bank'

export interface CreditAward {
  to: 'requester' | 'none'
  amountPaise: number
  kind: 'swap_to_credit' | null
  expiresMonths: number | null
}

/**
 * outcomeToCredit — swap didn't happen → ₹99 to requester credit (never bank).
 * Only exception: failed-bank (money auto-returned by bank in 3–5 days).
 */
export function outcomeToCredit(outcome: PayOutcome): CreditAward {
  if (outcome === 'swapped') return { to: 'none', amountPaise: 0, kind: null, expiresMonths: null }
  if (outcome === 'failed_bank')
    return { to: 'none', amountPaise: 0, kind: null, expiresMonths: null }
  return {
    to: 'requester',
    amountPaise: PRICE_PAISE,
    kind: 'swap_to_credit',
    expiresMonths: CREDIT_VALIDITY_MONTHS,
  }
}

/** Receipt numbers look like SS-10482 (docs/06). Never sequential-guessable client-side. */
export function receiptNumber(seed: number): string {
  const n = 10000 + (Math.abs(Math.floor(seed)) % 90000)
  return `SS-${n}`
}

export const THANK_YOU_CREDIT_MONTHS = CREDIT_VALIDITY_MONTHS
