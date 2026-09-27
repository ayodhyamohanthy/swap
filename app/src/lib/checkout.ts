/* SeatSwap checkout — the one place that turns "someone accepted" into a paid,
   locked swap (docs/03 payment machine, docs/06, AGENTS rules 2-6).

   Local-first: the ledger lives in `lib/store` until step-3 sync gives server
   ids, and `@/server/payments` runs the same rules against Supabase + the real
   gateways. Either way the invariants are identical:
   - paying is only possible while the request is `accepted_awaiting_payment`;
     nothing is charged before an acceptance (rule 2);
   - credit is applied earliest-expiry-first and only spent when money actually
     lands, so a failed payment leaves the balance untouched (rule 6);
   - a fully covered payment needs no gateway and locks instantly (docs/06);
   - `lockRequest` runs on `paid` and only on `paid`, superseding other offers. */

import {
  creditPaise,
  paymentFor,
  setPaymentStatus,
  startPayment,
  useCredit,
  type PaymentRow,
} from './store'
import { buildQuote } from './payments'
import { isSupabaseConfigured } from './supabase'
import { getRequest, lockRequest, type RequestStatus } from './requests'

export type CheckoutProvider = 'razorpay' | 'paypal' | 'credit'

export interface CheckoutTicket {
  paymentId: string
  provider: CheckoutProvider
  /** What the gateway still has to capture, paise. 0 => credit-only. */
  due: number
  creditUsed: number
  total: number
  /** True when the swap is already paid for and locked. */
  settled: boolean
  status: PaymentRow['status']
}

export class CheckoutError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'CheckoutError'
    this.code = code
  }
}

/** Payable now, or already paid? Anything else is a rule-2 violation. */
export function payableStatus(status: RequestStatus | undefined): 'payable' | 'already_paid' | 'not_yet' {
  if (status === 'locked' || status === 'confirmed' || status === 'disputed') return 'already_paid'
  if (status === 'accepted_awaiting_payment') return 'payable'
  return 'not_yet'
}

/**
 * Open the payment for a request and take it as far as it goes without money:
 * credit-only settles and locks here; a gateway payment is left `pending` for
 * `confirmCaptured` (the webhook, or the status screen while offline).
 */
export function beginCheckout(
  requestId: string,
  provider: Exclude<CheckoutProvider, 'credit'>,
  isGroup = false,
  useCredit = true,
): CheckoutTicket {
  const request = getRequest(requestId)
  if (!request) throw new CheckoutError('request_not_found')
  const state = payableStatus(request.status)
  if (state === 'not_yet') throw new CheckoutError('not_awaiting_payment')

  const existing = paymentFor(requestId)
  if (existing && (existing.status === 'paid' || existing.status === 'pending')) {
    return ticket(existing, request.status === 'locked' || existing.status === 'paid')
  }

  const quote = buildQuote(useCredit ? creditAvailable() : 0, isGroup)
  if (quote.due === 0) {
    /* Fully covered by credit: no provider call, instant lock (docs/06). */
    const row = startPayment({
      request_id: requestId,
      provider: 'credit',
      amount_paise: quote.total,
      credit_used_paise: quote.creditUsed,
      status: 'paid',
    })
    spendCredit(row)
    lockRequest(requestId)
    return ticket(row, true)
  }

  const created = startPayment({
    request_id: requestId,
    provider,
    amount_paise: quote.total,
    credit_used_paise: quote.creditUsed,
  })
  const pending = setPaymentStatus(created.id, 'pending') ?? created
  return ticket(pending, false)
}

/**
 * Money landed. Spend the planned credit, mark the payment paid and lock the
 * swap — in that order, so a crash before the lock can never leave money gone
 * with the request still open to another acceptor.
 */
export function confirmCaptured(requestId: string, providerRef?: string): CheckoutTicket {
  const row = paymentFor(requestId)
  if (!row) throw new CheckoutError('payment_not_found')
  const request = getRequest(requestId)
  if (!request) throw new CheckoutError('request_not_found')
  if (row.status === 'paid') return ticket(row, request.status === 'locked')
  if (row.status === 'failed') throw new CheckoutError('payment_failed')
  const paid = setPaymentStatus(row.id, 'paid', providerRef) ?? row
  spendCredit(paid)
  lockRequest(requestId)
  return ticket(paid, true)
}

/** The gateway said no: nothing is charged and no credit is spent (rule 6). */
export function markFailed(requestId: string): CheckoutTicket {
  const row = paymentFor(requestId)
  if (!row) throw new CheckoutError('payment_not_found')
  const failed = setPaymentStatus(row.id, 'failed') ?? row
  return ticket(failed, false)
}

function spendCredit(row: PaymentRow): void {
  if (row.credit_used_paise > 0) useCredit(row.credit_used_paise, row.request_id)
}

function ticket(row: PaymentRow, settled: boolean): CheckoutTicket {
  return {
    paymentId: row.id,
    provider: row.provider,
    total: row.amount_paise,
    creditUsed: row.credit_used_paise,
    due: Math.max(0, row.amount_paise - row.credit_used_paise),
    settled,
    status: row.status,
  }
}

/** Credit the payer can actually spend right now, paise. */
function creditAvailable(): number {
  return creditPaise()
}

/**
 * True when a real gateway + webhook back the payment. Without backend keys the
 * app is a demo on one device: "Check status" settles the pending payment
 * locally so the whole swap can still be walked through, and the receipt screen
 * says so (docs/10 "sample receipt on this device").
 */
export function gatewayLive(): boolean {
  return isSupabaseConfigured()
}
