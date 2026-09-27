/* SeatSwap server payments — part 1: types + validators (docs/06).
   Secrets come from server env only, never returned to the browser. */
import { razorpayCreateOrder } from './razorpay-client'
import { depsFromEnv } from './payments-helpers'
import { resolveCaller, refetchRow } from './functions'
import { getSupabase } from '@/lib/supabase'
import { createServerFn } from '@tanstack/react-start'
import { buildQuote, priceFor } from '@/lib/payments'

export type RequestStatus = 'draft' | 'searching' | 'accepted_awaiting_payment'
  | 'locked' | 'confirmed' | 'voided' | 'disputed' | 'expired' | 'withdrawn'
export interface SwapRequestRow { id: string; requester_id: string; status: RequestStatus }
export interface PaymentRow {
  id: string; request_id: string; payer_id: string
  provider: 'razorpay' | 'paypal' | 'credit'; provider_ref: string | null
  amount_paise: number; credit_used_paise: number; currency: 'INR'
  status: 'created' | 'pending' | 'paid' | 'failed'
}
export interface RazorpayOrder {
  order_id: string; amount_paise: number; currency: 'INR'
  receipt: string; key_id: string; credit_used_paise: number
}
export function serverEnv(name: string): string {
  const v = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.[name]
  if (!v) throw new Error(`missing_env:${name}`)
  return v
}
/** Caller must be requester + request awaiting payment (docs/06 Razorpay 1). */
export function assertCanPay(request: SwapRequestRow, callerId: string): void {
  if (request.requester_id !== callerId) throw new Error('not_requester')
  if (request.status !== 'accepted_awaiting_payment') throw new Error('not_awaiting_payment')
}
/** Minimal wallet row shape the credit planner needs (server-side ledger read). */
export interface CreditLedgerRow { id: string; amount_paise: number; expires_at: string | null }

export function planConsumeCredit(
  rows: CreditLedgerRow[], neededPaise: number, nowMs: number,
): { usedTxIds: string[]; usedTotal: number } {
  const need = Math.max(0, Math.floor(neededPaise))
  if (need === 0) return { usedTxIds: [], usedTotal: 0 }
  const open = rows
    .filter((r) => r.amount_paise > 0
      && (r.expires_at === null || Number.isFinite(Date.parse(r.expires_at)) === false || Date.parse(r.expires_at) > nowMs))
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
    const take = Math.min(row.amount_paise, remaining)
    usedTxIds.push(row.id)
    usedTotal += take
    remaining -= take
  }
  return { usedTxIds, usedTotal }
}
export const createRazorpayOrder = createServerFn({ method: 'POST' })
  .validator((input: { requestId: string; isGroup?: boolean; callerId?: string }) => input)
  .handler(async ({ data }): Promise<RazorpayOrder & { payment_id: string; provider: 'razorpay' | 'credit' }> => {
    /* docs/06 Razorpay 1: only the requester, only while awaiting payment, for
       price-minus-credit with oldest-first consumption. A payment row is
       inserted BEFORE the gateway order so webhooks can reconcile. */
    const client = await getSupabase()
    if (!client) throw new Error('backend_unconfigured')
    const callerId = await resolveCaller(client, data.callerId ?? '')
    if (!callerId) throw new Error('not_signed_in')
    const request = await refetchRow<SwapRequestRow | null>(client, 'swap_requests', data.requestId, null)
    if (!request) throw new Error('request_not_found')
    assertCanPay(request, callerId)
    const isGroup = data.isGroup === true
    const total = priceFor(isGroup)
    const walletQuery = (client.from('wallet_tx').select('id,amount_paise,expires_at').eq('user_id', callerId) as unknown as Promise<{ data: CreditLedgerRow[] | null; error: unknown }>)
    const { data: ledger, error: ledgerError } = await walletQuery
    if (ledgerError) throw new Error('wallet_unreadable')
    const quote = buildQuote(
      (ledger ?? []).reduce((sum, r) => sum + (r.amount_paise > 0 ? r.amount_paise : 0), 0),
      isGroup,
    )
    const consumed = planConsumeCredit(ledger ?? [], quote.creditUsed, Date.now())
    if (consumed.usedTotal > 0) {
      const useRow = (client.from('wallet_tx').insert({
        user_id: callerId, amount_paise: -consumed.usedTotal, kind: 'used',
        ref_request_id: data.requestId, expires_at: null,
      }) as unknown as Promise<{ error: unknown }>)
      const { error: useError } = await useRow
      if (useError) throw new Error('credit_unusable')
    }
    if (quote.due === 0) {
      /* Fully covered by credit: no gateway order; instant lock path. */
      const payRow = (client.from('payments').insert({
        request_id: data.requestId, payer_id: callerId, provider: 'credit',
        provider_ref: null, amount_paise: total, credit_used_paise: consumed.usedTotal,
        currency: 'INR', status: 'paid',
      }).select('id').single() as unknown as Promise<{ data: { id: string } | null; error: unknown }>)
      const { data: paid, error: paidError } = await payRow
      if (paidError || !paid) throw new Error('payment_unrecorded')
      return {
        order_id: '', amount_paise: 0, currency: 'INR', receipt: data.requestId,
        key_id: '', credit_used_paise: consumed.usedTotal,
        payment_id: paid.id, provider: 'credit',
      }
    }
    const payRow = (client.from('payments').insert({
      request_id: data.requestId, payer_id: callerId, provider: 'razorpay',
      provider_ref: null, amount_paise: total, credit_used_paise: consumed.usedTotal,
      currency: 'INR', status: 'created',
    }).select('id').single() as unknown as Promise<{ data: { id: string } | null; error: unknown }>)
    const { data: created, error: createdError } = await payRow
    if (createdError || !created) throw new Error('payment_unrecorded')
    /* Real Orders API call. A failure here throws ProviderUnavailableError, which
       the pay screen maps to "could not start payment — try again" WITHOUT locking
       anything (docs/06: nothing is held until money is actually captured). */
    const order = await razorpayCreateOrder(depsFromEnv(), {
      amountPaise: quote.due,
      receipt: created.id,
      requestId: data.requestId,
    })
    return {
      order_id: order.order_id,
      amount_paise: order.amount_paise,
      currency: 'INR',
      receipt: order.receipt,
      key_id: order.key_id,
      credit_used_paise: consumed.usedTotal,
      payment_id: created.id,
      provider: 'razorpay',
    }
  })
