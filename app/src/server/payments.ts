/* SeatSwap server payments — part 1: types + validators (docs/06).
   Secrets come from server env only, never returned to the browser. */
import { razorpayCreateOrder } from './razorpay-client'
import { depsFromEnv } from './payments-helpers'
import { resolveCaller, refetchRow, type SupaClient } from './functions'
import { getSupabase } from '@/lib/supabase'
import { createServerFn } from '@tanstack/react-start'
import { buildQuote, priceFor, spendableCreditPaise } from '@/lib/payments'

export type RequestStatus = 'draft' | 'searching' | 'accepted_awaiting_payment'
  | 'locked' | 'confirmed' | 'voided' | 'disputed' | 'expired' | 'withdrawn'
export interface SwapRequestRow { id: string; requester_id: string; status: RequestStatus }
export interface PaymentRow {
  id: string; request_id: string | null; group_id: string | null; payer_id: string
  provider: 'razorpay' | 'paypal' | 'credit'; provider_ref: string | null
  amount_paise: number; credit_used_paise: number; currency: 'INR'
  status: 'created' | 'pending' | 'paid' | 'failed'
}
export interface GroupRow { id: string; organiser_id: string; name: string }
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
export type { CreditLedgerRow } from '@/lib/payments'
/* The oldest-first credit plan is shared with the local-first checkout path. */
export { planConsumeCredit } from '@/lib/payments'
import { planConsumeCredit, type CreditLedgerRow } from '@/lib/payments'
/** Everything a gateway order needs: what the payer owes, how much credit is
    covering it, and the `payments` row webhooks reconcile against. Shared by
    Razorpay and PayPal so the two paths can never disagree about the amount —
    they used to charge different totals for the same swap (PayPal took the full
    price while the client also spent the credit: ₹149 for a ₹99 swap). */
export interface PreparedPayment {
  /** What the gateway must actually charge, in paise. */
  due: number
  total: number
  creditUsed: number
  /** null when this is a credit-only settlement: no gateway was called. */
  paymentId: string | null
  /** The `used` wallet row, so a failed order can release the hold. */
  holdId: string | null
}

/** Authz + quote + credit hold + payment row, identical for both gateways. */
export async function prepareGatewayPayment(
  client: SupaClient,
  callerId: string,
  input: { requestId: string; isGroup: boolean; useCredit: boolean },
): Promise<PreparedPayment> {
  const { requestId, isGroup, useCredit } = input
  /* Group trips pay ₹199 once (docs/01, docs/04 C): the organiser pays, no
     acceptance needed. The payment targets the group, not one swap. */
  let target: { request_id: string | null; group_id: string | null }
  let lockable: string | null = null
  if (isGroup) {
    const group = await refetchRow<GroupRow | null>(client, 'group_trips', requestId, null)
    if (!group) throw new Error('request_not_found')
    if (group.organiser_id !== callerId) throw new Error('not_requester')
    /* Fail CLOSED: if the duplicate-payment check itself errors we cannot know
       whether the group is already paid, so we must not take money again. */
    const prior = await (client.from('payments').select('id').eq('group_id', group.id).or('status.eq.paid,status.eq.pending').limit(1) as unknown as Promise<{ data: Array<{ id: string }> | null; error: unknown }>)
    if (prior.error) throw new Error('payment_state_unreadable')
    if ((prior.data?.length ?? 0) > 0) throw new Error('already_paid')
    target = { request_id: null, group_id: group.id }
  } else {
    const request = await refetchRow<SwapRequestRow | null>(client, 'swap_requests', requestId, null)
    if (!request) throw new Error('request_not_found')
    assertCanPay(request, callerId)
    target = { request_id: requestId, group_id: null }
    lockable = requestId
  }
  const total = priceFor(isGroup)
  const walletQuery = (client.from('wallet_tx').select('id,amount_paise,expires_at').eq('user_id', callerId) as unknown as Promise<{ data: CreditLedgerRow[] | null; error: unknown }>)
  const { data: ledger, error: ledgerError } = await walletQuery
  if (ledgerError) throw new Error('wallet_unreadable')
  const now = Date.now()
  const quote = buildQuote(useCredit ? spendableCreditPaise(ledger ?? [], now) : 0, isGroup)
  const consumed = planConsumeCredit(ledger ?? [], quote.creditUsed, now)
  /* The spend is a hold: released if the gateway order fails, and by the
     failed-webhook path if capture never happens (rule 6). */
  let holdId: string | null = null
  if (consumed.usedTotal > 0) {
    const useRow = (client.from('wallet_tx').insert({
      user_id: callerId, amount_paise: -consumed.usedTotal, kind: 'used',
      ref_request_id: requestId, expires_at: null,
    }).select('id').single() as unknown as Promise<{ data: { id: string } | null; error: unknown }>)
    const { data: held, error: useError } = await useRow
    if (useError || !held) throw new Error('credit_unusable')
    holdId = held.id
  }
  if (quote.due === 0) {
    /* Fully covered by credit: no gateway order. The swap must still lock, or
       the request sits at `accepted_awaiting_payment` beside a paid payment row
       and can be paid a second time. */
    const payRow = (client.from('payments').insert({
      ...target, payer_id: callerId, provider: 'credit',
      provider_ref: null, amount_paise: total, credit_used_paise: consumed.usedTotal,
      currency: 'INR', status: 'paid',
    }).select('id').single() as unknown as Promise<{ data: { id: string } | null; error: unknown }>)
    const { data: paid, error: paidError } = await payRow
    if (paidError || !paid) throw new Error('payment_unrecorded')
    if (lockable) await lockViaRpc(client, lockable)
    return { due: 0, total, creditUsed: consumed.usedTotal, paymentId: paid.id, holdId: null }
  }
  const payRow = (client.from('payments').insert({
    ...target, payer_id: callerId, provider: 'razorpay',
    provider_ref: null, amount_paise: total, credit_used_paise: consumed.usedTotal,
    currency: 'INR', status: 'created',
  }).select('id').single() as unknown as Promise<{ data: { id: string } | null; error: unknown }>)
  const { data: created, error: createdError } = await payRow
  if (createdError || !created) throw new Error('payment_unrecorded')
  return { due: quote.due, total, creditUsed: consumed.usedTotal, paymentId: created.id, holdId }
}

/** Move a request to `locked` through the SECURITY DEFINER RPC (docs/03). */
export async function lockViaRpc(client: SupaClient, requestId: string): Promise<void> {
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string, args: Record<string, string | null>,
  ) => Promise<{ error: unknown }>
  const { error } = await rpc('apply_request_transition', {
    p_req: requestId, p_status: 'locked', p_locked_offer: null,
  })
  if (error) throw new Error('lock_failed')
}

/** Undo a credit hold when the gateway order could not be created (rule 6). */
export async function releaseCreditHold(
  client: SupaClient, holdId: string | null,
): Promise<void> {
  if (!holdId) return
  try {
    await (client.from('wallet_tx').delete().eq('id', holdId) as unknown as Promise<{ error: unknown }>)
  } catch { /* best-effort: the failed payment row shows no capture */ }
}

export const createRazorpayOrder = createServerFn({ method: 'POST' })
  .validator((input: { requestId: string; isGroup?: boolean; useCredit?: boolean; callerId?: string }) => input)
  .handler(async ({ data }): Promise<RazorpayOrder & { payment_id: string; provider: 'razorpay' | 'credit' }> => {
    /* docs/06 Razorpay 1: only the requester, only while awaiting payment, for
       price-minus-credit with oldest-first consumption. A payment row is
       inserted BEFORE the gateway order so webhooks can reconcile. */
    const client = await getSupabase()
    if (!client) throw new Error('backend_unconfigured')
    const callerId = await resolveCaller(client, data.callerId ?? '')
    if (!callerId) throw new Error('not_signed_in')
    const isGroup = data.isGroup === true
    const prepared = await prepareGatewayPayment(client, callerId, {
      requestId: data.requestId, isGroup, useCredit: data.useCredit !== false,
    })
    if (prepared.due === 0) {
      return {
        order_id: '', amount_paise: 0, currency: 'INR', receipt: data.requestId,
        key_id: '', credit_used_paise: prepared.creditUsed,
        payment_id: prepared.paymentId ?? '', provider: 'credit',
      }
    }
    /* Real Orders API call. A failure here throws ProviderUnavailableError, which
       the pay screen maps to "could not start payment — try again" WITHOUT locking
       anything (docs/06: nothing is held until money is actually captured). */
    let order
    try {
      order = await razorpayCreateOrder(depsFromEnv(), {
        amountPaise: prepared.due,
        receipt: prepared.paymentId ?? '',
        requestId: data.requestId,
      })
    } catch (err) {
      await releaseCreditHold(client, prepared.holdId)
      throw err
    }
    return {
      order_id: order.order_id,
      amount_paise: order.amount_paise,
      currency: 'INR',
      receipt: order.receipt,
      key_id: order.key_id,
      credit_used_paise: prepared.creditUsed,
      payment_id: prepared.paymentId ?? '',
      provider: 'razorpay',
    }
  })
