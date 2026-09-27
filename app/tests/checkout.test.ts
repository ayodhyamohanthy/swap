/* Checkout: rule-2 gating, credit toggle, spend-only-on-capture (docs/03, 06). */
import { beforeEach, describe, expect, it } from 'vitest'

import { beginCheckout, confirmCaptured, markFailed } from '@/lib/checkout'
import { PRICE_PAISE } from '@/lib/money'
import {
  acceptOffer,
  createRequest,
  getRequest,
  offersFor,
  resetRequests,
  sendRequest,
  withdrawRequest,
} from '@/lib/requests'
import { addTrip, credit, creditPaise, resetStore, setOpenToSwap } from '@/lib/store'

async function acceptedJourney() {
  const mine = await addTrip({
    pnr: '4512789630',
    train_no: '12951',
    journey_date: '2026-11-12',
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
  const theirs = await addTrip({
    pnr: '4512789648',
    train_no: '12951',
    journey_date: '2026-11-12',
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B4', berth_no: '41', berth_type: 'UB' }],
  })
  setOpenToSwap(theirs.id, true)
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  acceptOffer(offersFor(request.id)[0].id)
  return { mine, theirs, request }
}
describe('beginCheckout', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('refuses to open before an acceptance (rule 2)', async () => {
    const mine = await addTrip({
      pnr: '4512789630',
      train_no: '12951',
      journey_date: '2026-11-12',
      class: '3A',
      passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
    })
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(() => beginCheckout(request.id, 'razorpay')).toThrow('not_awaiting_payment')
  })

  it('leaves a gateway payment pending without locking', async () => {
    const { request } = await acceptedJourney()
    const ticket = beginCheckout(request.id, 'razorpay')
    expect(ticket.settled).toBe(false)
    expect(ticket.status).toBe('pending')
    expect(ticket.due).toBe(PRICE_PAISE)
    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')
  })

  it('reuses the open payment instead of charging twice', async () => {
    const { request } = await acceptedJourney()
    const first = beginCheckout(request.id, 'razorpay')
    const second = beginCheckout(request.id, 'razorpay')
    expect(second.paymentId).toBe(first.paymentId)
    expect(second.status).toBe('pending')
  })

  it('honours the credit toggle (design 03c)', async () => {
    const { request } = await acceptedJourney()
    credit({ to: 'requester', amountPaise: 5000, kind: 'acceptor_credit' })
    credit({ to: 'requester', amountPaise: 5000, kind: 'acceptor_credit' })
    const off = beginCheckout(request.id, 'razorpay', false, false)
    expect(off.creditUsed).toBe(0)
    expect(off.due).toBe(PRICE_PAISE)
  })

  it('locks instantly when credit covers everything', async () => {
    const { request } = await acceptedJourney()
    credit({ to: 'requester', amountPaise: 5000, kind: 'acceptor_credit' })
    credit({ to: 'requester', amountPaise: 5000, kind: 'acceptor_credit' })
    const ticket = beginCheckout(request.id, 'razorpay')
    expect(ticket.settled).toBe(true)
    expect(ticket.provider).toBe('credit')
    expect(getRequest(request.id)?.status).toBe('locked')
    expect(creditPaise()).toBe(10000 - PRICE_PAISE)
  })
})

describe('capture and failure', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('spends credit and locks only when money lands', async () => {
    const { request } = await acceptedJourney()
    credit({ to: 'requester', amountPaise: 5000, kind: 'acceptor_credit' })
    beginCheckout(request.id, 'razorpay')
    expect(creditPaise()).toBe(5000)
    const done = confirmCaptured(request.id, 'pay_live')
    expect(done.status).toBe('paid')
    expect(getRequest(request.id)?.status).toBe('locked')
    expect(creditPaise()).toBe(0)
  })

  it('never spends credit or claims a lock when the request stopped being payable', async () => {
    /* The requester withdraws while the gateway is still confirming. The money
       is captured, but no swap happened: rule 6 sends the ₹99 to their credit
       via the outcome path, so the planned credit spend must not happen and
       the caller must not be told the swap locked. */
    const { request } = await acceptedJourney()
    credit({ to: 'requester', amountPaise: 5000, kind: 'acceptor_credit' })
    beginCheckout(request.id, 'razorpay')
    withdrawRequest(request.id)

    const done = confirmCaptured(request.id, 'pay_late')

    expect(done.settled).toBe(false)
    expect(creditPaise()).toBe(5000)
    expect(getRequest(request.id)?.status).not.toBe('locked')
  })

  it('a failed gateway leaves credit and request untouched (rule 6)', async () => {
    const { request } = await acceptedJourney()
    credit({ to: 'requester', amountPaise: 5000, kind: 'acceptor_credit' })
    beginCheckout(request.id, 'razorpay')
    const failed = markFailed(request.id)
    expect(failed.status).toBe('failed')
    expect(creditPaise()).toBe(5000)
    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')
  })
})
