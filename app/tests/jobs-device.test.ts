/* The scheduled jobs of docs/03 have a server wrapper (`@/server/jobs`) that
   cannot write without a service-role key, so on this device they run from
   `lib/job-sweep`. These tests pin the three effects the traveller is meant to
   get without pressing anything: a request the journey overtook, the 12-hour
   silence that settles a locked swap, and the chart-is-out flip — plus the two
   things the sweep must NOT do: charge for a dead journey, and settle early. */
import { beforeEach, describe, expect, it } from 'vitest'

import { beginCheckout, confirmCaptured } from '@/lib/checkout'
import { journeyEndMs, runDueJobs } from '@/lib/job-sweep'
import { SHIPPED_LANGS, translate } from '@/lib/i18n'
import {
  acceptOffer,
  createRequest,
  getRequest,
  offersFor,
  resetRequests,
  sendRequest,
  updates,
} from '@/lib/requests'
import { answerSwap } from '@/lib/settle'
import {
  activityLog,
  addTrip,
  creditPaise,
  getSnapshot,
  getTrip,
  listTrips,
  localDateKey,
  resetStore,
  setReminder,
  setOpenToSwap,
} from '@/lib/store'

/** 2026-11-12 journey, local-time anchors: the journey day ends at
    2026-11-13T00:00 local, so noon on the 13th is 12 h after arrival. */
const JOURNEY = '2026-11-12'
const END_OF_JOURNEY_DAY = new Date(2026, 10, 13).getTime()
const TWELVE_HOURS = 12 * 60 * 60 * 1000
const AFTER = END_OF_JOURNEY_DAY + TWELVE_HOURS + 60_000
const BEFORE = END_OF_JOURNEY_DAY + TWELVE_HOURS - 60_000

async function journey(pnr: string, berthType: 'LB' | 'UB', coach: string, berthNo: string) {
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

/** A `searching` request on a journey that is already over. */
async function deadSearch() {
  const mine = await journey('4512789630', 'LB', 'B3', '27')
  const theirs = await journey('4512789648', 'UB', 'B4', '41')
  setOpenToSwap(theirs.id, true)
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  return request
}

/** A `locked` swap nobody answered. */
async function silentLocked() {
  const mine = await journey('4512789630', 'LB', 'B3', '27')
  const theirs = await journey('4512789648', 'UB', 'B4', '41')
  setOpenToSwap(theirs.id, true)
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  acceptOffer(offersFor(request.id)[0].id)
  beginCheckout(request.id, 'razorpay')
  confirmCaptured(request.id, 'pay_1')
  return request
}

const creditRows = () => getSnapshot().wallet.filter((tx) => tx.kind !== 'used')

describe('journeyEndMs', () => {
  it('is the start of the next local day, and never a guess', () => {
    expect(journeyEndMs(JOURNEY)).toBe(END_OF_JOURNEY_DAY)
    expect(journeyEndMs(null)).toBeNull()
    expect(journeyEndMs('')).toBeNull()
    expect(journeyEndMs('12-11-2026')).toBeNull()
  })
})

describe('expire requests after the journey ends', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('expires a searching request the journey overtook, and frees its offers', async () => {
    const request = await deadSearch()
    expect(getRequest(request.id)?.status).toBe('searching')

    const report = runDueJobs(AFTER)

    expect(report.expired).toEqual([request.id])
    expect(getRequest(request.id)?.status).toBe('expired')
    expect(offersFor(request.id).every((offer) => offer.status === 'expired')).toBe(true)
    expect(activityLog().some((row) => row.action === 'request_expired')).toBe(true)
  })

  it('charges nothing for a journey that ended with no swap (rule 2)', async () => {
    const before = creditPaise()
    await deadSearch()
    runDueJobs(AFTER)
    expect(creditRows()).toHaveLength(0)
    expect(getSnapshot().payments).toHaveLength(0)
    expect(creditPaise()).toBe(before)
  })

  it('leaves a request on a future journey alone', async () => {
    const request = await deadSearch()
    runDueJobs(END_OF_JOURNEY_DAY - TWELVE_HOURS)
    expect(getRequest(request.id)?.status).toBe('searching')
  })

  it('never expires a paid swap — that goes through confirm/void (docs/03)', async () => {
    const request = await silentLocked()
    runDueJobs(AFTER)
    expect(getRequest(request.id)?.status).not.toBe('expired')
  })

  it('never guesses a trip with no journey date', async () => {
    const mine = await addTrip({
      pnr: '4512789630',
      train_no: '12951',
      journey_date: '',
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
    })
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    const report = runDueJobs(AFTER)
    expect(report.expired).toEqual([])
    expect(getRequest(request.id)?.status).toBe('searching')
  })
})

describe('auto-confirm 12h after arrival', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('settles a silent locked swap as confirmed and pays the acceptor ₹50', async () => {
    const request = await silentLocked()
    const before = creditPaise()

    const report = runDueJobs(AFTER)

    expect(report.autoConfirmed).toEqual([request.id])
    expect(getRequest(request.id)?.status).toBe('confirmed')
    const earned = creditRows().filter((tx) => tx.kind === 'acceptor_credit')
    expect(earned).toHaveLength(1)
    expect(earned[0].amount_paise).toBe(5000)
    expect(creditPaise()).toBe(before + 5000)
  })

  it('does not settle the ₹99 to credit — the swap is treated as done (rule 6 is not triggered)', async () => {
    const request = await silentLocked()
    runDueJobs(AFTER)
    expect(creditRows().some((tx) => tx.kind === 'swap_to_credit')).toBe(false)
    expect(getRequest(request.id)?.status).toBe('confirmed')
  })

  it('waits for the 12 hours (docs/03)', async () => {
    const request = await silentLocked()
    const report = runDueJobs(BEFORE)
    expect(report.autoConfirmed).toEqual([])
    expect(getRequest(request.id)?.status).toBe('locked')
  })

  it('runs once — a second sweep cannot mint the credit again', async () => {
    const request = await silentLocked()
    runDueJobs(AFTER)
    const second = runDueJobs(AFTER + TWELVE_HOURS)
    expect(second.autoConfirmed).toEqual([])
    expect(creditRows().filter((tx) => tx.kind === 'acceptor_credit')).toHaveLength(1)
    expect(getRequest(request.id)?.status).toBe('confirmed')
  })

  it('does nothing once both sides have answered', async () => {
    const request = await silentLocked()
    answerSwap(request.id, 'requester', 'swapped')
    answerSwap(request.id, 'acceptor', 'swapped')
    const before = creditPaise()
    const report = runDueJobs(AFTER)
    expect(report.autoConfirmed).toEqual([])
    expect(creditPaise()).toBe(before)
  })
})

describe('chart-is-out flip', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('flips a trip whose journey day has begun, and says so once', async () => {
    const mine = await journey('4512789630', 'LB', 'B3', '27')
    expect(getTrip(mine.id)?.chart_prepared).toBe(false)

    const report = runDueJobs(AFTER)

    expect(report.chartsOut).toContain(mine.id)
    expect(getTrip(mine.id)?.chart_prepared).toBe(true)
    expect(activityLog().filter((row) => row.action === 'chart_out')).toHaveLength(1)

    const second = runDueJobs(AFTER + TWELVE_HOURS)
    expect(second.chartsOut).toEqual([])
    expect(activityLog().filter((row) => row.action === 'chart_out')).toHaveLength(1)
  })

  it('keeps a future trip off the chart board', async () => {
    const mine = await journey('4512789630', 'LB', 'B3', '27')
    const later = await addTrip({
      pnr: '4512789696',
      train_no: '12951',
      journey_date: '2027-01-01',
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach: 'B3', berth_no: '28', berth_type: 'LB' }],
    })
    const today = localDateKey(new Date(AFTER))
    expect(later.journey_date).toBe('2027-01-01')
    expect(today).toBe('2026-11-13')

    const report = runDueJobs(AFTER)
    expect(report.chartsOut).toEqual([mine.id])
    expect(getTrip(later.id)?.chart_prepared).toBe(false)
  })

  it('counts every local trip, so the board is not a single-trip demo', async () => {
    expect(listTrips()).toHaveLength(0)
    await journey('4512789630', 'LB', 'B3', '27')
    await journey('4512789648', 'UB', 'B4', '41')
    const report = runDueJobs(AFTER)
    expect(report.chartsOut).toHaveLength(2)
  })
})

describe('the waitlist reminder has a reader', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  /** `setReminder` writes `reminder_on`; before this nothing in the app read it,
      so "Remind me" was a button that changed no behaviour (docs/04 A4). */
  async function waitlisted(reminder: boolean) {
    const trip = await addTrip({
      pnr: '4512789630',
      train_no: '12951',
      journey_date: JOURNEY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ status: 'WL', berth_type: 'LB' }],
    })
    if (reminder) setReminder(trip.id, true)
    runDueJobs(AFTER)
    return updates().filter((row) => row.trip_id === trip.id).map((row) => row.kind)
  }

  it('tells a reminded waitlisted traveller what the chart found', async () => {
    expect(await waitlisted(true)).toEqual(['waitlist_chart'])
  })

  it('never sends a waitlisted traveller the "swaps are open" invite', async () => {
    expect(await waitlisted(true)).not.toContain('chart_out')
  })

  it('leaves an un-reminded trip on the ordinary chart row', async () => {
    expect(await waitlisted(false)).toEqual(['chart_out'])
  })

  it('gives a confirmed trip the chart invite, reminder or not', async () => {
    const trip = await journey('4512789630', 'LB', 'B3', '27')
    setReminder(trip.id, true)
    runDueJobs(AFTER)
    const kinds = updates().filter((row) => row.trip_id === trip.id).map((row) => row.kind)
    expect(kinds).toEqual(['chart_out'])
  })

  it('names the row in both shipped languages', () => {
    for (const lang of SHIPPED_LANGS) {
      const copy = translate(lang, 'updates.waitlistChart', { train: '12951' })
      expect(copy).toContain('12951')
      expect(copy, `${lang} promises a confirmed berth`).not.toMatch(/your berth is confirmed|पुष्टि हो गई/)
    }
  })
})

describe('the runner is mounted', () => {
  it('runs on this device, not only as a server wrapper', () => {
    const { readFileSync } = process.getBuiltinModule('node:fs')
    const { join } = process.getBuiltinModule('node:path')
    const root = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', '__root.tsx'), 'utf8')
    expect(root).toContain('<JobRunner />')
  })
})
