/* The accept board drives the requester's state machine (docs/03, docs/04 A.9).

   `respondToIncoming` used to write ONLY the incoming map while logging
   `offer_accepted` — the activity log claimed an acceptance the state machine
   had never seen: offer stayed `sent`, request stayed `searching`, so
   "Someone says yes → Pay ₹99" was unreachable from real taps and the log was
   lying about a row that had not moved. These tests pin the bridge, the two
   stand-in cases where there is no offer to move, and rule 2 (acceptance
   waits, it does not lock). */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  acceptOffer,
  createRequest,
  getRequest,
  incomingFor,
  offersFor,
  respondToIncoming,
  resetRequests,
  sendRequest,
  updates,
} from '@/lib/requests'
import { activityLog, addTrip, creditPaise, resetStore, setOpenToSwap } from '@/lib/store'

const DAY = '2026-11-14'

/** Requester's confirmed berth + one open berth to accept against. */
async function seed() {
  const mine = await addTrip({
    pnr: '4512789711',
    train_no: '12951',
    journey_date: DAY,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
  const theirs = await addTrip({
    pnr: '4512789729',
    train_no: '12951',
    journey_date: DAY,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B4', berth_no: '41', berth_type: 'UB' }],
  })
  setOpenToSwap(theirs.id, true)
  return { mine, theirs }
}

/** A real request with a real `sent` offer pointing at `theirs`. */
function sendTo(theirs: Awaited<ReturnType<typeof addTrip>>, mine: Awaited<ReturnType<typeof addTrip>>) {
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  const offer = offersFor(request.id).find((row) => row.acceptor_trip_id === theirs.id)
  if (!offer) throw new Error('no offer for the open trip')
  return { request, offer }
}

describe('the accept board drives the offer (docs/03 first acceptance)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('Accept flips offer AND request, and the requester gets the Updates row', async () => {
    const { mine, theirs } = await seed()
    const { request } = sendTo(theirs, mine)

    respondToIncoming(theirs.id, 'accepted')

    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')
    const offer = offersFor(request.id)[0]
    expect(offer.status).toBe('accepted')
    expect(offer.responded_at).toBeTruthy()
    /* Rule 2: acceptance waits for the ₹99 — no lock, no money. */
    expect(getRequest(request.id)?.locked_offer_id).toBeNull()
    expect(creditPaise()).toBe(0)
    /* docs/04 A.9: the requester hears about it from the Updates list. */
    expect(updates().some((row) => row.kind === 'accepted' && row.request_id === request.id)).toBe(true)
    /* Exactly one acceptance row — driven means the board does not also log. */
    const acceptances = activityLog().filter((row) => row.action === 'offer_accepted')
    expect(acceptances).toHaveLength(1)
  })

  it('Decline closes the sent offer and leaves the request searching', async () => {
    const { mine, theirs } = await seed()
    const { request } = sendTo(theirs, mine)

    respondToIncoming(theirs.id, 'declined')

    expect(offersFor(request.id)[0].status).toBe('declined')
    expect(getRequest(request.id)?.status).toBe('searching')
    expect(updates().some((row) => row.kind === 'accepted')).toBe(false)
  })

  it('Back out after an accept returns the request to searching (docs/04 B.4)', async () => {
    const { mine, theirs } = await seed()
    const { request } = sendTo(theirs, mine)
    respondToIncoming(theirs.id, 'accepted')
    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')

    respondToIncoming(theirs.id, 'backed_out')

    expect(offersFor(request.id)[0].status).toBe('declined')
    expect(getRequest(request.id)?.status).toBe('searching')
    expect(incomingFor(theirs.id)?.state).toBe('backed_out')
  })

  it('the stand-in board (no offer behind the trip) still logs and never throws', async () => {
    const { theirs } = await seed()

    const after = respondToIncoming(theirs.id, 'accepted')

    expect(after?.state).toBe('accepted')
    const rows = activityLog().filter((row) => row.action === 'offer_accepted')
    expect(rows).toHaveLength(1)
    expect(rows[0].meta).toMatchObject({ side: 'acceptor', trip: theirs.id })
  })

  it('declining the stand-in board keeps the side/trip meta too', async () => {
    const { theirs } = await seed()

    respondToIncoming(theirs.id, 'declined')
    respondToIncoming(theirs.id, 'backed_out')

    const declined = activityLog().filter((row) => row.action === 'offer_declined')
    const backedOut = activityLog().filter((row) => row.action === 'acceptor_backed_out')
    expect(declined).toHaveLength(1)
    expect(declined[0].meta).toMatchObject({ side: 'acceptor', trip: theirs.id })
    expect(backedOut).toHaveLength(1)
  })

  it('accepting twice through the board does not double-accept an offer', async () => {
    const { mine, theirs } = await seed()
    const { request } = sendTo(theirs, mine)

    respondToIncoming(theirs.id, 'accepted')
    respondToIncoming(theirs.id, 'accepted')

    expect(offersFor(request.id)[0].status).toBe('accepted')
    expect(activityLog().filter((row) => row.action === 'offer_accepted')).toHaveLength(1)
    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')
  })

  it('the direct offer path is unchanged (the two entry points agree)', async () => {
    const { mine, theirs } = await seed()
    const { request, offer } = sendTo(theirs, mine)

    const accepted = acceptOffer(offer.id)

    expect(accepted.request?.status).toBe('accepted_awaiting_payment')
    expect(accepted.offer?.status).toBe('accepted')
    expect(getRequest(request.id)?.locked_offer_id).toBeNull()
  })
})
