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
import { getGroup, isGroupRequestId, markGroupPaid } from './groups'
import { getRequest, lockRequest, type RequestStatus, type SwapRequest } from './requests'

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
 * Group checkout (docs/01, docs/04 C): one ₹199 payment marks the whole trip
 * paid. Idempotent like startPayment: an already-paid group never charges
 * twice. Credit may cover part or all of it, oldest-first, spent only when
 * money lands (rule 6).
 */
export function beginGroupCheckout(
  groupId: string,
  provider: Exclude<CheckoutProvider, 'credit'>,
  useCredit = true,
  creditOverridePaise?: number,
): CheckoutTicket {
  const group = getGroup(groupId)
  if (!group) throw new CheckoutError('request_not_found')
  if (group.paid) {
    const row = paymentFor(groupId)
    if (!row) throw new CheckoutError('payment_not_found')
    return ticket(row, true)
  }
  const existing = paymentFor(groupId)
  if (existing && (existing.status === 'paid' || existing.status === 'pending')) {
    return ticket(existing, existing.status === 'paid')
  }
  const quote = buildQuote(creditToUse(useCredit, creditOverridePaise), true)
  if (quote.due === 0) {
    const row = startPayment({
      request_id: groupId,
      provider: 'credit',
      amount_paise: quote.total,
      credit_used_paise: quote.creditUsed,
      status: 'paid',
    })
    spendCredit(row)
    markGroupPaid(groupId)
    return ticket(row, true)
  }
  const created = startPayment({
    request_id: groupId,
    provider,
    amount_paise: quote.total,
    credit_used_paise: quote.creditUsed,
  })
  const pending = setPaymentStatus(created.id, 'pending') ?? created
  return ticket(pending, false)
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
  /* When the server has already priced the order (PayPal), it tells us exactly
     how much credit it covered. Reuse that figure instead of recomputing it
     locally, or the two disagree and the payer is charged for credit twice. */
  creditOverridePaise?: number,
): CheckoutTicket {
  /* Group trips pay ₹199 once (docs/01, docs/04 C): no acceptance needed, the
     payment marks the group paid and covers up to GROUP_MAX_SWAPS locks. */
  if (isGroup || isGroupRequestId(requestId)) {
    return beginGroupCheckout(requestId, provider, useCredit, creditOverridePaise)
  }
  const request = getRequest(requestId)
  if (!request) throw new CheckoutError('request_not_found')
  const state = payableStatus(request.status)
  if (state === 'not_yet') throw new CheckoutError('not_awaiting_payment')

  const existing = paymentFor(requestId)
  if (existing && (existing.status === 'paid' || existing.status === 'pending')) {
    return ticket(existing, request.status === 'locked' || existing.status === 'paid')
  }

  const quote = buildQuote(creditToUse(useCredit, creditOverridePaise), isGroup)
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
  if (row.status === 'paid') {
    if (isGroupRequestId(requestId)) {
      /* Heal a crash between payment and marking (idempotent). */
      markGroupPaid(requestId)
      return ticket(row, true)
    }
    const request = getRequest(requestId)
    if (!request) throw new CheckoutError('request_not_found')
    return ticket(row, request.status === 'locked')
  }
  if (row.status === 'failed') throw new CheckoutError('payment_failed')
  const paid = setPaymentStatus(row.id, 'paid', providerRef) ?? row
  if (isGroupRequestId(requestId)) {
    markGroupPaid(requestId)
    spendCredit(paid)
    return ticket(paid, true)
  }
  /* Lock FIRST, and only trust the lock. If the request stopped being payable
     while the gateway was confirming (withdrawn, expired, another offer took
     it), the money is genuinely captured but no swap happened — rule 6 sends
     that ₹99 to the requester's credit through the outcome path, so the
     planned credit spend must NOT happen here and no screen may claim a lock. */
  if (!lockRequest(requestId)) return ticket(paid, false)
  spendCredit(paid)
  return ticket(paid, true)
}

/** The gateway said no: nothing is charged and no credit is spent (rule 6). */
export function markFailed(requestId: string): CheckoutTicket {
  const row = paymentFor(requestId)
  if (!row) throw new CheckoutError('payment_not_found')
  const failed = setPaymentStatus(row.id, 'failed') ?? row
  return ticket(failed, false)
}

/**
 * Lock a member swap covered by a paid group trip (docs/04 C): no per-swap
 * payment, but the group must be paid and the GROUP_MAX_SWAPS cap enforced.
 * Throws `not_awaiting_payment`, `group_unpaid`, or `group_swap_cap`.
 */
export function lockCoveredRequest(requestId: string): SwapRequest {
  const request = getRequest(requestId)
  if (!request) throw new CheckoutError('request_not_found')
  if (request.status !== 'accepted_awaiting_payment') throw new CheckoutError('not_awaiting_payment')
  if (!request.group_id) throw new CheckoutError('group_unpaid')
  const group = getGroup(request.group_id)
  if (!group?.paid) throw new CheckoutError('group_unpaid')
  const locked = lockRequest(requestId)
  if (!locked) throw new CheckoutError('not_awaiting_payment')
  return locked
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

/** The balance to quote from. A server-priced figure wins, but it is still
    clamped to what this wallet really holds so no caller can credit itself. */
function creditToUse(useCredit: boolean, overridePaise?: number): number {
  if (overridePaise === undefined) return useCredit ? creditAvailable() : 0
  const claimed = Number.isFinite(overridePaise) ? Math.floor(overridePaise) : 0
  return Math.max(0, Math.min(claimed, creditAvailable()))
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
