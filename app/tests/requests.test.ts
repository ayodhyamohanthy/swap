/* Request + offer state machine (AGENTS.md rules 2, 3, 13; docs/03, 04 A/B).
   Sending is free · payment locks · the acceptor never pays · every transition
   writes an activity_log row · nothing here ever moves money. */

import { beforeEach, describe, expect, it } from 'vitest'

import { createInvite, inviteLink, resetInvites, resolveInvite } from '@/lib/invites'
import {
  acceptOffer,
  createRequest,
  declineOffer,
  getRequest,
  incomingFor,
  lockRequest,
  matchesFor,
  offersFor,
  resetRequests,
  respondToIncoming,
  revealedBerths,
  sendRequest,
  setRequestPaused,
  withdrawRequest,
} from '@/lib/requests'
import { activityLog, addTrip, creditPaise, resetStore, setOpenToSwap } from '@/lib/store'

const DAY = '2026-11-12'

/** Two confirmed berths on the same train + date; the second is open to swap. */
async function seed() {
  const mine = await addTrip({
    pnr: '4512789630',
    train_no: '12951',
    journey_date: DAY,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
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
  return { mine, theirs }
}

async function extraSwapper(pnr: string, coach: string, berth: string) {
  const trip = await addTrip({
    pnr,
    train_no: '12951',
    journey_date: DAY,
    class: '3A',
    passengers: [{ coach, berth_no: berth, berth_type: 'UB' }],
  })
  setOpenToSwap(trip.id, true)
  return trip
}

describe('createRequest', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('starts as a draft and needs at least one berth choice', async () => {
    const { mine } = await seed()
    expect(() => createRequest({ trip_id: mine.id, choices: [] })).toThrow('need_choice')
    const request = createRequest({ trip_id: mine.id, choices: ['UB', 'LB'] })
    expect(request.status).toBe('draft')
    expect(request.choices).toEqual(['UB', 'LB'])
  })

  it('rejects a trip that does not exist', () => {
    expect(() => createRequest({ trip_id: 'nope', choices: ['LB'] })).toThrow('trip_missing')
  })

  it('keeps at most three ranked choices', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['LB', 'MB', 'UB', 'SL'] })
    expect(request.choices).toHaveLength(3)
  })

  it('writes a draft activity_log row', async () => {
    const { mine } = await seed()
    createRequest({ trip_id: mine.id, choices: ['UB'] })
    expect(activityLog()[0].action).toBe('request_drafted')
  })
})

describe('sendRequest is free (rule 2)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('creates offers and never touches the wallet', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    const sent = sendRequest(request.id)

    expect(sent?.status).toBe('searching')
    expect(offersFor(request.id)).toHaveLength(1)
    expect(offersFor(request.id)[0].status).toBe('sent')
    /* The whole point: no money moves when a request goes out. */
    expect(creditPaise()).toBe(0)
    expect(activityLog()[0].action).toBe('request_sent')
  })

  it('does not offer to a trip that is not open to swap', async () => {
    const { mine } = await seed()
    const closed = await addTrip({
      pnr: '4512789655',
      train_no: '12951',
      journey_date: DAY,
      class: '3A',
      passengers: [{ coach: 'B5', berth_no: '9', berth_type: 'UB' }],
    })
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(offersFor(request.id).some((offer) => offer.acceptor_trip_id === closed.id)).toBe(false)
  })

  it('honours a subset picked on the matches screen', async () => {
    const { mine, theirs } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id, [theirs.id])
    expect(offersFor(request.id)).toHaveLength(1)
  })

  it('never offers the same acceptor twice', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    sendRequest(request.id)
    expect(offersFor(request.id)).toHaveLength(1)
  })

  it('pausing does not expire offers that are already out', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    setRequestPaused(request.id, true)
    expect(getRequest(request.id)?.paused).toBe(true)
    expect(offersFor(request.id)[0].status).toBe('sent')
  })
})

describe('accept then pay (rules 2, 3)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('an acceptance waits for payment, it does not lock', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    const offer = offersFor(request.id)[0]

    const accepted = acceptOffer(offer.id)
    expect(accepted.request?.status).toBe('accepted_awaiting_payment')
    expect(accepted.offer?.status).toBe('accepted')
    /* Rule 2: the swap is NOT locked until the ₹99 lands. */
    expect(getRequest(request.id)?.locked_offer_id).toBeNull()
    /* Rule 2 again: still no money. */
    expect(creditPaise()).toBe(0)
  })

  it('a second acceptance is recorded while one is already awaiting payment', async () => {
    const { mine } = await seed()
    await extraSwapper('4512789663', 'B6', '12')
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)

    const offers = offersFor(request.id)
    expect(offers).toHaveLength(2)
    acceptOffer(offers[0].id)
    /* Rule 2: until payment, other matches can still accept — the second
       acceptance becomes another accepted offer; payment picks the winner. */
    const second = acceptOffer(offers[1].id)
    expect(second.offer?.status).toBe('accepted')
    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')
    expect(getRequest(request.id)?.locked_offer_id).toBeNull()
  })

  it('declining leaves the request searching', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)

    expect(declineOffer(offersFor(request.id)[0].id)?.status).toBe('declined')
    expect(getRequest(request.id)?.status).toBe('searching')
  })

  it('locking supersedes every other offer', async () => {
    const { mine } = await seed()
    await extraSwapper('4512789671', 'B7', '44')
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    const offers = offersFor(request.id)
    acceptOffer(offers[0].id)

    const locked = lockRequest(request.id)
    expect(locked?.status).toBe('locked')
    expect(locked?.locked_offer_id).toBe(offers[0].id)
    const statuses = offersFor(request.id).map((offer) => offer.status)
    expect(statuses).toContain('accepted')
    expect(statuses).toContain('superseded')
    expect(activityLog()[0].action).toBe('swap_locked')
  })

  it('withdrawing expires the offers that are still out', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(withdrawRequest(request.id)?.status).toBe('withdrawn')
    expect(offersFor(request.id)[0].status).toBe('expired')
  })

  it('matchesFor lists candidates first, then offers once sent', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    expect(matchesFor(request.id)).toHaveLength(1)
    sendRequest(request.id)
    expect(matchesFor(request.id).filter((row) => 'offer' in row)).toHaveLength(1)
    expect(matchesFor(request.id).filter((row) => 'candidate' in row)).toHaveLength(0)
  })

  it('offers carry the acceptor berth number but never show it (rule 13)', async () => {
    const { mine, theirs } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    const offer = offersFor(request.id)[0]
    expect(offer.acceptor_trip_id).toBe(theirs.id)
    /* Stored for the post-payment reveal, hidden until then. */
    expect(offer.acceptor_berth_no).toBe('41')
    expect(offer.acceptor_coach).toBe('B4')
  })
})

describe('revealedBerths (rule 13: exact berths only after payment)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('stays hidden while searching or awaiting payment', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(revealedBerths(request.id)).toBeNull()
    acceptOffer(offersFor(request.id)[0].id)
    /* Accepted but not paid: still hidden. */
    expect(revealedBerths(request.id)).toBeNull()
  })

  it('reveals both real berths once locked — never fabricated', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    acceptOffer(offersFor(request.id)[0].id)
    lockRequest(request.id)
    expect(revealedBerths(request.id)).toEqual({ mine: 'B3 · 27', theirs: 'B4 · 41', coach: 'B4' })
  })

  it('returns null rather than a guessed berth when the number is unknown', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    const offer = offersFor(request.id)[0]
    /* Simulate a row stored before berth numbers were kept: unknown, noteditable. */
    offer.acceptor_berth_no = null
    acceptOffer(offer.id)
    lockRequest(request.id)
    expect(revealedBerths(request.id)).toBeNull()
  })

  it('returns null for a missing request', () => {
    expect(revealedBerths('nope')).toBeNull()
  })
})

describe('acceptor side never pays (rules 3, 5)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('an incoming request appears only for a confirmed open trip', async () => {
    const { theirs } = await seed()
    const incoming = incomingFor(theirs.id)
    expect(incoming?.requester_name).toBe('Priya')
    expect(incoming?.give_berth).toBe('UB')
    expect(incoming?.get_berth).toBe('LB')
    expect(incoming?.state).toBe('none')
  })

  it('a trip that is not open gets no incoming request', async () => {
    const { mine } = await seed()
    expect(incomingFor(mine.id)).toBeUndefined()
  })

  it('accepting pays nothing and still earns nothing yet', async () => {
    const { theirs } = await seed()
    respondToIncoming(theirs.id, 'accepted')
    expect(incomingFor(theirs.id)?.state).toBe('accepted')
    /* Rule 3 + 5: no charge, and no credit until the swap is confirmed done. */
    expect(creditPaise()).toBe(0)
  })

  it('decline and back-out are both logged', async () => {
    const { theirs } = await seed()
    respondToIncoming(theirs.id, 'declined')
    expect(incomingFor(theirs.id)?.state).toBe('declined')
    expect(activityLog()[0].action).toBe('offer_declined')

    respondToIncoming(theirs.id, 'backed_out')
    expect(activityLog()[0].action).toBe('acceptor_backed_out')
  })
})

describe('share codes carry nothing private (rule 13)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
    resetInvites()
  })

  it('round-trips a board code to the trip it points at', async () => {
    const { mine } = await seed()
    const invite = createInvite('board', mine.id)
    expect(invite.code).toMatch(/^ss/)
    expect(resolveInvite(invite.code)?.ref_id).toBe(mine.id)
    expect(activityLog()[0].action).toBe('invite_created')
  })

  it('the link holds no PNR, name, berth number or train number', async () => {
    const { mine } = await seed()
    const link = inviteLink(createInvite('board', mine.id))
    /* Structure, not substring luck: the code is exactly ss + 8 opaque hex
       chars, so a PNR (10 digits) or berth/train fragments cannot ride along.
       The old `not.toContain('27')` flaked whenever random hex produced '27'
       (the seeded berth number), red-blocking the suite about 1 run in 256. */
    expect(link).toMatch(/\/s\/ss[0-9a-f]{8}$/)
    expect(link).not.toContain('4512789630')
    expect(link).not.toContain('B3')
  })

  it('an unknown code resolves to nothing so the screen can say "bad link"', () => {
    expect(resolveInvite('ss-nope')).toBeUndefined()
    expect(resolveInvite('')).toBeUndefined()
  })

  it('an offer carries a first name only, never a full name', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    for (const offer of offersFor(request.id)) {
      expect(offer.acceptor_name.split(' ')).toHaveLength(1)
      expect(offer.acceptor_name).toMatch(/^[A-Za-z]+$/)
    }
  })
})

describe('client guards mirror the server machine (docs/03)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('refuses to withdraw a locked request', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    acceptOffer(offersFor(request.id)[0].id)
    lockRequest(request.id)
    expect(getRequest(request.id)?.status).toBe('locked')
    expect(withdrawRequest(request.id)).toBeUndefined()
    expect(getRequest(request.id)?.status).toBe('locked')
  })

  it('refuses to accept an already-accepted offer', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    const offer = offersFor(request.id)[0]
    expect(acceptOffer(offer.id).request?.status).toBe('accepted_awaiting_payment')
    expect(acceptOffer(offer.id)).toEqual({})
  })

  it('refuses to lock before payment', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(lockRequest(request.id)).toBeUndefined()
    expect(getRequest(request.id)?.status).toBe('searching')
  })

  it('returns an accepted request to searching when the acceptor backs out', async () => {
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    const offer = offersFor(request.id)[0]
    acceptOffer(offer.id)
    expect(getRequest(request.id)?.status).toBe('accepted_awaiting_payment')
    expect(declineOffer(offer.id)?.status).toBe('declined')
    expect(getRequest(request.id)?.status).toBe('searching')
  })
})

describe('updates read-state (docs/05 #20)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('lists new updates as unread until opened', async () => {
    const { isUpdateRead, markAllUpdatesRead, markUpdateRead, unreadUpdates, updates } = await import('@/lib/requests')
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    acceptOffer(offersFor(request.id)[0].id)
    const rows = updates()
    expect(rows.length).toBeGreaterThan(0)
    expect(unreadUpdates().map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort())
    markUpdateRead(rows[0].id)
    expect(isUpdateRead(rows[0].id)).toBe(true)
    expect(unreadUpdates()).toHaveLength(rows.length - 1)
    const marked = markAllUpdatesRead()
    expect(marked).toBe(rows.length - 1)
    expect(unreadUpdates()).toEqual([])
    expect(markAllUpdatesRead()).toBe(0)
  })

  it('keeps update ids stable across calls', async () => {
    const { updates } = await import('@/lib/requests')
    const { mine } = await seed()
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(updates().map((r) => r.id)).toEqual(updates().map((r) => r.id))
  })
})
