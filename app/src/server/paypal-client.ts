/* PayPal v2 Orders + Captures (docs/06, international travellers). Real HTTP,
   injectable for tests. Amounts go out as decimal strings, never floats. */
import { decimalStringToPaise, paiseToDecimalString } from '@/lib/money'
import {
  basicAuth,
  callJson,
  requireEnv,
  type ProviderDeps,
} from './payments-helpers'

export interface PaypalOrderResult {
  id: string
  status: string
  amount_paise: number
  currency: 'INR'
  /** Link the browser redirects to; null when PayPal did not return one. */
  approval_url: string | null
}

export interface PaypalCaptureResult {
  id: string
  status: 'paid' | 'pending' | 'failed'
  provider_ref: string | null
  /** What PayPal says it captured, in paise. null unless it was INR. */
  amount_paise: number | null
  currency: string | null
  /** purchase_units[0].custom_id — the request this order was created for. */
  custom_id: string | null
}

function apiBase(deps: ProviderDeps): string {
  return (deps.env?.('PAYPAL_API_BASE') || 'https://api-m.paypal.com').replace(/\/$/, '')
}

/** Absolute http(s) URL or nothing — PayPal redirects the browser to this. */
export function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return false
  return /^https?:\/\/[^\s"'<>]+$/i.test(value)
}

async function token(deps: ProviderDeps): Promise<string> {
  const clientId = requireEnv(deps, 'PAYPAL_CLIENT_ID')
  const clientSecret = requireEnv(deps, 'PAYPAL_CLIENT_SECRET')
  const payload = await callJson(
    deps,
    `${apiBase(deps)}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    },
    'paypal_token',
  )
  const value = typeof payload.access_token === 'string' ? payload.access_token : ''
  if (!value) throw new Error('paypal_token_missing')
  return value
}

function authHeaders(bearer: string): Record<string, string> {
  return { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }
}

/** POST /v2/checkout/orders with intent CAPTURE. */
export async function paypalCreateOrder(
  deps: ProviderDeps,
  input: {
    amountPaise: number
    requestId: string
    /** Where PayPal sends the payer back to authorise. Omit and PayPal falls
        back to the dashboard default, which is never the PWA. */
    returnUrl?: string
    /** Where PayPal sends the payer who backs out — back to the method list. */
    cancelUrl?: string
  },
): Promise<PaypalOrderResult> {
  const bearer = await token(deps)
  /* Only absolute http(s) URLs reach the wire: PayPal redirects the browser
     there, so a stray value must never be smuggled into the order. */
  const context: Record<string, string> = {}
  if (isWebUrl(input.returnUrl)) context.return_url = input.returnUrl
  if (isWebUrl(input.cancelUrl)) context.cancel_url = input.cancelUrl
  const payload = await callJson(
    deps,
    `${apiBase(deps)}/v2/checkout/orders`,
    {
      method: 'POST',
      headers: authHeaders(bearer),
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: input.requestId,
            custom_id: input.requestId,
            amount: {
              currency_code: 'INR',
              value: paiseToDecimalString(input.amountPaise),
            },
          },
        ],
        ...(Object.keys(context).length > 0 ? { application_context: context } : {}),
      }),
    },
    'paypal_order',
  )
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (!id) throw new Error('paypal_order_missing_id')
  const links = Array.isArray(payload.links) ? (payload.links as Record<string, unknown>[]) : []
  const approval = links.find((link) => link.rel === 'payer-action')
  return {
    id,
    status: typeof payload.status === 'string' ? payload.status : 'CREATED',
    amount_paise: input.amountPaise,
    currency: 'INR',
    approval_url: typeof approval?.href === 'string' ? approval.href : null,
  }
}

/**
 * COMPLETED is the only state that means "ours". PENDING stays pending so the
 * swap is not locked on money that may bounce; anything else is terminal, and
 * mapping it to pending would leave a swap locked with no money and no way out.
 */
export function paypalCaptureStatus(status: string): PaypalCaptureResult['status'] {
  if (status === 'COMPLETED') return 'paid'
  if (status === 'PENDING' || status === 'CREATED') return 'pending'
  return 'failed'
}

/** POST /v2/checkout/orders/{id}/capture — the truth about the money.
 *
 * The capture receipt is also parsed for what was ACTUALLY taken: amount,
 * currency and the order's custom_id. A COMPLETED status alone only says some
 * money moved on some order — without these the caller cannot tell a ₹99
 * payment for this swap from a ₹1 order that someone reused the id of. */
export async function paypalCaptureOrder(
  deps: ProviderDeps,
  input: { orderId: string },
): Promise<PaypalCaptureResult> {
  const bearer = await token(deps)
  const payload = await callJson(
    deps,
    `${apiBase(deps)}/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
    { method: 'POST', headers: authHeaders(bearer), body: '{}' },
    'paypal_capture',
  )
  const status = typeof payload.status === 'string' ? payload.status : 'PENDING'
  const units = Array.isArray(payload.purchase_units)
    ? (payload.purchase_units as Record<string, unknown>[])
    : []
  const payments = (units[0]?.payments as Record<string, unknown> | undefined) ?? {}
  const captures = Array.isArray(payments.captures)
    ? (payments.captures as Record<string, unknown>[])
    : []
  const receipt = captures[0] as Record<string, unknown> | undefined
  const amount = receipt?.amount as Record<string, unknown> | undefined
  const currency = typeof amount?.currency_code === 'string' ? amount.currency_code : ''
  return {
    id: input.orderId,
    status: paypalCaptureStatus(status),
    provider_ref: typeof receipt?.id === 'string' ? receipt.id : null,
    /* Only an INR amount is readable as paise; a foreign one is null, not 0. */
    amount_paise: currency === 'INR' ? decimalStringToPaise(amount?.value) : null,
    currency: currency || null,
    custom_id: typeof units[0]?.custom_id === 'string' ? units[0].custom_id : null,
  }
}
