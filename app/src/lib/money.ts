/* SeatSwap money rules (AGENTS.md, docs/03 money outcomes table).
   Money is ALWAYS an integer number of paise. ₹99 = 9900.
   Nothing in steps 1-2 can change a balance: the wallet is a ledger the
   payment/acceptor steps write to, and it starts empty (no free rewards). */

/** ₹99 — one swap: ₹49 SeatSwap fee + ₹50 thank-you credit to the acceptor. */
export const PRICE_PAISE = 9900 as const
/** ₹49 — SeatSwap's fee, kept only when a swap actually happens. */
export const FEE_PAISE = 4900 as const
/** ₹50 — thank-you credit for the traveller who helps. Never cash. */
export const THANK_YOU_PAISE = 5000 as const
/** ₹199 — group trip, covers up to 3 swaps (docs/01, build step 10). */
export const GROUP_PRICE_PAISE = 19900 as const
/** A paid group trip covers at most this many locked swaps (docs/01). */
export const GROUP_MAX_SWAPS = 3 as const
/** Credit is valid for 12 months from the day it is earned. */
export const CREDIT_VALIDITY_MONTHS = 12 as const

export const PAYMENT_PROVIDERS = ['razorpay', 'paypal', 'credit'] as const
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number]

/** ₹99 must always equal fee + thank-you. Guarded by tests. */
export const PRICE_SPLIT_OK =
  FEE_PAISE + THANK_YOU_PAISE === PRICE_PAISE ? true : false

/** Whole rupees for display. The ₹ sign is a currency symbol, not copy. */
export function rupees(paise: number): number {
  return Math.round(paise / 100)
}

export function formatRupees(paise: number): string {
  return `₹${rupees(paise).toLocaleString('en-IN')}`
}

/** Decimal string for payment-gateway wire formats. Razorpay takes integer
    paise; PayPal takes "99.00". Never send a float to either (docs/02), and
    never round: build the string from the integer parts. */
export function paiseToDecimalString(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error(`amount_not_whole_paise:${paise}`)
  }
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const whole = Math.trunc(abs / 100)
  const fraction = abs % 100
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`
}

/** Inverse of `paiseToDecimalString`, for reading an amount back off the wire
    (a PayPal capture receipt). Integer maths only — parsing "99.00" through a
    float and re-rounding is how a rupee of someone's money disappears.
    Returns null for anything that is not a plain 1-2 decimal amount, so a
    malformed gateway field is never silently read as zero. */
export function decimalStringToPaise(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const whole = Number(match[1])
  if (!Number.isSafeInteger(whole)) return null
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  const paise = whole * 100 + fraction
  return Number.isSafeInteger(paise) ? paise : null
}
