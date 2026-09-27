/* SeatSwap payments — pure money logic (AGENTS.md rules 1-6, 9; docs/03, 06, 09).
   Money is ALWAYS integer paise. ₹99 = 9900 = ₹49 fee + ₹50 thank-you.
   Group trip: ₹199 covers up to 3 swaps (docs/04 C).
   No discounts, no coupons. Credit is never cash, expires 12 months. */

import {
  CREDIT_VALIDITY_MONTHS,
  FEE_PAISE,
  GROUP_PRICE_PAISE,
  PRICE_PAISE,
  THANK_YOU_PAISE,
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

export interface ReceiptLine {
  label: string
  amountPaise: number
}

export interface Receipt {
  lines: ReceiptLine[]
  total: number
}

/** Receipt lines: fee ₹49 · thank-you ₹50 · credit used (if any) · total. */
export function splitReceipt(duePaid: number, creditUsed: number, isGroup = false): Receipt {
  const paid = Math.max(0, Math.floor(duePaid))
  const used = Math.max(0, Math.floor(creditUsed))
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
  void paid
  return { lines, total: isGroup ? GROUP_PRICE_PAISE : PRICE_PAISE }
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
