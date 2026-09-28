/* Design 11a (docs/05 screen 55) — the Home state a traveller gets once every
   journey is in the past: "Welcome back", the credit card, "Add your next PNR"
   and the "Past trips" list. The helpers under test are what keep that screen
   honest: which trips are past, which one actually swapped, and the order the
   list prints them in. Pure functions plus the real request flow — no browser
   (qa-layout-offline.test.ts guards the screen structure). */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { beforeEach, describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'
import type { BerthType } from '@/lib/pnr'
import {
  acceptOffer,
  createRequest,
  getRequest,
  lockRequest,
  offersFor,
  resetRequests,
  sendRequest,
  settleRequest,
} from '@/lib/requests'
import {
  addTrip,
  isPastTrip,
  localDateKey,
  resetStore,
  setOpenToSwap,
  tripsNewestFirst,
  tripWasSwapped,
} from '@/lib/store'

const APP = join(import.meta.dirname, '..')
const DAY_MS = 86_400_000
const DAY = '2026-11-12'

function read(rel: string): string {
  return readFileSync(join(APP, rel), 'utf8')
}

function dayKeyFromNow(offsetDays: number): string {
  return localDateKey(new Date(Date.now() + offsetDays * DAY_MS))
}

async function seedTrip(pnr: string, journeyDate: string, berthType: BerthType = 'LB') {
  return addTrip({
    pnr,
    train_no: '12951',
    journey_date: journeyDate,
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: berthType }],
  })
}

/** Two berths on one train/date, the second open to swap and holding the UB
    the request will ask for (docs/04 B1). */
async function seedPair(journeyDate: string) {
  const mine = await seedTrip('4512789630', journeyDate)
  const theirs = await seedTrip('4512789648', journeyDate, 'UB')
  setOpenToSwap(theirs.id, true)
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  return { mine, theirs, request }
}

describe('trip history helpers (design 11a)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('reads today as a local calendar day, zero-padded like journey_date', () => {
    expect(localDateKey(new Date(2026, 5, 12, 9, 41))).toBe('2026-06-12')
    /* Padding is load-bearing: '2026-1-5' would break the string compare. */
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('treats today as upcoming and a null date as never-in-history', async () => {
    const today = await seedTrip('4512789630', dayKeyFromNow(0))
    const yesterday = await seedTrip('4512789648', dayKeyFromNow(-1))
    const tomorrow = await seedTrip('4512789656', dayKeyFromNow(1))
    const undated = await seedTrip('4512789663', '')
    const todayKey = localDateKey()
    expect(isPastTrip(today, todayKey)).toBe(false)
    expect(isPastTrip(yesterday, todayKey)).toBe(true)
    expect(isPastTrip(tomorrow, todayKey)).toBe(false)
    expect(isPastTrip(undated, todayKey)).toBe(false)
  })

  it('orders the past list newest first without touching the input', async () => {
    const older = await seedTrip('4512789630', '2026-04-18')
    const newest = await seedTrip('4512789648', '2026-06-12')
    const middle = await seedTrip('4512789656', '2026-05-03')
    const input = [older, middle, newest]
    expect(tripsNewestFirst(input).map((trip) => trip.id)).toEqual([
      newest.id,
      middle.id,
      older.id,
    ])
    expect(input.map((trip) => trip.id)).toEqual([older.id, middle.id, newest.id])
  })

  it('marks a trip swapped only once the swap is confirmed, on both sides', async () => {
    const { mine, theirs, request } = await seedPair(DAY)
    const offer = offersFor(request.id)[0]
    acceptOffer(offer.id)
    lockRequest(request.id, offer.id)

    /* Rule 2 vs design 11a: paid means `locked`, which is NOT "swapped" — the
       pill may appear only after `confirmed` (docs/03's single write on the
       locked→confirmed edge). */
    expect(tripWasSwapped(mine.id, [getRequest(request.id)!], offersFor(request.id))).toBe(false)

    settleRequest(request.id, 'confirmed')
    const confirmed = [getRequest(request.id)!]
    expect(tripWasSwapped(mine.id, confirmed, offersFor(request.id))).toBe(true)
    expect(tripWasSwapped(theirs.id, confirmed, offersFor(request.id))).toBe(true)
  })

  it('never lets a superseded offer mark its trip swapped', async () => {
    const mine = await seedTrip('4512789630', DAY)
    const winnerTrip = await seedTrip('4512789648', DAY, 'UB')
    const loserTrip = await seedTrip('4512789656', DAY, 'UB')
    setOpenToSwap(winnerTrip.id, true)
    setOpenToSwap(loserTrip.id, true)
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)

    const offers = offersFor(request.id)
    expect(offers).toHaveLength(2)
    acceptOffer(offers[0].id)
    acceptOffer(offers[1].id)
    lockRequest(request.id, offers[0].id)
    settleRequest(request.id, 'confirmed')

    const confirmed = [getRequest(request.id)!]
    const after = offersFor(request.id)
    expect(after.filter((offer) => offer.status === 'superseded')).toHaveLength(1)
    expect(tripWasSwapped(offers[0].acceptor_trip_id, confirmed, after)).toBe(true)
    /* The superseded match was paid-around, not swapped — its trip must keep
       reading "Completed", or the past list would credit two berths for one
       confirmed swap. */
    expect(tripWasSwapped(offers[1].acceptor_trip_id, confirmed, after)).toBe(false)
  })

  it('does not call a voided swap "swapped"', async () => {
    const { mine, request } = await seedPair(DAY)
    const offer = offersFor(request.id)[0]
    acceptOffer(offer.id)
    lockRequest(request.id, offer.id)
    settleRequest(request.id, 'voided')
    expect(tripWasSwapped(mine.id, [getRequest(request.id)!], offersFor(request.id))).toBe(false)
  })

  it('ships the 11a copy in both languages', () => {
    for (const catalog of [en, hi]) {
      expect(catalog.home.pastTrips).toBeTruthy()
      expect(catalog.home.addNextPnr).toBeTruthy()
      expect(catalog.home.swapped).toBeTruthy()
      expect(catalog.home.completed).toBeTruthy()
    }
    expect(hi.home.pastTrips).not.toBe(en.home.pastTrips)
    expect(hi.home.addNextPnr).not.toBe(en.home.addNextPnr)
  })

  it('keeps berth numbers out of both list cards (rule 13)', () => {
    expect(read('src/components/trip-card.tsx')).not.toMatch(/berth_no/)
  })

  it('wires the screen to the tested helpers', () => {
    const src = read('src/routes/index.tsx')
    expect(src).toMatch(/isPastTrip\(/)
    expect(src).toMatch(/tripsNewestFirst\(/)
    expect(src).toMatch(/tripWasSwapped\(/)
    expect(src).toMatch(/<PastTripCard/)
  })
})
