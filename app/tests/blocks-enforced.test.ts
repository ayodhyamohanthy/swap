/* "Report & block" (docs/04 step 12) has to block. `rankMatches` was written
   with a `blocked` filter and `CandidateSpec` declared the field, but the local
   pool never filled it, so the chat button filed an incident and the next
   request offered the same traveller back. These tests drive the real path:
   block through `blockUser` the way the screen does, then ask the matcher. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createRequest,
  matchesFor,
  receivedToday,
  resetRequests,
  sendRequest,
} from '@/lib/requests'
import { blockUser, resetBlocks, tripHandle } from '@/lib/safety'
import { addTrip, resetStore, setOpenToSwap, type Trip } from '@/lib/store'

const JOURNEY = '2026-11-12'

function trip(pnr: string, coach: string, berthNo: string, berthType: 'LB' | 'UB'): Promise<Trip> {
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

/** One open UB berth to swap with, plus my LB trips. */
async function pool() {
  const acceptor = await trip('4512789648', 'B4', '41', 'UB')
  setOpenToSwap(acceptor.id, true)
  const neighbour = await trip('4512789649', 'B4', '43', 'UB')
  setOpenToSwap(neighbour.id, true)
  const me = await trip('4512789630', 'B3', '27', 'LB')
  return { acceptor, neighbour, me }
}

function candidateIds(requestId: string): string[] {
  return matchesFor(requestId)
    .filter((row) => 'candidate' in row)
    .map((row) => ('candidate' in row ? row.candidate.id : ''))
}

describe('a blocked traveller leaves the match pool', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
    resetBlocks()
  })

  it('lists both open berths while nobody is blocked', async () => {
    const { acceptor, neighbour, me } = await pool()
    const ids = candidateIds(createRequest({ trip_id: me.id, choices: ['UB'] }).id)
    expect(ids).toContain(acceptor.id)
    expect(ids).toContain(neighbour.id)
  })

  it('drops the berth the traveller blocked', async () => {
    const { acceptor, neighbour, me } = await pool()
    await blockUser({ blockerId: 'local_user', blockedId: tripHandle(acceptor.id) }, null)

    const ids = candidateIds(createRequest({ trip_id: me.id, choices: ['UB'] }).id)
    expect(ids).toEqual([neighbour.id])
  })

  it('sends no offer to the blocked berth, even when ticked by hand', async () => {
    const { acceptor, me } = await pool()
    await blockUser({ blockerId: 'local_user', blockedId: tripHandle(acceptor.id) }, null)

    const request = createRequest({ trip_id: me.id, choices: ['UB'] })
    sendRequest(request.id, [acceptor.id])
    expect(receivedToday(acceptor.id)).toBe(0)
  })

  it('keeps sending to everyone else', async () => {
    const { acceptor, neighbour, me } = await pool()
    await blockUser({ blockerId: 'local_user', blockedId: tripHandle(acceptor.id) }, null)

    sendRequest(createRequest({ trip_id: me.id, choices: ['UB'] }).id)
    expect(receivedToday(neighbour.id)).toBe(1)
    expect(receivedToday(acceptor.id)).toBe(0)
  })

  it('hides only the booking that was blocked', async () => {
    /* The handle names one booking. Nothing here infers "and anyone related to
       them": the next berth on the coach stays matchable. */
    const { acceptor, me, neighbour } = await pool()
    const otherSeat = await trip('4512789650', 'B5', '58', 'UB')
    setOpenToSwap(otherSeat.id, true)
    await blockUser({ blockerId: 'local_user', blockedId: tripHandle(acceptor.id) }, null)

    const ids = candidateIds(createRequest({ trip_id: me.id, choices: ['UB'] }).id)
    expect(ids).not.toContain(acceptor.id)
    expect(ids).toEqual(expect.arrayContaining([neighbour.id, otherSeat.id]))
  })

  it('is not one request’s cancellation: a later request still hides them', async () => {
    const { acceptor, me } = await pool()
    await blockUser({ blockerId: 'local_user', blockedId: tripHandle(acceptor.id) }, null)
    const second = await trip('4512789631', 'B3', '29', 'LB')

    /* The block is on the traveller, not on one request. */
    expect(candidateIds(createRequest({ trip_id: me.id, choices: ['UB'] }).id)).not.toContain(
      acceptor.id,
    )
    expect(candidateIds(createRequest({ trip_id: second.id, choices: ['UB'] }).id)).not.toContain(
      acceptor.id,
    )
  })
})

/* Guards on the wiring, not the behaviour: both ends of the handle are strings
   written in different files, and the device store is a new one that account
   deletion has to know about. */
describe('block wiring', () => {
  const src = (path: string[]) =>
    readFileSync(join(import.meta.dirname, '..', 'src', ...path), 'utf8')

  it('fills `blocked` in the candidate pool from the device block list', () => {
    const requests = src(['lib', 'requests.ts'])
    expect(requests).toContain('blocked: isBlocked(tripHandle(trip.id))')
  })

  it('has the chat screen block the booking it reported', () => {
    const chat = src(['routes', 'chat.$id.tsx'])
    expect(chat).toContain('tripHandle(offer.acceptor_trip_id)')
    expect(chat).not.toMatch(/`trip:\$\{/)
  })

  it('wipes the block list when the account is deleted', () => {
    const del = src(['routes', 'profile.delete.tsx'])
    expect(del).toContain('resetBlocks()')
    expect(del).toContain('resetOutbox()')
  })
})
