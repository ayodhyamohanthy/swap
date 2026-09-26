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
