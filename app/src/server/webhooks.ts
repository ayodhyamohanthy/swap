import { createServerFn } from '@tanstack/react-start'
import { priceFor } from '@/lib/payments'
import { paypalWebhookId, serverEnv, depsFromEnv } from '@/server/payments-helpers'
import { paypalCaptureOrder, paypalCreateOrder } from '@/server/paypal-client'

/* Webhook request handling — the security-critical half of docs/06, written as a
   pure function so it is testable without a server.

   IMPORTANT ARCHITECTURE NOTE: `vite.config.ts` sets `spa.enabled = true`, so the
   current build ships a static PWA to `dist/client` and has NO server runtime.
   These handlers therefore cannot be mounted at WEBHOOK_PATHS until the app is
   deployed with a server (flip `spa.enabled` off, or run these behind Supabase
   Edge Functions / the separate `server/` process the prototype uses). The
   request-handling contract is implemented and tested here so that step is a
   wiring change, not a rewrite. */

/* Node's crypto without a bare `import('node:crypto')`: Vite's browser-compat
   externalization mangles that specifier to `node:` under the jsdom test pool,
   and Node 22's getBuiltinModule resolves it before Vite ever sees it. */
async function nodeCrypto(): Promise<typeof import('node:crypto')> {
  const builtin = process.getBuiltinModule('node:crypto')
  if (builtin) return builtin
  return import('node:crypto')
}

export interface WebhookRequest {
  /** The exact bytes the provider sent — never a re-serialised object. */
  rawBody: string
  /** Razorpay: X-Razorpay-Signature. PayPal: the transmission headers. */
  headers: Record<string, string | undefined>
}

export type WebhookProvider = 'razorpay' | 'paypal'

export type WebhookVerdict =
  | {
      status: 'ok'
      provider: WebhookProvider
      providerRef: string
      kind: 'captured' | 'failed' | 'completed' | 'denied'
    }
  | { status: 'rejected'; reason: 'bad_signature' | 'unsupported_event' | 'missing_ref' }

export interface ParsedWebhook {
  provider: WebhookProvider
  /** Provider payment id — the idempotency key. */
  providerRef: string
  kind: 'captured' | 'failed' | 'completed' | 'denied'
}

/** Razorpay event names that mean the money is (or is not) ours. */
const RAZORPAY_KINDS: Record<string, ParsedWebhook['kind']> = {
  'payment.captured': 'captured',
  'payment.failed': 'failed',
  'order.paid': 'completed',
}

function header(headers: Record<string, string | undefined>, name: string): string {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value ?? ''
  }
  return ''
}

function entityRef(payload: Record<string, unknown>, section: string): string {
  /* Real Razorpay webhooks nest the object at payload.<section>.entity.id
     (docs: payload.payment.entity.id = "pay_..."); accept a flat entity_id
     too so older queued shapes still reconcile instead of silently dropping. */
  const holder = payload.payload as Record<string, unknown> | undefined
  const entity = holder?.[section] as Record<string, unknown> | undefined
  const nested = entity?.entity as Record<string, unknown> | undefined
  const ref = nested?.id ?? entity?.entity_id
  return typeof ref === 'string' ? ref : ''
}

function parseRazorpay(rawBody: string): Omit<ParsedWebhook, 'provider'> | null {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return null
  }
  const event = typeof payload.event === 'string' ? payload.event : ''
  const kind = RAZORPAY_KINDS[event]
  if (!kind) return null
  /* order.paid carries payload.order.entity; payment.* carries payload.payment. */
  const ref = entityRef(payload, event.startsWith('order.') ? 'order' : 'payment')
  if (!ref) return null
  return { providerRef: ref, kind }
}

function parsePaypal(rawBody: string): Omit<ParsedWebhook, 'provider'> | null {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return null
  }
  const event = typeof payload.event_type === 'string' ? payload.event_type : ''
  const resource = payload.resource as Record<string, unknown> | undefined
  const ref = typeof resource?.id === 'string' ? resource.id : ''
  if (!ref) return null
  if (event === 'PAYMENT.CAPTURE.COMPLETED') return { providerRef: ref, kind: 'captured' }
  if (event === 'PAYMENT.CAPTURE.DENIED') return { providerRef: ref, kind: 'denied' }
  return null
}

/**
 * Turn a raw provider request into a verdict. Signature verification is the
 * caller's job and MUST happen on `rawBody` before this is trusted.
 */
export function parseWebhook(
  provider: WebhookProvider,
  request: WebhookRequest,
): WebhookVerdict {
  const parsed =
    provider === 'razorpay' ? parseRazorpay(request.rawBody) : parsePaypal(request.rawBody)
  if (!parsed) {
    /* Distinguish "bad shape" from "no payment id" for clearer logs. */
    let hasRef = false
    try {
      const payload = JSON.parse(request.rawBody) as Record<string, unknown>
      hasRef = Boolean(
        entityRef(payload, 'payment') || entityRef(payload, 'order')
        || (payload.resource as Record<string, unknown> | undefined)?.id,
      )
    } catch {
      hasRef = false
    }
    return hasRef
      ? { status: 'rejected', reason: 'unsupported_event' }
      : { status: 'rejected', reason: 'missing_ref' }
  }
  return { status: 'ok', provider, providerRef: parsed.providerRef, kind: parsed.kind }
}

/** Header name each provider signs with, so the route code cannot get it wrong. */
export const SIGNATURE_HEADERS: Record<WebhookProvider, string> = {
  razorpay: 'x-razorpay-signature',
  paypal: 'transmission-sig',
}

export function signatureHeader(
  provider: WebhookProvider,
  headers: Record<string, string | undefined>,
): string {
  return header(headers, SIGNATURE_HEADERS[provider])
}

/**
 * Constant-time hex comparison. `timingSafeEqual` throws when the two buffers
 * differ in length, so we screen the length first — the length of a hex digest
 * is public, so leaking it costs nothing, while the contents must not leak.
 */
function safeEqual(
  expected: string,
  actual: string,
  timingSafeEqual: (a: Uint8Array, b: Uint8Array) => boolean,
): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(actual, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const verifyRazorpaySignature = createServerFn({ method: 'POST' })
  .validator((input: { orderId: string; paymentId: string; signature: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const secret = serverEnv('RAZORPAY_KEY_SECRET')
    const { createHmac, timingSafeEqual } = await nodeCrypto()
    const expected = createHmac('sha256', secret)
      .update(`${data.orderId}|${data.paymentId}`).digest('hex')
    return { ok: safeEqual(expected, data.signature, timingSafeEqual) }
  })
export const createPaypalOrder = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      requestId: string
      isGroup?: boolean
      returnUrl?: string
      cancelUrl?: string
    }) => input,
  )
  .handler(
    async ({
      data,
    }): Promise<{ id: string; currency: 'INR'; amount_paise: number; approval_url: string | null }> => {
      /* Real v2 order. approval_url is where the browser redirects to authorise.
         The browser owns the origin (the PWA is the deploy target), so it sends
         the return/cancel URLs; only well-formed http(s) ones are forwarded. */
      const order = await paypalCreateOrder(depsFromEnv(), {
        amountPaise: priceFor(data.isGroup === true),
        requestId: data.requestId,
        returnUrl: data.returnUrl,
        cancelUrl: data.cancelUrl,
      })
      return {
        id: order.id,
        currency: 'INR',
        amount_paise: order.amount_paise,
        approval_url: order.approval_url,
      }
    },
  )
export const capturePaypalOrder = createServerFn({ method: 'POST' })
  .validator((input: { orderId: string; requestId: string }) => input)
  .handler(
    async ({
      data,
    }): Promise<{ status: 'paid' | 'pending' | 'failed'; provider_ref: string | null }> => {
      /* The capture response — not the browser callback — decides the status.
         Anything other than COMPLETED must not lock the swap. */
      const capture = await paypalCaptureOrder(depsFromEnv(), { orderId: data.orderId })
      return { status: capture.status, provider_ref: capture.provider_ref }
    },
  )
export async function verifyRazorpayWebhook(rawBody: string, signature: string): Promise<boolean> {
  const secret = serverEnv('RAZORPAY_WEBHOOK_SECRET')
  const { createHmac, timingSafeEqual } = await nodeCrypto()
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqual(expected, signature, timingSafeEqual)
}

/**
 * PayPal webhook verification (docs/06 PayPal 3): the transmission headers
 * are confirmed with PayPal's verify-webhook-signature API BEFORE
 * parseWebhook('paypal', …) is trusted. Injectable deps so tests stub fetch.
 */
export interface PaypalTransmission {
  transmissionId: string
  transmissionTime: string
  certUrl: string
  authAlgo: string
  transmissionSig: string
}

export function paypalTransmission(
  headers: Record<string, string | undefined>,
): PaypalTransmission | null {
  const pick = (...names: string[]): string => {
    for (const name of names) {
      const value = header(headers, name)
      if (value) return value
    }
    return ''
  }
  const transmission: PaypalTransmission = {
    transmissionId: pick('paypal-transmission-id'),
    transmissionTime: pick('paypal-transmission-time'),
    certUrl: pick('paypal-cert-url'),
    authAlgo: pick('paypal-auth-algo'),
    transmissionSig: pick('paypal-transmission-sig', 'transmission-sig'),
  }
  if (!transmission.transmissionId || !transmission.transmissionSig) return null
  return transmission
}

export async function verifyPaypalWebhook(
  deps: { fetch?: typeof fetch; env?: (name: string) => string },
  transmission: PaypalTransmission,
  webhookEventBody: string,
): Promise<boolean> {
  const { callJson, requireEnv } = await import('@/server/payments-helpers');
  const env = { env: deps.env };
  const base = (deps.env?.('PAYPAL_API_BASE') || 'https://api-m.paypal.com').replace(/\/$/, '');
  const doFetch = deps.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  const tokenPayload = await callJson(
    { fetch: doFetch, env: deps.env },
    `${base}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${requireEnv(env, 'PAYPAL_CLIENT_ID')}:${requireEnv(env, 'PAYPAL_CLIENT_SECRET')}`,
          'utf8',
        ).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    },
    'paypal_token',
  );
  const bearer = typeof tokenPayload.access_token === 'string' ? tokenPayload.access_token : ''
  if (!bearer) return false
  let event: Record<string, unknown>
  try {
    event = JSON.parse(webhookEventBody) as Record<string, unknown>
  } catch {
    return false
  }
  const verifyPayload = await callJson(
    { fetch: doFetch, env: deps.env },
    `${base}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: transmission.authAlgo,
        cert_url: transmission.certUrl,
        transmission_id: transmission.transmissionId,
        transmission_sig: transmission.transmissionSig,
        transmission_time: transmission.transmissionTime,
        webhook_id: requireEnv(env, 'PAYPAL_WEBHOOK_ID'),
        webhook_event: event,
      }),
    },
    'paypal_verify',
  )
  return verifyPayload.verification_status === 'SUCCESS'
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
  return { deduped: false, payStatus: 'failed', effects: ['release_credit_hold', 'activity_log'] }
}
export { paypalWebhookId }
/* Webhook HTTP contract (docs/06): POST /api/public/webhooks/razorpay with
   X-Razorpay-Signature, and POST /api/public/webhooks/paypal verified via
   PayPal verify-webhook-signature. Both are idempotent on provider_ref;
   paid → lock + supersede + notify + activity_log. Failed → release any
   credit hold (planCreditHoldRelease) + activity_log; never a bank refund
   except a gateway-level failure the bank auto-returns. Wire these handlers
   in step 3+ hosting; the pure applyWebhookEvent above is what they call. */
export const WEBHOOK_PATHS = {
  razorpay: '/api/public/webhooks/razorpay',
  paypal: '/api/public/webhooks/paypal',
} as const
