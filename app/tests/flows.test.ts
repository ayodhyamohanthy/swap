/* End-to-end flow per docs/04-FLOWS.md, requester side A then acceptor side B,
   wired against the real local-first modules — no mocks, no fixtures. This is
   the QA gate that the money rules actually hold end to end:

   - sending a request moves NO money (rule 2)
   - acceptance does NOT lock; only payment locks (rule 2)
   - the acceptor is never charged, and earns ₹50 only once the swap is done
     (rules 3, 5)
   - a swap that did not happen sends ₹99 to the REQUESTER's credit, never to a
     bank refund (rule 6)
   - only a bank-level failure is an exception to that (rule 6)
   - credit is never cash and expires after 12 months (rule 4) */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyWebhookEvent,
  parseWebhook,
  paypalTransmission,
  signatureHeader,
  verifyPaypalWebhook,
  verifyRazorpayWebhook,
} from '@/server/webhooks'
import {
  planAcceptOffer,
  planDeclineOffer,
  planLockRequest,
  type OfferRow,
  type RequestRow,
} from '@/server/functions'
import { buildQuote } from '@/lib/payments'
import { FEE_PAISE, PRICE_PAISE, THANK_YOU_PAISE } from '@/lib/money'
import { creditExpiresAt, resolveConfirmations } from '@/lib/outcomes'
import { addTrip, activityLog, credit, creditPaise, getTrip, resetStore, setOpenToSwap } from '@/lib/store'
import {
  acceptOffer,
  createRequest,
  lockRequest,
  offersFor,
  resetRequests,
  sendRequest,
  withdrawRequest,
} from '@/lib/requests'

const DAY = '2026-11-12'

/** Requester holds a lower berth; acceptor holds an upper one and is open. */
async function journey() {
  const requester = await addTrip({
    pnr: '4512789630',
    train_no: '12951',
    journey_date: DAY,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
  const acceptor = await addTrip({
    pnr: '4512789648',
    train_no: '12951',
    journey_date: DAY,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B4', berth_no: '41', berth_type: 'UB' }],
  })
  setOpenToSwap(acceptor.id, true)

  const request = createRequest({ trip_id: requester.id, choices: ['UB'] })
  sendRequest(request.id)
  return { requester, acceptor, request }
}

beforeEach(() => {
  resetStore()
  resetRequests()
})

describe('flow A: requester sends, waits, pays, locks', () => {
  it('walks the whole journey without breaking any money rule', async () => {
    const { request, acceptor } = await journey()

    /* Rule 2: asking costs nothing. */
    expect(creditPaise()).toBe(0)

    /* Rule 2: an acceptance is not a lock. */
    const { request: awaiting } = acceptOffer(offersFor(request.id)[0].id)
    expect(awaiting?.status).toBe('accepted_awaiting_payment')
    expect(awaiting?.locked_offer_id).toBeNull()
    expect(creditPaise()).toBe(0)

    /* Rules 1/9: the quote is always ₹99 until credit exists. */
    expect(buildQuote(creditPaise())).toEqual({
      total: 9900,
      creditUsed: 0,
      due: 9900,
      provider: null,
    })

    /* Rule 2: payment is the lock. */
    const locked = lockRequest(request.id)
    expect(locked?.status).toBe('locked')
    expect(locked?.locked_offer_id).not.toBeNull()

    /* Rule 3: the acceptor is never charged, and stays open. Re-read the trip:
       setOpenToSwap commits a new object, so the local snapshot is stale. */
    expect(creditPaise()).toBe(0)
    expect(getTrip(acceptor.id)?.open_to_swap).toBe(true)
  })

  it('writes an audit row for every step of the journey', async () => {
    const { request } = await journey()
    acceptOffer(offersFor(request.id)[0].id)
    lockRequest(request.id)

    const actions = activityLog().map((row) => row.action)
    expect(actions).toContain('request_drafted')
    expect(actions).toContain('request_sent')
    expect(actions).toContain('offer_accepted')
    expect(actions).toContain('swap_locked')
  })
})

describe('flow B: the swap happens, the acceptor is credited ₹50', () => {
  it('credits the acceptor only after both sides confirm', async () => {
    const { request } = await journey()
    acceptOffer(offersFor(request.id)[0].id)
    lockRequest(request.id)

    const resolution = resolveConfirmations('swapped', 'swapped')
    expect(resolution.status).toBe('confirmed')
    expect(resolution.credits).toHaveLength(1)
    expect(resolution.credits[0]).toMatchObject({
      to: 'acceptor',
      amountPaise: THANK_YOU_PAISE,
      kind: 'acceptor_credit',
    })

    /* Rule 5: the credit only becomes real once the swap is confirmed done. */
    expect(creditPaise()).toBe(0)
    credit(resolution.credits[0])
    expect(creditPaise()).toBe(5000)
  })
})

describe('flow C: the swap did not happen, ₹99 goes to credit not the bank', () => {
  it.each(['no_show', 'not_possible', 'changed_mind'] as const)(
    'moves the full ₹99 to requester credit when both sides say %s',
    (outcome) => {
      const resolution = resolveConfirmations(outcome, outcome)
      expect(resolution.status).toBe('voided')
      expect(resolution.credits[0]).toMatchObject({
        to: 'requester',
        amountPaise: PRICE_PAISE,
        kind: 'swap_to_credit',
        expiresMonths: 12,
      })

      credit(resolution.credits[0])
      /* Rule 6: the requester gets the whole ₹99 as credit. Not a refund. */
      expect(creditPaise()).toBe(PRICE_PAISE)
    },
  )

  it('disputed answers award nobody and promise no timeframe', () => {
    const resolution = resolveConfirmations('swapped', 'no_show')
    expect(resolution.status).toBe('disputed')
    expect(resolution.credits).toEqual([])
    expect(creditPaise()).toBe(0)
  })
})

describe('rule 4: credit lowers fees but is never cash', () => {
  it('applies credit to the next swap and never exceeds the price', () => {
    credit({ to: 'requester', amountPaise: PRICE_PAISE, kind: 'swap_to_credit', expiresMonths: 12 })

    const quote = buildQuote(creditPaise())
    expect(quote.total).toBe(PRICE_PAISE)
    /* Fully covered by credit: no provider charge at all. */
    expect(quote.creditUsed).toBe(PRICE_PAISE)
    expect(quote.due).toBe(0)
    expect(quote.provider).toBe('credit')

    /* More credit than the price is never over-charged. */
    credit({ to: 'acceptor', amountPaise: THANK_YOU_PAISE, kind: 'acceptor_credit' })
    credit({ to: 'acceptor', amountPaise: THANK_YOU_PAISE, kind: 'acceptor_credit' })
    expect(buildQuote(creditPaise()).creditUsed).toBe(PRICE_PAISE)
  })

  it('rejects credit amounts that do not match the kind (rules 3, 6)', () => {
    expect(() =>
      credit({ to: 'acceptor', amountPaise: 50000, kind: 'acceptor_credit', expiresMonths: 12 }),
    ).toThrow('credit_amount_must_match_kind')
    expect(() =>
      credit({ to: 'requester', amountPaise: 100, kind: 'swap_to_credit', expiresMonths: 12 }),
    ).toThrow('credit_amount_must_match_kind')
    expect(creditPaise()).toBe(0)
  })

  it('expires credit 12 months after it is earned', () => {
    const now = Date.parse('2026-11-12T10:00:00.000Z')
    // 12 calendar months later, not 365 days
    expect(Date.parse(creditExpiresAt(now))).toBeGreaterThan(
      Date.parse('2027-11-11T10:00:00.000Z'),
    )
  })

  it('ignores caller-supplied expiry: credit always lives 12 months (rule 4)', () => {
    credit({
      to: 'acceptor',
      amountPaise: THANK_YOU_PAISE,
      kind: 'acceptor_credit',
      expiresMonths: 12,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    expect(creditPaise()).toBe(THANK_YOU_PAISE)
  })

  it('splits ₹99 into ₹49 fee + ₹50 credit with no leftovers', () => {
    expect(FEE_PAISE + THANK_YOU_PAISE).toBe(PRICE_PAISE)
  })
})

describe('webhook replay is idempotent', () => {
  it('applies a captured event once and no-ops every replay', () => {
    const seen = new Set<string>()
    const event: Parameters<typeof applyWebhookEvent>[1] = {
      providerRef: 'pay_abc123',
      kind: 'captured',
    }

    const first = applyWebhookEvent(seen, event)
    expect(first.deduped).toBe(false)
    expect(first.payStatus).toBe('paid')
    expect(first.effects).toContain('lock_request')
    expect(first.effects).toContain('reveal_berths')

    /* The provider retries; a replay must not lock or notify twice. */
    for (let i = 0; i < 3; i += 1) {
      const replay = applyWebhookEvent(seen, event)
      expect(replay.deduped).toBe(true)
      expect(replay.payStatus).toBeNull()
      expect(replay.effects).toEqual([])
    }
  })

  it('treats a failed capture as failed, with no lock', () => {
    const result = applyWebhookEvent(new Set(), { providerRef: 'pay_fail', kind: 'failed' })
    expect(result.payStatus).toBe('failed')
    expect(result.effects).not.toContain('lock_request')
  })
})

describe('webhook signature verification (docs/06)', () => {
  /* getBuiltinModule instead of import('node:crypto') — Vite's browser-compat
     externalization mangles the dynamic import under the jsdom pool. */
  const { createHmac } = process.getBuiltinModule('node:crypto') as typeof import('node:crypto')
  const SECRET = 'whsec_test_secret'
  const OTHER = 'whsec_wrong_secret'

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
  })

  it('accepts a signature produced with the right secret', async () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'pay_1' })
    const signature = createHmac('sha256', SECRET).update(body).digest('hex')
    await expect(verifyRazorpayWebhook(body, signature)).resolves.toBe(true)
  })

  it('rejects a signature made with the wrong secret', async () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'pay_1' })
    const bad = createHmac('sha256', OTHER).update(body).digest('hex')
    await expect(verifyRazorpayWebhook(body, bad)).resolves.toBe(false)
  })

  it('rejects a tampered body', async () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'pay_1' })
    const signature = createHmac('sha256', SECRET).update(body).digest('hex')
    const tampered = JSON.stringify({ event: 'payment.captured', id: 'pay_2' })
    await expect(verifyRazorpayWebhook(tampered, signature)).resolves.toBe(false)
  })

  it('rejects a wrong-length signature without throwing', async () => {
    // timingSafeEqual throws on mismatched lengths; the guard must absorb it.
    await expect(verifyRazorpayWebhook('body', 'abc')).resolves.toBe(false)
    await expect(verifyRazorpayWebhook('body', '')).resolves.toBe(false)
    await expect(
      verifyRazorpayWebhook('body', 'a'.repeat(1000)),
    ).resolves.toBe(false)
  })

  it('is case-sensitive on the digest', async () => {
    const body = 'x'
    const signature = createHmac('sha256', SECRET).update(body).digest('hex')
    await expect(verifyRazorpayWebhook(body, signature.toUpperCase())).resolves.toBe(false)
  })
})

describe('withdrawing before payment costs nothing', () => {
  it('expires the offers and leaves the wallet empty', async () => {
    const { request } = await journey()
    expect(withdrawRequest(request.id)?.status).toBe('withdrawn')
    expect(offersFor(request.id)[0].status).toBe('expired')
    expect(creditPaise()).toBe(0)
  })
})

describe('webhook payload parsing (docs/06)', () => {
  it('reads a real Razorpay capture (payload.payment.entity.id)', () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_123', amount: 9900 } } },
    })
    expect(parseWebhook('razorpay', { rawBody: body, headers: {} })).toEqual({
      status: 'ok',
      provider: 'razorpay',
      providerRef: 'pay_123',
      kind: 'captured',
    })
  })

  it('still accepts the flat entity_id shape', () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity_id: 'pay_flat' } },
    })
    expect(parseWebhook('razorpay', { rawBody: body, headers: {} })).toMatchObject({
      status: 'ok',
      providerRef: 'pay_flat',
    })
  })

  it('reads order.paid from payload.order.entity', () => {
    const body = JSON.stringify({
      event: 'order.paid',
      payload: { order: { entity: { id: 'order_9' } } },
    })
    expect(parseWebhook('razorpay', { rawBody: body, headers: {} })).toMatchObject({
      status: 'ok',
      providerRef: 'order_9',
      kind: 'completed',
    })
  })

  it('reads a Razorpay failure', () => {
    const body = JSON.stringify({
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_456' } } },
    })
    expect(parseWebhook('razorpay', { rawBody: body, headers: {} })).toMatchObject({
      status: 'ok',
      kind: 'failed',
    })
  })

  it('reads a PayPal capture and denial', () => {
    const ok = JSON.stringify({
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAPTURE-9' },
    })
    expect(parseWebhook('paypal', { rawBody: ok, headers: {} })).toMatchObject({
      status: 'ok',
      providerRef: 'CAPTURE-9',
      kind: 'captured',
    })

    const denied = JSON.stringify({
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: { id: 'CAPTURE-10' },
    })
    expect(parseWebhook('paypal', { rawBody: denied, headers: {} })).toMatchObject({
      kind: 'denied',
    })
  })

  it('rejects malformed JSON instead of throwing', () => {
    expect(parseWebhook('razorpay', { rawBody: 'not json', headers: {} })).toEqual({
      status: 'rejected',
      reason: 'missing_ref',
    })
  })

  it('rejects an event it does not understand', () => {
    const body = JSON.stringify({
      event: 'refund.processed',
      payload: { payment: { entity_id: 'pay_789' } },
    })
    expect(parseWebhook('razorpay', { rawBody: body, headers: {} })).toEqual({
      status: 'rejected',
      reason: 'unsupported_event',
    })
  })

  it('rejects a payload with no payment id', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} })
    expect(parseWebhook('razorpay', { rawBody: body, headers: {} })).toEqual({
      status: 'rejected',
      reason: 'missing_ref',
    })
  })

  it('finds the signature header case-insensitively', () => {
    const headers = { 'X-Razorpay-Signature': 'abc', 'Transmission-Sig': 'def' }
    expect(signatureHeader('razorpay', headers)).toBe('abc')
    expect(signatureHeader('paypal', headers)).toBe('def')
    expect(signatureHeader('razorpay', {})).toBe('')
  })
})

describe('server planners persist every row of a transition (docs/03)', () => {
  const request: RequestRow = { id: 'r1', requester_id: 'u_req', booking_id: 'b1', status: 'searching', passenger_ids: ['p1'] }
  const offer: OfferRow = { id: 'o1', request_id: 'r1', acceptor_id: 'u_acc', acceptor_booking_id: 'b2', acceptor_passenger_id: 'p2', matched_choice_rank: 1, status: 'sent' }
  const rival: OfferRow = { ...offer, id: 'o2', acceptor_id: 'u_other', status: 'sent' }

  it('accept flips the offer AND the request (rule 2)', () => {
    const plan = planAcceptOffer(request, offer, 'u_acc')
    expect(plan.requestStatus).toBe('accepted_awaiting_payment')
    expect(plan.offerStatus).toBe('accepted')
    expect(plan.patches).toContainEqual({ table: 'swap_offers', id: 'o1', patch: expect.objectContaining({ status: 'accepted' }) })
    expect(plan.patches).toContainEqual({ table: 'swap_requests', id: 'r1', patch: { status: 'accepted_awaiting_payment' } })
    expect(plan.activity.action).toBe('offer_accepted')
  })

  it('rivals stay open on accept and are superseded only on lock', () => {
    const accepted = planAcceptOffer(request, offer, 'u_acc')
    expect(accepted.patches.some((p) => p.id === 'o2')).toBe(false)
    const locked = planLockRequest(
      { ...request, status: 'accepted_awaiting_payment' },
      { ...offer, status: 'accepted' },
      [rival],
      'u_req',
      { payment_id: 'pay_1' },
    )
    expect(locked.status).toBe('locked')
    expect(locked.patches).toContainEqual({ table: 'swap_offers', id: 'o2', patch: { status: 'superseded' } })
  })

  it('back-out before payment returns the request to searching', () => {
    const plan = planDeclineOffer(
      { ...request, status: 'accepted_awaiting_payment' },
      { ...offer, status: 'accepted' },
      'u_acc',
    )
    expect(plan.offerStatus).toBe('declined')
    expect(plan.patches).toContainEqual({ table: 'swap_requests', id: 'r1', patch: { status: 'searching', locked_offer_id: null } })
  })

  it('refuses to lock one berth into two swaps', () => {
    expect(() =>
      planLockRequest(
        { ...request, status: 'accepted_awaiting_payment' },
        { ...offer, status: 'accepted' },
        [],
        'u_req',
        { payment_id: 'pay_1', lockedPassengerSets: [['p9'], ['p1']] },
      ),
    ).toThrow('berth_already_locked')
  })

  it('rejects forged callers and wrong states', () => {
    expect(() => planAcceptOffer(request, offer, 'u_stranger')).toThrow('not_acceptor')
    expect(() => planLockRequest(request, offer, [], 'u_req', { payment_id: 'pay_1' })).toThrow('not_awaiting_payment')
  })

  it('enforces the group bundle cap: 3 covered locks, then group_swap_cap', () => {
    const grouped = { ...request, status: 'accepted_awaiting_payment' as const, group_id: 'g1' }
    const accepted = { ...offer, status: 'accepted' as const }
    const covered = { paid: true, lockedCount: 3 }
    expect(() =>
      planLockRequest(grouped, accepted, [], 'u_req', { payment_id: null, group: covered }),
    ).toThrow('group_swap_cap')
    /* A lock backed by its own paid payment (the 4th+ swap paying ₹99)
       always goes through. */
    expect(
      planLockRequest(grouped, accepted, [], 'u_req', { payment_id: 'pay_4th', group: covered }).status,
    ).toBe('locked')
    /* Under the cap, covered locks pass. */
    expect(
      planLockRequest(grouped, accepted, [], 'u_req', { payment_id: null, group: { paid: true, lockedCount: 2 } }).status,
    ).toBe('locked')
    /* Unpaid group, no bundle: covered locks are refused. */
    expect(() =>
      planLockRequest(grouped, accepted, [], 'u_req', { payment_id: null, group: { paid: false, lockedCount: 0 } }),
    ).toThrow('group_unpaid')
  })
})

describe('PayPal webhook verification (docs/06)', () => {
  const transmission = {
    transmissionId: 't1',
    transmissionTime: '2026-01-01T00:00:00Z',
    certUrl: 'https://api.paypal.com/certs',
    authAlgo: 'SHA256withRSA',
    transmissionSig: 'sig',
  }
  const stubFetch = (verifyStatus: string) => (async (url: string) => {
    const body = url.includes('oauth2/token')
      ? { access_token: 'tok' }
      : { verification_status: verifyStatus }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  const env = (name: string) => ({
    PAYPAL_API_BASE: 'https://api.test.paypal.com',
    PAYPAL_CLIENT_ID: 'id',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_WEBHOOK_ID: 'wh',
  }[name] ?? '')

  it('accepts SUCCESS and rejects anything else', async () => {
    await expect(verifyPaypalWebhook({ fetch: stubFetch('SUCCESS'), env }, transmission, '{}')).resolves.toBe(true)
    await expect(verifyPaypalWebhook({ fetch: stubFetch('FAILURE'), env }, transmission, '{}')).resolves.toBe(false)
  })

  it('reads transmission headers case-insensitively', () => {
    expect(paypalTransmission({ 'PayPal-Transmission-Id': 't1', 'PAYPAL-TRANSMISSION-SIG': 's' })?.transmissionId).toBe('t1')
    expect(paypalTransmission({})).toBeNull()
  })
})
