/* SeatSwap outcomes — Did-you-swap confirmations (docs/03 state machine, docs/04
   A13-14/B6, docs/09 copy). Pure logic: no I/O, so it is unit-testable.
   Rules: both swapped → confirmed (acceptor +₹50 credit, 12mo expiry);
   agreed no_show/not_possible/changed_mind or any cancel after pay → voided
   (requester +₹99 credit); answers differ → disputed (no promised time);
   silence 12h after arrival → confirmed. */

import { CREDIT_VALIDITY_MONTHS, PRICE_PAISE, THANK_YOU_PAISE } from './money'

export const CONFIRM_OPTIONS = ['swapped', 'no_show', 'not_possible', 'changed_mind'] as const
export type ConfirmOutcome = (typeof CONFIRM_OPTIONS)[number]

export type SwapStatus = 'locked' | 'confirmed' | 'voided' | 'disputed'

export interface CreditWrite {
  to: 'requester' | 'acceptor'
  amountPaise: number
  kind: 'acceptor_credit' | 'swap_to_credit'
  expiresMonths: number
}

export interface Resolution {
  status: SwapStatus
  credits: CreditWrite[]
  /** i18n key suffix for the result screen. */
  resultKey: 'swapped' | 'credit_added' | 'disputed' | 'earned_50'
}

const TWELVE_MONTHS = CREDIT_VALIDITY_MONTHS

/** Resolve two sides' answers into a terminal swap state. */
export function resolveConfirmations(
  requester: ConfirmOutcome,
  acceptor: ConfirmOutcome,
): Resolution {
  if (requester === 'swapped' && acceptor === 'swapped') {
    return {
      status: 'confirmed',
      credits: [
        { to: 'acceptor', amountPaise: THANK_YOU_PAISE, kind: 'acceptor_credit', expiresMonths: TWELVE_MONTHS },
      ],
      resultKey: 'swapped',
    }
  }
  if (requester === acceptor) {
    // Agreed it didn't happen — requester gets ₹99 credit, never bank.
    return {
      status: 'voided',
      credits: [
        { to: 'requester', amountPaise: PRICE_PAISE, kind: 'swap_to_credit', expiresMonths: TWELVE_MONTHS },
      ],
      resultKey: 'credit_added',
    }
  }
  return { status: 'disputed', credits: [], resultKey: 'disputed' }
}

/** Cancel after payment (either side, PNR cancelled, berth changed) → voided + ₹99 credit. */
export function cancelAfterPay(): Resolution {
  return {
    status: 'voided',
    credits: [
      { to: 'requester', amountPaise: PRICE_PAISE, kind: 'swap_to_credit', expiresMonths: TWELVE_MONTHS },
    ],
    resultKey: 'credit_added',
  }
}

export const AUTO_CONFIRM_SILENT_HOURS = 12 as const

/** Auto-confirm 12h after arrival when one side stays silent. */
export function shouldAutoConfirm(nowMs: number, arrivalMs: number, answeredCount: 0 | 1 | 2): boolean {
  if (answeredCount === 2) return false
  return nowMs - arrivalMs >= AUTO_CONFIRM_SILENT_HOURS * 60 * 60 * 1000
}

/** Expires-at for any credit earned now (12 months, never cash). */
export function creditExpiresAt(nowMs: number): string {
  const d = new Date(nowMs)
  d.setMonth(d.getMonth() + TWELVE_MONTHS)
  return d.toISOString()
}
