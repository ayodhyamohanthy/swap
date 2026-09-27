/* Family trips: organiser links PNRs, ₹199 covers up to 3 swaps (docs/04 C). */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createGroup,
  getGroup,
  groupTogetherCount,
  linkTrip,
  listGroups,
  markGroupPaid,
  resetGroups,
} from '@/lib/groups'
import { GROUP_PRICE_PAISE } from '@/lib/money'
import { buildQuote } from '@/lib/payments'
import { beginCheckout, confirmCaptured, lockCoveredRequest } from '@/lib/checkout'
import {
  acceptOffer,
  createRequest,
  getRequest,
  groupLockedCount,
  offersFor,
  resetRequests,
  sendRequest,
} from '@/lib/requests'
import {
  addTrip,
  credit,
  listPayments,
  resetStore,
  setOpenToSwap,
} from '@/lib/store'

describe('family groups', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetGroups()
  })

  it('creates, links and pays a group at ₹199', () => {
    expect(GROUP_PRICE_PAISE).toBe(19900)
    const group = createGroup('Sharma family', ['t1'])
    expect(group.id.startsWith('grp_')).toBe(true)
    expect(group.paid).toBe(false)
    expect(linkTrip(group.id, 't2')?.trip_ids).toEqual(['t1', 't2'])
    expect(linkTrip(group.id, 't2')).toBeUndefined()
    expect(markGroupPaid(group.id)?.paid).toBe(true)
    expect(getGroup(group.id)?.paid).toBe(true)
    expect(listGroups()).toHaveLength(1)
  })

  it('quotes the group price once for the whole trip', () => {
    const quote = buildQuote(0, true)
    expect(quote.total).toBe(19900)
    expect(quote.due).toBe(19900)
    const covered = buildQuote(19900, true)
    expect(covered.provider).toBe('credit')
    expect(covered.due).toBe(0)
  })

  it('counts togetherness off missing trips', () => {
    const group = createGroup('Nobody here', ['ghost1', 'ghost2'])
    expect(groupTogetherCount(group)).toEqual({ done: 0, total: 0 })
    expect(markGroupPaid('nope')).toBeUndefined()
  })
})

describe('group checkout (docs/01, docs/04 C)', () => {
  const DAY = '2026-11-12'
  let n = 0
  async function memberTrip(coach: string, berth: string, type: 'LB' | 'UB'): Promise<string> {
    n += 1
    const trip = await addTrip({
      pnr: `45127896${String(30 + n).padStart(2, '0')}`,
      train_no: '12951',
      journey_date: DAY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach, berth_no: berth, berth_type: type }],
    })
    return trip.id
  }
  async function acceptorTrip(): Promise<string> {
    n += 1
    const trip = await addTrip({
      pnr: `45127896${String(30 + n).padStart(2, '0')}`,
      train_no: '12951',
      journey_date: DAY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach: 'B9', berth_no: '41', berth_type: 'UB' }],
    })
    setOpenToSwap(trip.id, true)
    return trip.id
  }
  async function acceptedMemberRequest(tripId: string) {
    const request = createRequest({ trip_id: tripId, choices: ['UB'] })
    sendRequest(request.id)
    const offer = offersFor(request.id)[0]
    acceptOffer(offer.id)
    return request
  }

  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
    resetRequests()
    resetGroups()
    n = 0
  })

  it('requests inherit the trip group; explicit override wins', async () => {
    const t1 = await memberTrip('B1', '11', 'LB')
    const t2 = await memberTrip('B1', '12', 'LB')
    const group = createGroup('Sharma family', [t1])
    expect(createRequest({ trip_id: t1, choices: ['UB'] }).group_id).toBe(group.id)
    expect(createRequest({ trip_id: t2, choices: ['UB'] }).group_id).toBeNull()
    expect(createRequest({ trip_id: t1, choices: ['UB'], group_id: null }).group_id).toBeNull()
  })

  it('pays ₹199 once and marks the group paid (no per-request charge)', async () => {
    const t1 = await memberTrip('B1', '11', 'LB')
    const group = createGroup('Sharma family', [t1])
    const ticket = beginCheckout(group.id, 'razorpay')
    expect(ticket.total).toBe(19900)
    expect(ticket.settled).toBe(false)
    expect(getGroup(group.id)?.paid).toBe(false)
    const done = confirmCaptured(group.id, 'order_demo_1')
    expect(done.settled).toBe(true)
    expect(done.status).toBe('paid')
    expect(getGroup(group.id)?.paid).toBe(true)
    /* Second attempt reuses the paid row — never a double charge. */
    expect(beginCheckout(group.id, 'razorpay').settled).toBe(true)
    expect(listPayments().filter((p) => p.request_id === group.id)).toHaveLength(1)
  })

  it('credit can cover the group payment oldest-first', async () => {
    const t1 = await memberTrip('B1', '11', 'LB')
    const t2 = await memberTrip('B1', '12', 'LB')
    const partial = createGroup('Partial family', [t1])
    const full = createGroup('Full family', [t2])
    credit({ to: 'requester', amountPaise: 9900, kind: 'swap_to_credit', ref_request_id: null })
    credit({ to: 'acceptor', amountPaise: 5000, kind: 'acceptor_credit', ref_request_id: null })
    /* Balance 14900 < 19900: gateway still due the rest. */
    expect(beginCheckout(partial.id, 'razorpay').due).toBe(5000)
    credit({ to: 'requester', amountPaise: 9900, kind: 'swap_to_credit', ref_request_id: null })
    const covered = beginCheckout(full.id, 'razorpay')
    expect(covered.settled).toBe(true)
    expect(covered.provider).toBe('credit')
    expect(getGroup(full.id)?.paid).toBe(true)
  })

  it('rejects checkout for an unknown group', () => {
    expect(() => beginCheckout('grp_nope', 'razorpay')).toThrow('request_not_found')
  })

  it('covers up to 3 member locks, then the 4th pays per-request', async () => {
    const tripIds = [await memberTrip('B1', '11', 'LB'), await memberTrip('B1', '12', 'LB'), await memberTrip('B2', '21', 'LB'), await memberTrip('B2', '22', 'LB')]
    const group = createGroup('Sharma family', tripIds)
    await acceptorTrip()
    /* Pay the group trip first. */
    const paid = beginCheckout(group.id, 'razorpay')
    confirmCaptured(group.id, 'order_demo_grp')
    expect(paid.total).toBe(19900)
    const locked: string[] = []
    for (const tripId of tripIds) {
      const request = await acceptedMemberRequest(tripId)
      if (locked.length < 3) {
        expect(lockCoveredRequest(request.id)?.status).toBe('locked')
        locked.push(request.id)
        /* Covered locks mint no payment rows of their own. */
        expect(listPayments().filter((p) => p.request_id === request.id)).toHaveLength(0)
      } else {
        expect(() => lockCoveredRequest(request.id)).toThrow('group_swap_cap')
        /* The 4th swap is not blocked outright — it pays the normal ₹99. */
        const single = beginCheckout(request.id, 'razorpay')
        expect(single.total).toBe(9900)
        confirmCaptured(request.id, 'order_demo_4th')
        expect(getRequest(request.id)?.status).toBe('locked')
      }
    }
    expect(groupLockedCount(group.id)).toBe(4)
  })

  it('unpaid-group members pay the normal ₹99', async () => {
    const t1 = await memberTrip('B1', '11', 'LB')
    createGroup('Sharma family', [t1])
    await acceptorTrip()
    const request = await acceptedMemberRequest(t1)
    const ticket = beginCheckout(request.id, 'razorpay')
    expect(ticket.total).toBe(9900)
    confirmCaptured(request.id, 'order_demo_solo')
    expect(getRequest(request.id)?.status).toBe('locked')
  })

  it('covered lock requires acceptance first', async () => {
    const t1 = await memberTrip('B1', '11', 'LB')
    createGroup('Sharma family', [t1])
    await acceptorTrip()
    const request = createRequest({ trip_id: t1, choices: ['UB'] })
    sendRequest(request.id)
    expect(() => lockCoveredRequest(request.id)).toThrow('not_awaiting_payment')
  })
})
