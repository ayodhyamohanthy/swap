/* Razorpay Orders API (docs/06). Real HTTP, injectable for tests. */
import {
  basicAuth,
  callJson,
  requireEnv,
  type ProviderDeps,
} from './payments-helpers'

export interface RazorpayOrderResult {
  order_id: string
  amount_paise: number
  currency: 'INR'
  receipt: string
  key_id: string
}

/** POST /v1/orders — amount is integer paise, receipt is the idempotency key. */
export async function razorpayCreateOrder(
  deps: ProviderDeps,
  input: { amountPaise: number; receipt: string; requestId: string },
): Promise<RazorpayOrderResult> {
  const keyId = requireEnv(deps, 'RAZORPAY_KEY_ID')
  const keySecret = requireEnv(deps, 'RAZORPAY_KEY_SECRET')
  const endpoint = deps.env?.('RAZORPAY_API_BASE') || 'https://api.razorpay.com/v1'

  const payload = await callJson(
    deps,
    `${endpoint.replace(/\/$/, '')}/orders`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth(keyId, keySecret)}`,
        'Content-Type': 'application/json',
      },
      /* receipt is the idempotency key: a retried or double-clicked request maps
         to the same Razorpay order, so we can never ask for ₹99 twice. */
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: { request_id: input.requestId },
      }),
    },
    'razorpay_order',
  )

  const orderId = typeof payload.id === 'string' ? payload.id : ''
  if (!orderId) throw new Error('razorpay_order_missing_id')
  const amount = typeof payload.amount === 'number' ? payload.amount : input.amountPaise
  /* A different amount back means the gateway quoted a different price than we
     asked for. Silently accepting it would break rule 1, so refuse. */
  if (amount !== input.amountPaise) throw new Error('razorpay_amount_mismatch')
  if (payload.currency !== 'INR') throw new Error('razorpay_currency_mismatch')

  return {
    order_id: orderId,
    amount_paise: amount,
    currency: 'INR',
    receipt: typeof payload.receipt === 'string' ? payload.receipt : input.receipt,
    key_id: keyId,
  }
}


