/* SeatSwap session tests (docs/08 Auth): local trips attach to the account
   on sign-in, detach on sign-out, and exportForSync() keeps the payload +
   target tables ready for push (no network invented). */

import { beforeEach, describe, expect, it } from 'vitest'

import { addTrip, exportForSync, listTrips, resetStore, settings } from '@/lib/store'
import {
  emitAuthForTests,
  onAuthChange,
  pushLocalTrips,
  resetSessionForTests,
} from '@/lib/session'

async function seedTrip() {
  return addTrip({
    pnr: '4512789630',
    train_no: '12951',
    journey_date: '2026-11-12',
    class: '3A',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
}

describe('session attach/detach', () => {
  beforeEach(() => {
    resetStore()
    resetSessionForTests()
  })

  it('attaches signed-out trips to the account on SIGNED_IN', async () => {
    await seedTrip()
    expect(listTrips()[0].user_id).toBeNull()

    emitAuthForTests('SIGNED_IN', { id: 'user-1', email: 'user@example.com' })
    expect(listTrips()[0].user_id).toBe('user-1')
    expect(settings().user_id).toBe('user-1')
  })

  it('clears the account link on SIGNED_OUT', async () => {
    await seedTrip()
    emitAuthForTests('SIGNED_IN', { id: 'user-1', email: null })
    emitAuthForTests('SIGNED_OUT', null)
    expect(listTrips()[0].user_id).toBeNull()
    expect(settings().user_id).toBeNull()
  })

  it('notifies listeners in subscription order', async () => {
    const seen: string[] = []
    const off = onAuthChange((event) => { seen.push(event) })
    emitAuthForTests('SIGNED_IN', { id: 'user-1', email: null })
    emitAuthForTests('TOKEN_REFRESHED', { id: 'user-1', email: null })
    off()
    emitAuthForTests('SIGNED_OUT', null)
    expect(seen).toEqual(['SIGNED_IN', 'TOKEN_REFRESHED'])
  })
})

describe('pushLocalTrips payload shape', () => {
  beforeEach(() => {
    resetStore()
    resetSessionForTests()
  })

  it('returns bookings + passengers + activity with target tables', async () => {
    await seedTrip()
    const plan = pushLocalTrips()
    expect(plan.targets.tables).toEqual(['bookings', 'passengers', 'activity_log'])
    expect(plan.targets.counts.bookings).toBe(1)
    expect(plan.targets.counts.passengers).toBe(1)
    expect(plan.payload.bookings[0]).toMatchObject({ pnr_last4: '9630', train_no: '12951' })
    expect(plan.payload.bookings[0].local_id).toBeDefined()
    expect(plan.payload.passengers[0].local_booking_id).toBe(plan.payload.bookings[0].local_id)
    expect(plan.payload.activity.length).toBeGreaterThan(0)
    // Same shape exportForSync() produces: safe to push row-for-row.
    expect(plan.payload).toEqual(exportForSync())
  })
})
