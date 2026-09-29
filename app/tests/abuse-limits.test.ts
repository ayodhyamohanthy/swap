/* docs/03 abuse limits, on the device. `rankMatches` already implements the
   inbound cap and the back-out hide, and `matching.ts` was written against
   `CandidateSpec` fields nothing ever filled — so both rules were dead code and
   the Settings screen's "More requests per day" switch had no reader. These
   tests pin the data side: the cap is measured, the back-outs are counted, and
   a berth that should stop appearing stops appearing. */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BACKOUT_LIMIT,
  hiddenForAbuse,
  incomingFor,
  matchesFor,
  receivedToday,
  receivedTodayForUser,
  createRequest,
  resetRequests,
  respondToIncoming,
  sendRequest,
} from '@/lib/requests'
import {
  addTrip,
  logActivity,
  resetStore,
  settings,
  updateSettings,
  setOpenToSwap,
  type Trip,
} from '@/lib/store'

const JOURNEY = '2026-11-12'

async function trip(pnr: string, coach: string, berthNo: string, berthType: 'LB' | 'UB'): Promise<Trip> {
  return addTrip({
    pnr,
    train_no: '12951',
    journey_date: JOURNEY,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach, berth_no: berthNo, berth_type: berthType }],
  })
}

/** One open UB trip (the acceptor) plus requester trips on the same train. */
async function pool() {
  const acceptor = await trip('4512789648', 'B4', '41', 'UB')
  setOpenToSwap(acceptor.id, true)
  const requesters: Trip[] = []
  for (const [index, pnr] of ['4512789630', '4512789631', '4512789632', '4512789633', '4512789634'].entries()) {
    requesters.push(await trip(pnr, 'B3', String(27 + index), 'LB'))
  }
  return { acceptor, requesters }
}

/** Send a request from `trip` and let it offer itself to the open berth. */
function sendOneToAcceptor(from: Trip): void {
  sendRequest(createRequest({ trip_id: from.id, choices: ['UB'] }).id)
}

describe('inbound cap (docs/03, default 3/day)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('counts the offers a trip received today', async () => {
    const { acceptor, requesters } = await pool()
    expect(receivedToday(acceptor.id)).toBe(0)
    sendOneToAcceptor(requesters[0])
    expect(receivedToday(acceptor.id)).toBe(1)
    expect(receivedTodayForUser()).toBe(1)
  })

  it('drops an over-requested berth from the match list', async () => {
    const { acceptor, requesters } = await pool()
    expect(settings().max_requests_per_day).toBe(3)
    for (const requester of requesters.slice(0, 3)) sendOneToAcceptor(requester)
    expect(receivedToday(acceptor.id)).toBe(3)

    const fourth = createRequest({ trip_id: requesters[3].id, choices: ['UB'] })
    expect(matchesFor(fourth.id).filter((row) => 'candidate' in row)).toEqual([])
    expect(sendRequest(fourth.id)).toBeDefined()
    expect(receivedToday(acceptor.id)).toBe(3)
  })

  it('lists the berth again when the traveller raises their own cap', async () => {
    const { acceptor, requesters } = await pool()
    for (const requester of requesters.slice(0, 3)) sendOneToAcceptor(requester)

    updateSettings({ max_requests_per_day: 10 })
    const fourth = createRequest({ trip_id: requesters[3].id, choices: ['UB'] })
    expect(matchesFor(fourth.id).some((row) => 'candidate' in row && row.candidate.id === acceptor.id)).toBe(true)
  })

  it('closes the acceptor board at the cap and reopens it above it', async () => {
    const { acceptor, requesters } = await pool()
    expect(incomingFor(acceptor.id)).toBeDefined()
    for (const requester of requesters.slice(0, 3)) sendOneToAcceptor(requester)

    expect(receivedTodayForUser()).toBe(3)
    expect(incomingFor(acceptor.id)).toBeUndefined()

    updateSettings({ max_requests_per_day: 10 })
    expect(incomingFor(acceptor.id)).toBeDefined()
  })
})

describe('backed out 3 times in 30 days → hidden (docs/03)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  /** Accept, then back out — the row `acceptor_backed_out` is what the limit counts. */
  function backOut(tripId: string) {
    respondToIncoming(tripId, 'accepted')
    respondToIncoming(tripId, 'backed_out')
  }

  it('counts nothing before the traveller has backed out', async () => {
    const { acceptor } = await pool()
    expect(hiddenForAbuse(acceptor.id)).toBe(false)
  })

  it('stays visible under the limit', async () => {
    const { acceptor } = await pool()
    for (let i = 0; i < BACKOUT_LIMIT - 1; i += 1) backOut(acceptor.id)
    expect(hiddenForAbuse(acceptor.id)).toBe(false)
    expect(incomingFor(acceptor.id)).toBeDefined()
  })

  it('hides the traveller from matches once they hit it', async () => {
    const { acceptor, requesters } = await pool()
    for (let i = 0; i < BACKOUT_LIMIT; i += 1) backOut(acceptor.id)
    expect(hiddenForAbuse(acceptor.id)).toBe(true)

    const request = createRequest({ trip_id: requesters[0].id, choices: ['UB'] })
    expect(matchesFor(request.id).filter((row) => 'candidate' in row)).toEqual([])
    sendRequest(request.id)
    expect(receivedToday(acceptor.id)).toBe(0)
  })

  it('hides only the booking that backed out', async () => {
    const { acceptor, requesters } = await pool()
    const other = await trip('4512789660', 'B5', '57', 'UB')
    setOpenToSwap(other.id, true)
    for (let i = 0; i < BACKOUT_LIMIT; i += 1) backOut(acceptor.id)

    const request = createRequest({ trip_id: requesters[0].id, choices: ['UB'] })
    const ids = matchesFor(request.id)
      .filter((row) => 'candidate' in row)
      .map((row) => ('candidate' in row ? row.candidate.id : ''))
    expect(ids).toEqual([other.id])
    expect(hiddenForAbuse(other.id)).toBe(false)
  })

  it('stops showing new requests on the hidden traveller’s own board', async () => {
    const { acceptor } = await pool()
    /* The board holds one row per trip and that row is terminal once answered,
       so backing out through the UI leaves the trip in the `backed_out` branch
       and never reaches the new-request gate. Writing the rows the server would
       write is the only way to hide a traveller whose board is still unanswered. */
    for (let i = 0; i < BACKOUT_LIMIT; i += 1) {
      logActivity('acceptor_backed_out', {}, { type: 'booking', id: acceptor.id })
    }
    expect(hiddenForAbuse(acceptor.id)).toBe(true)
    expect(incomingFor(acceptor.id)).toBeUndefined()
  })
})
