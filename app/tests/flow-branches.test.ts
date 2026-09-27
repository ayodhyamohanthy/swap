/* Flow branches docs/04 A.9 + B.4 and docs/03 "Offer":
   two people can accept the same request before payment; the first to be
   PAID locks, every other accepted offer is superseded and those acceptors
   see "Someone else was faster" — in-app (Updates) and on the acceptor side. */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  acceptOffer,
  createRequest,
  declineOffer,
  getRequest,
  incomingFor,
  lockRequest,
  offersFor,
  resetRequests,
  respondToIncoming,
  sendRequest,
  updates,
} from '@/lib/requests'
import { activityLog, addTrip, creditPaise, resetStore, setOpenToSwap } from '@/lib/store'

const DAY = '2026-11-12'

async function seedTwoSwappers() {
  const mine = await addTrip({
    pnr: '4512789630',
    train_no: '12951',
    journey_date: DAY,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
  for (const [pnr, coach, berth] of [
    ['4512789663', 'B6', '12'],
    ['4512789671', 'B7', '44'],
  ] as const) {
    const trip = await addTrip({
      pnr,
      train_no: '12951',
      journey_date: DAY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach, berth_no: berth, berth_type: 'UB' }],
    })
    setOpenToSwap(trip.id, true)
  }
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  return { mine, request, offers: offersFor(request.id) }
}

describe('two accept before payment (docs/04 A.9)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('both acceptances coexist and each becomes an Updates row', async () => {
    const { request, offers } = await seedTwoSwappers()
    expect(offers).toHaveLength(2)
    acceptOffer(offers[0].id, 'Arjun')
    acceptOffer(offers[1].id, 'Priya')

    const accepted = offersFor(request.id).filter((o) => o.status === 'accepted')
    expect(accepted).toHaveLength(2)
    const acceptedRows = updates().filter((row) => row.kind === 'accepted')
    expect(acceptedRows).toHaveLength(2)
    expect(getRequest(request.id)?.locked_offer_id).toBeNull()
    expect(creditPaise()).toBe(0)
  })

  it('paying for the 2nd choice locks THAT one and supersedes the 1st', async () => {
    const { request, offers } = await seedTwoSwappers()
    acceptOffer(offers[0].id, 'Arjun')
    acceptOffer(offers[1].id, 'Priya')

    const locked = lockRequest(request.id, offers[1].id)
    expect(locked?.locked_offer_id).toBe(offers[1].id)

    const byId = new Map(offersFor(request.id).map((o) => [o.id, o.status]))
    expect(byId.get(offers[1].id)).toBe('accepted')
    expect(byId.get(offers[0].id)).toBe('superseded')

    /* The superseded acceptor sees "Someone else was faster" in Updates. */
    const faster = updates().filter((row) => row.kind === 'faster')
    expect(faster).toHaveLength(1)
    expect(faster[0].request_id).toBe(request.id)
    expect(activityLog().some((row) => row.action === 'swap_locked')).toBe(true)
  })

  it('locking without naming the paid offer falls back to the first accepted', async () => {
    const { request, offers } = await seedTwoSwappers()
    acceptOffer(offers[0].id, 'Arjun')
    acceptOffer(offers[1].id, 'Priya')

    const locked = lockRequest(request.id)
    expect(locked?.locked_offer_id).toBe(offers[0].id)
    expect(offersFor(request.id).find((o) => o.id === offers[1].id)?.status).toBe('superseded')
  })

  it('backing out while another acceptance waits keeps the request paid-able', async () => {
    const { request, offers } = await seedTwoSwappers()
    acceptOffer(offers[0].id, 'Arjun')
    acceptOffer(offers[1].id, 'Priya')

    declineOffer(offers[0].id)
    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')

    /* The remaining acceptance can still be paid for and locked. */
    const locked = lockRequest(request.id, offers[1].id)
    expect(locked?.status).toBe('locked')
  })

  it('declining the LAST acceptance returns the request to searching', async () => {
    const { request, offers } = await seedTwoSwappers()
    acceptOffer(offers[0].id, 'Arjun')

    declineOffer(offers[0].id)
    expect(getRequest(request.id)?.status).toBe('searching')
    expect(getRequest(request.id)?.locked_offer_id).toBeNull()
  })
})

describe('the acceptor told "someone was faster" (docs/04 B.4)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('records the message, keeps the trip open to swap, moves no money', async () => {
    const theirs = await addTrip({
      pnr: '4512789648',
      train_no: '12951',
      journey_date: DAY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach: 'B4', berth_no: '41', berth_type: 'UB' }],
    })
    setOpenToSwap(theirs.id, true)

    const after = respondToIncoming(theirs.id, 'faster')
    expect(after?.state).toBe('faster')
    expect(incomingFor(theirs.id)?.state).toBe('faster')
    expect(activityLog()[0].action).toBe('someone_faster')
    expect(updates().some((row) => row.kind === 'incoming_faster')).toBe(true)
    expect(creditPaise()).toBe(0)
    /* Stay open: the trip is still offered to other matches. */
    expect(incomingFor(theirs.id)).toBeDefined()
  })
})
