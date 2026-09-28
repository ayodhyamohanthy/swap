/* Rule 2, one rule: may this swap take money right now?
   L4 filed (2026-09-28) that the child pay screens render through the parent's
   <Outlet/>, so the index screen's gate never ran for /method or /paypal. The
   rule now lives in lib/pay-access and both read it, so this pins the states
   the child-screen gate depends on. */
import { beforeEach, describe, expect, it } from 'vitest'

import { payAccess, payGate } from '@/lib/pay-access'
import { beginCheckout, confirmCaptured } from '@/lib/checkout'
import {
  acceptOffer,
  createRequest,
  getRequest,
  offersFor,
  resetRequests,
  sendRequest,
} from '@/lib/requests'
import { addTrip, resetStore, setOpenToSwap } from '@/lib/store'

async function acceptedJourney() {
  const mine = await addTrip({
    pnr: '4512789630', train_no: '12951', journey_date: '2026-11-12', class: '3A',
    from_code: 'MMCT', to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
  const theirs = await addTrip({
    pnr: '4512789648', train_no: '12951', journey_date: '2026-11-12', class: '3A',
    from_code: 'MMCT', to_code: 'NDLS',
    passengers: [{ coach: 'B4', berth_no: '41', berth_type: 'UB' }],
  })
  setOpenToSwap(theirs.id, true)
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  acceptOffer(offersFor(request.id)[0].id)
  return { mine, theirs, request }
}

describe('payAccess', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('is not-yet before anyone accepts', async () => {
    const { mine } = await acceptedJourney()
    const draft = createRequest({ trip_id: mine.id, choices: ['LB'] })
    expect(payAccess(draft.id)).toBe('not-yet')
  })

  it('is missing for an id with no request at all', () => {
    expect(payAccess('nope')).toBe('missing')
    expect(payGate(undefined)).toBe('missing')
  })

  it('is payable once accepted, and the method screen may charge', async () => {
    const { request } = await acceptedJourney()
    expect(payAccess(request.id)).toBe('payable')
  })

  it('is paid after a capture, so /method can never offer a second charge', async () => {
    const { request } = await acceptedJourney()
    beginCheckout(request.id, 'razorpay')
    confirmCaptured(request.id, 'pay_live')
    expect(getRequest(request.id)?.status).toBe('locked')
    expect(payAccess(request.id)).toBe('paid')
  })
})
