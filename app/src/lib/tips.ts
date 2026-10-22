/* SeatSwap tips — a cash thank-you from the requester that lands as 100%
   credit for the helper (owner rulings 2026-10-21: tips approved; no split;
   requesters pay cash, helpers are credited in credits, never cash; no
   refunds; one tip per swap).

   Invariants, matching the payment rules they sit beside:
   - a tip exists only AFTER the swap is confirmed done (rule: no tipping a
     stranger, no tipping before the help actually happened);
   - the amount is always one of TIP_PRESETS_PAISE, paid in full by the
     requester through the gateway — credit_used_paise is ALWAYS 0, because
     credit paying for credit is circular;
   - the helper's credit is written only from a PAID payment, and the write is
     idempotent on the payment id, so a double webhook or a retried capture
     can never mint the credit twice;
   - there is no refund path: a captured tip is final. */

import { TIP_PRESETS_PAISE } from './money'
import { getRequest } from './requests'
import {
  credit,
  getPayment,
  paymentFor,
  startPayment,
  walletTxForRef,
  type PaymentRow,
  type WalletTx,
} from './store'

/* Tip payment rows are keyed `tip:<requestId>` — never the bare request id,
   or `paymentFor(requestId)` would read a tip as the swap's own ₹100 payment
   and the pay screens would report the swap already paid. */
export function tipPaymentKey(requestId: string): string {
  return `tip:${requestId}`
}

export function isTipPaymentKey(requestId: string): boolean {
  return requestId.startsWith('tip:')
}

/** The tip payment for a swap, if one was ever started. */
export function tipPaymentFor(requestId: string): PaymentRow | undefined {
  return paymentFor(tipPaymentKey(requestId))
}

export type TipGate = 'tippable' | 'missing' | 'not_confirmed' | 'already_tipped'

/**
 * May this swap be tipped right now? Only a confirmed-done swap, and only
 * once. A live tip payment (created/pending/paid) already counts — a payer
 * double-tapping during the gateway handoff must not open a second charge.
 * A FAILED tip does not block: the payer is allowed to retry, and the failed
 * row keeps the audit trail honest.
 */
export function tipGateFor(requestId: string): TipGate {
  const request = getRequest(requestId)
  if (!request) return 'missing'
  if (request.status !== 'confirmed') return 'not_confirmed'
  const existing = tipPaymentFor(requestId)
  if (existing && existing.status !== 'failed') return 'already_tipped'
  return 'tippable'
}

export class TipError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'TipError'
    this.code = code
  }
}

/**
 * Start a tip: validates the preset and the gate, then opens the payment row
 * BEFORE any gateway call — the same order the swap payment uses, so the
 * webhook always has a row to reconcile against. `credit_used_paise` is
 * hard-pinned to 0: a tip is cash-only by rule.
 */
export function beginTip(
  requestId: string,
  amountPaise: number,
  provider: 'razorpay' | 'paypal',
): PaymentRow {
  if (!(TIP_PRESETS_PAISE as readonly number[]).includes(amountPaise)) {
    throw new TipError('bad_tip_amount')
  }
  const gate = tipGateFor(requestId)
  if (gate !== 'tippable') throw new TipError(gate)
  return startPayment({
    request_id: tipPaymentKey(requestId),
    provider,
    amount_paise: amountPaise,
    credit_used_paise: 0,
  })
}

/**
 * Turn a captured tip into the helper's credit. 100% of the amount, as
   `tip_credit`, 12-month validity from the write (the store recomputes the
   expiry itself). Idempotent on the payment id: a repeated capture event or
   webhook returns the row it already wrote. Anything that is not a PAID tip
   payment writes nothing — a pending tip is money in flight, and a failed tip
   is no money at all; neither may mint credit.
 */
export function settleTip(paymentId: string): WalletTx | undefined {
  const payment = getPayment(paymentId)
  if (!payment || payment.request_id === null || !isTipPaymentKey(payment.request_id)) return undefined
  if (payment.status !== 'paid') return undefined
  const existing = walletTxForRef(payment.id)
  if (existing) return existing
  return credit({
    to: 'acceptor',
    amountPaise: payment.amount_paise,
    kind: 'tip_credit',
    ref_request_id: payment.id,
  })
}
