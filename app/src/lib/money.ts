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

/* PayPal estimate (docs/06: "about US$X" is an estimate only — the charge is
   always ₹99 INR = 9900 paise). The rate is a display hint, not a promise:
   integer tenths of a dollar, computed from whole paise with no float maths.
   `usdTenthsFor(chargePaise)` returns e.g. 12 for ₹99 → "US$1.2". */
export const PAYPAL_ESTIMATE_RATE_NUM = 12 as const
export const PAYPAL_ESTIMATE_RATE_DEN = 9900 as const

/** Tenths of a US dollar for a rupee charge, integer maths only. */
export function usdTenthsFor(chargePaise: number): number {
  if (!Number.isInteger(chargePaise) || chargePaise <= 0) {
    throw new Error(`amount_not_whole_paise:${chargePaise}`)
  }
  return Math.round((chargePaise * PAYPAL_ESTIMATE_RATE_NUM) / PAYPAL_ESTIMATE_RATE_DEN)
}

/** "US$1.2" from whole paise — the "about" label is added by the caller. */
export function formatUsdTenths(tenths: number): string {
  if (!Number.isInteger(tenths) || tenths <= 0) {
    throw new Error(`amount_not_whole_tenths:${tenths}`)
  }
  return `US$${Math.trunc(tenths / 10)}.${tenths % 10}`
}

/** "₹99", "-₹50". The sign belongs BEFORE the symbol: interpolating a negative
    straight after `₹` renders "₹-50", which is not how a rupee amount is
    written anywhere. The one negative this formatter is ever handed is a
    receipt's credit-used line (docs/06 "credit used (if any)"), which is a
    deduction and has to read as one. */
export function formatRupees(paise: number): string {
  const value = rupees(paise)
  const sign = value < 0 ? '-' : ''
  return `${sign}₹${Math.abs(value).toLocaleString('en-IN')}`
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
