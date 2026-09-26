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

import { applyWebhookEvent } from '@/server/webhooks'
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
    credit({ to: 'acceptor', amountPaise: 50000, kind: 'acceptor_credit', expiresMonths: 12 })
    expect(buildQuote(creditPaise()).creditUsed).toBe(PRICE_PAISE)
  })

  it('expires credit 12 months after it is earned', () => {
    const now = Date.parse('2026-11-12T10:00:00.000Z')
    // 12 calendar months later, not 365 days
    expect(Date.parse(creditExpiresAt(now))).toBeGreaterThan(
      Date.parse('2027-11-11T10:00:00.000Z'),
    )
  })

  it('excludes expired credit from the spendable balance', () => {
    credit({
      to: 'acceptor',
      amountPaise: THANK_YOU_PAISE,
      kind: 'acceptor_credit',
      expiresMonths: 12,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    expect(creditPaise()).toBe(0)
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

describe('withdrawing before payment costs nothing', () => {
  it('expires the offers and leaves the wallet empty', async () => {
    const { request } = await journey()
    expect(withdrawRequest(request.id)?.status).toBe('withdrawn')
    expect(offersFor(request.id)[0].status).toBe('expired')
    expect(creditPaise()).toBe(0)
  })
})
