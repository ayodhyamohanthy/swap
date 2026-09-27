/* Real provider HTTP clients (docs/06) — request shape and response handling,
   against a stubbed fetch. No live payment API is ever hit from CI. */
import { describe, expect, it } from 'vitest'
import { razorpayCreateOrder } from '@/server/razorpay-client'
import {
  isWebUrl,
  paypalCaptureOrder,
  paypalCaptureStatus,
  paypalCreateOrder,
} from '@/server/paypal-client'
import { paiseToDecimalString } from '@/lib/money'
import { ProviderUnavailableError, planCreditHoldRelease, type ProviderDeps } from '@/server/payments-helpers'

const ENV: Record<string, string> = {
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_API_BASE: 'https://api.razorpay.test/v1',
  PAYPAL_CLIENT_ID: 'pp_client',
  PAYPAL_CLIENT_SECRET: 'pp_secret',
  PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.test',
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

/** A fetch stub that records every call and replays queued responses per URL. */
function stubFetch(
  routes: Array<{ match: string; status?: number; body: unknown }>,
): { deps: ProviderDeps; calls: Call[] } {
  const calls: Call[] = []
  const deps: ProviderDeps = {
    env: (name) => ENV[name] ?? '',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        method: String(init?.method ?? 'GET'),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ''),
      })
      const route = routes.find((r) => url.includes(r.match))
      return new Response(
        typeof route?.body === 'string' ? route.body : JSON.stringify(route?.body ?? {}),
        { status: route?.status ?? 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch,
  }
  return { deps, calls }
}

const RZP = (deps: ProviderDeps) =>
  razorpayCreateOrder(deps, { amountPaise: 9900, receipt: 'req_9', requestId: 'req_9' })

describe('paiseToDecimalString', () => {
  it('renders whole rupees with two decimals', () => {
    expect(paiseToDecimalString(9900)).toBe('99.00')
    expect(paiseToDecimalString(19900)).toBe('199.00')
  })

  it('keeps the paise instead of rounding', () => {
    expect(paiseToDecimalString(9999)).toBe('99.99')
    expect(paiseToDecimalString(1)).toBe('0.01')
    expect(paiseToDecimalString(105)).toBe('1.05')
  })

  it('refuses a non-integer amount', () => {
    expect(() => paiseToDecimalString(99.5)).toThrow(/amount_not_whole_paise/)
  })
})

describe('razorpayCreateOrder', () => {
  it('posts integer paise to /orders with basic auth and the receipt', async () => {
    const { deps, calls } = stubFetch([
      { match: '/orders', body: { id: 'order_live_1', amount: 9900, currency: 'INR', receipt: 'req_9' } },
    ])
    const result = await RZP(deps)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.razorpay.test/v1/orders')
    expect(calls[0].method).toBe('POST')
    const expected = Buffer.from('rzp_test_key:rzp_test_secret').toString('base64')
    expect(calls[0].headers.Authorization).toBe(`Basic ${expected}`)
    const sent = JSON.parse(calls[0].body)
    /* paise on the wire — never rupees, never a float (docs/02). */
    expect(sent.amount).toBe(9900)
    expect(sent.currency).toBe('INR')
    /* receipt is the idempotency key that stops a double-click charging twice. */
    expect(sent.receipt).toBe('req_9')
    expect(result.order_id).toBe('order_live_1')
    expect(result.key_id).toBe('rzp_test_key')
  })

  it('refuses an order whose amount differs from what we asked for', async () => {
    const { deps } = stubFetch([{ match: '/orders', body: { id: 'o', amount: 4900, currency: 'INR' } }])
    await expect(RZP(deps)).rejects.toThrow(/razorpay_amount_mismatch/)
  })

  it('refuses a non-INR order', async () => {
    const { deps } = stubFetch([{ match: '/orders', body: { id: 'o', amount: 9900, currency: 'USD' } }])
    await expect(RZP(deps)).rejects.toThrow(/razorpay_currency_mismatch/)
  })

  it('turns a gateway error into ProviderUnavailableError, not a crash', async () => {
    const { deps } = stubFetch([{ match: '/orders', status: 502, body: 'bad gateway' }])
    await expect(RZP(deps)).rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it('reports a network failure as unavailable', async () => {
    const deps: ProviderDeps = {
      env: (name) => ENV[name] ?? '',
      fetch: (async () => {
        throw new Error('ECONNRESET')
      }) as typeof fetch,
    }
    await expect(RZP(deps)).rejects.toThrow(/razorpay_order_network/)
  })

  it('never leaks the key secret into the body or url', async () => {
    const { deps, calls } = stubFetch([{ match: '/orders', body: { id: 'o', amount: 9900, currency: 'INR' } }])
    await RZP(deps)
    expect(calls[0].body).not.toContain('rzp_test_secret')
    expect(calls[0].url).not.toContain('rzp_test_secret')
  })

  it('rejects malformed JSON instead of throwing a parse error', async () => {
    const { deps } = stubFetch([{ match: '/orders', body: '<html>oops</html>' }])
    await expect(RZP(deps)).rejects.toThrow(/razorpay_order_bad_json/)
  })
})

describe('paypalCreateOrder', () => {
  it('exchanges credentials, then creates a CAPTURE order with a decimal string', async () => {
    const { deps, calls } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'TOKEN_123' } },
      {
        match: '/v2/checkout/orders',
        body: {
          id: 'ORDER-7',
          status: 'CREATED',
          links: [{ rel: 'payer-action', href: 'https://paypal.test/checkout/ORDER-7' }],
        },
      },
    ])
    const result = await paypalCreateOrder(deps, { amountPaise: 9900, requestId: 'req_9' })

    expect(calls.map((c) => c.url)).toEqual([
      'https://api-m.sandbox.paypal.test/v1/oauth2/token',
      'https://api-m.sandbox.paypal.test/v2/checkout/orders',
    ])
    expect(calls[1].headers.Authorization).toBe('Bearer TOKEN_123')
    const sent = JSON.parse(calls[1].body)
    expect(sent.intent).toBe('CAPTURE')
    /* PayPal wants the string "99.00" — a float here is a money bug. */
    expect(sent.purchase_units[0].amount).toEqual({ currency_code: 'INR', value: '99.00' })
    expect(sent.purchase_units[0].custom_id).toBe('req_9')
    expect(result.approval_url).toBe('https://paypal.test/checkout/ORDER-7')
  })

  it('never puts paise on the wire as a number', async () => {
    const { deps, calls } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      { match: '/v2/checkout/orders', body: { id: 'O', status: 'CREATED' } },
    ])
    await paypalCreateOrder(deps, { amountPaise: 9999, requestId: 'r' })
    const value = JSON.parse(calls[1].body).purchase_units[0].amount.value
    expect(typeof value).toBe('string')
    expect(value).toBe('99.99')
  })

  it('survives an order response with no approval link', async () => {
    const { deps } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      { match: '/v2/checkout/orders', body: { id: 'ORDER-8', status: 'CREATED' } },
    ])
    const result = await paypalCreateOrder(deps, { amountPaise: 9900, requestId: 'r' })
    expect(result.approval_url).toBeNull()
  })

  it('fails loudly when the token call returns no token', async () => {
    const { deps } = stubFetch([{ match: '/oauth2/token', body: { error: 'invalid_client' } }])
    await expect(paypalCreateOrder(deps, { amountPaise: 9900, requestId: 'r' })).rejects.toThrow(
      /paypal_token_missing/,
    )
  })

  it('does not leak the client secret into the order body', async () => {
    const { deps, calls } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      { match: '/v2/checkout/orders', body: { id: 'O', status: 'CREATED' } },
    ])
    await paypalCreateOrder(deps, { amountPaise: 9900, requestId: 'r' })
    expect(calls[1].body).not.toContain('pp_secret')
  })
})

describe('paypalCaptureOrder', () => {
  it('maps COMPLETED to paid and returns the capture id', async () => {
    const { deps, calls } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      {
        match: '/capture',
        body: { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1' }] } }] },
      },
    ])
    const result = await paypalCaptureOrder(deps, { orderId: 'ORDER-7' })
    expect(calls[1].url).toBe(
      'https://api-m.sandbox.paypal.test/v2/checkout/orders/ORDER-7/capture',
    )
    expect(result).toMatchObject({ id: 'ORDER-7', status: 'paid', provider_ref: 'CAP-1' })
    /* No amount block in this fixture, so the receipt fields read as unknown
       rather than as ₹0 — a capture with no readable amount cannot be used to
       prove the right money arrived. */
    expect(result.amount_paise).toBeNull()
    expect(result.custom_id).toBeNull()
  })

  it('only treats COMPLETED as money received', () => {
    expect(paypalCaptureStatus('COMPLETED')).toBe('paid')
    expect(paypalCaptureStatus('PENDING')).toBe('pending')
    /* VOIDED/DENIED are terminal: treating them as pending would leave the swap
       locked with no money and no way to resolve it. */
    expect(paypalCaptureStatus('VOIDED')).toBe('failed')
    expect(paypalCaptureStatus('DENIED')).toBe('failed')
  })

  it('url-encodes the order id so it cannot escape the path', async () => {
    const { deps, calls } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      { match: '/capture', body: { status: 'PENDING' } },
    ])
    await paypalCaptureOrder(deps, { orderId: '../admin' })
    expect(calls[1].url).toContain('/orders/..%2Fadmin/capture')
  })

  it('treats a missing capture array as no provider ref, not a crash', async () => {
    const { deps } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      { match: '/capture', body: { status: 'COMPLETED' } },
    ])
    const result = await paypalCaptureOrder(deps, { orderId: 'ORDER-9' })
    expect(result.status).toBe('paid')
    expect(result.provider_ref).toBeNull()
  })
})

describe('planCreditHoldRelease (rule 6)', () => {
  const base = { userId: 'u_1', requestId: 'req_1', creditUsedPaise: 5000, paymentCreatedAt: '2026-09-27T00:00:00.000Z' }
  it('targets exactly the hold written for this checkout', () => {
    expect(planCreditHoldRelease(base)).toEqual({
      table: 'wallet_tx',
      user_id: 'u_1',
      ref_request_id: 'req_1',
      kind: 'used',
      created_at_gte: '2026-09-27T00:00:00.000Z',
      amount_paise: -5000,
    })
  })
  it('plans nothing when no credit was held', () => {
    expect(planCreditHoldRelease({ ...base, creditUsedPaise: 0 })).toBeNull()
  })
  it('rejects incomplete specs rather than releasing the wrong spend', () => {
    expect(planCreditHoldRelease({ ...base, userId: '' })).toBeNull()
    expect(planCreditHoldRelease({ ...base, requestId: '' })).toBeNull()
    expect(planCreditHoldRelease({ ...base, paymentCreatedAt: '' })).toBeNull()
  })
})

/* Screen 25 (design 28a) redirects the payer to PayPal and back, so the order
   has to carry a return URL. Without it PayPal sends the payer to whatever the
   dashboard default is and the capture never happens. */
describe('paypalCreateOrder return url', () => {
  const ORDER = [
    { match: '/oauth2/token', body: { access_token: 'T' } },
    { match: '/v2/checkout/orders', body: { id: 'O', status: 'CREATED' } },
  ]

  it('sends the payer back to the app after they approve', async () => {
    const { deps, calls } = stubFetch(ORDER)
    await paypalCreateOrder(deps, {
      amountPaise: 9900,
      requestId: 'req_1',
      returnUrl: 'https://app.test/pay/req_1/paypal',
      cancelUrl: 'https://app.test/pay/req_1/method',
    })
    expect(JSON.parse(calls[1].body).application_context).toEqual({
      return_url: 'https://app.test/pay/req_1/paypal',
      cancel_url: 'https://app.test/pay/req_1/method',
    })
  })

  it('omits application_context entirely when no URL is given', async () => {
    const { deps, calls } = stubFetch(ORDER)
    await paypalCreateOrder(deps, { amountPaise: 9900, requestId: 'req_1' })
    expect(JSON.parse(calls[1].body).application_context).toBeUndefined()
  })

  it('refuses a value that is not an absolute http(s) URL', async () => {
    const { deps, calls } = stubFetch(ORDER)
    await paypalCreateOrder(deps, {
      amountPaise: 9900,
      requestId: 'req_1',
      returnUrl: 'javascript:alert(1)',
    })
    expect(JSON.parse(calls[1].body).application_context).toBeUndefined()
  })

  it('accepts the two URL shapes PayPal can be handed', () => {
    expect(isWebUrl('https://app.test/pay/req_1/paypal')).toBe(true)
    expect(isWebUrl('http://localhost:3000/pay/req_1/paypal')).toBe(true)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('//app.test/pay')).toBe(false)
    expect(isWebUrl('app.test/pay')).toBe(false)
    expect(isWebUrl('')).toBe(false)
    expect(isWebUrl(undefined)).toBe(false)
    expect(isWebUrl(`https://app.test/${'x'.repeat(600)}`)).toBe(false)
  })
})

/* A COMPLETED capture only proves money moved on SOME order. These three fields
   are what let the server function refuse to lock a ₹99 swap against a ₹1
   order, or against someone else's order. */
describe('paypalCaptureOrder receipt', () => {
  const CAPTURE = [
    { match: '/oauth2/token', body: { access_token: 'T' } },
    {
      match: '/capture',
      body: {
        id: 'ORDER-9',
        status: 'COMPLETED',
        purchase_units: [{
          custom_id: 'req_7',
          payments: {
            captures: [{
              id: 'CAP-1',
              amount: { currency_code: 'INR', value: '99.00' },
            }],
          },
        }],
      },
    },
  ]

  it('reports the amount, currency and owning request', async () => {
    const { deps } = stubFetch(CAPTURE)
    const result = await paypalCaptureOrder(deps, { orderId: 'ORDER-9' })
    expect(result.status).toBe('paid')
    expect(result.provider_ref).toBe('CAP-1')
    expect(result.amount_paise).toBe(9900)
    expect(result.currency).toBe('INR')
    expect(result.custom_id).toBe('req_7')
  })

  it('never reports a foreign amount as paise', async () => {
    const { deps } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      {
        match: '/capture',
        body: {
          id: 'O', status: 'COMPLETED',
          purchase_units: [{ custom_id: 'r', payments: { captures: [
            { id: 'C', amount: { currency_code: 'USD', value: '1.20' } },
          ] } }],
        },
      },
    ])
    const result = await paypalCaptureOrder(deps, { orderId: 'O' })
    expect(result.amount_paise).toBeNull()
    expect(result.currency).toBe('USD')
  })

  it('an order with no capture line yields nulls, not zero', async () => {
    const { deps } = stubFetch([
      { match: '/oauth2/token', body: { access_token: 'T' } },
      { match: '/capture', body: { id: 'O', status: 'COMPLETED', purchase_units: [] } },
    ])
    const result = await paypalCaptureOrder(deps, { orderId: 'O' })
    expect(result.amount_paise).toBeNull()
    expect(result.custom_id).toBeNull()
  })
})
