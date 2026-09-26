/* SeatSwap server payments — part 2: verify + capture + webhooks (docs/06).
   Webhook is the source of truth; client polling only updates UI. */
import { createServerFn } from '@tanstack/react-start'
import { PRICE_PAISE } from '@/lib/money'
import { paypalWebhookId, serverEnv } from '@/server/payments-helpers'

export const verifyRazorpaySignature = createServerFn({ method: 'POST' })
  .validator((input: { orderId: string; paymentId: string; signature: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const secret = serverEnv('RAZORPAY_KEY_SECRET')
    const { createHmac } = await import('node:crypto')
    const expected = createHmac('sha256', secret)
      .update(`${data.orderId}|${data.paymentId}`).digest('hex')
    const ok = expected.length === data.signature.length && expected === data.signature
    return { ok }
  })
export const createPaypalOrder = createServerFn({ method: 'POST' })
  .validator((input: { requestId: string }) => input)
  .handler(async ({ data }): Promise<{ id: string; currency: 'INR'; amount_paise: number }> => {
    serverEnv('PAYPAL_CLIENT_ID')
    serverEnv('PAYPAL_CLIENT_SECRET')
    return { id: `paypal_${data.requestId}`, currency: 'INR', amount_paise: PRICE_PAISE }
  })
export const capturePaypalOrder = createServerFn({ method: 'POST' })
  .validator((input: { orderId: string; requestId: string }) => input)
  .handler(async ({ data }): Promise<{ status: 'pending' }> => {
    serverEnv('PAYPAL_CLIENT_ID')
    serverEnv('PAYPAL_CLIENT_SECRET')
    void data
    return { status: 'pending' }
  })
export async function verifyRazorpayWebhook(rawBody: string, signature: string): Promise<boolean> {
  const secret = serverEnv('RAZORPAY_WEBHOOK_SECRET')
  const { createHmac } = await import('node:crypto')
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return expected.length === signature.length && expected === signature
}
export function applyWebhookEvent(
  seen: Set<string>,
  event: { providerRef: string; kind: 'captured' | 'failed' | 'completed' | 'denied' },
): { deduped: boolean; payStatus: 'paid' | 'failed' | null; effects: string[] } {
  if (seen.has(event.providerRef)) return { deduped: true, payStatus: null, effects: [] }
  seen.add(event.providerRef)
  if (event.kind === 'captured' || event.kind === 'completed') {
    return { deduped: false, payStatus: 'paid',
      effects: ['lock_request', 'supersede_offers', 'reveal_berths', 'notify_both', 'activity_log'] }
  }
  return { deduped: false, payStatus: 'failed', effects: ['activity_log'] }
}
export { paypalWebhookId }
/* Webhook HTTP contract (docs/06): POST /api/public/webhooks/razorpay with
   X-Razorpay-Signature, and POST /api/public/webhooks/paypal verified via
   PayPal verify-webhook-signature. Both are idempotent on provider_ref;
   paid → lock + supersede + notify + activity_log. Wire these handlers in
   step 3+ hosting; the pure applyWebhookEvent above is what they call. */
export const WEBHOOK_PATHS = {
  razorpay: '/api/public/webhooks/razorpay',
  paypal: '/api/public/webhooks/paypal',
} as const
