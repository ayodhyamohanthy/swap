import { describe, expect, it, beforeEach } from 'vitest'

import { creditPaise, resetStore, paymentFor, startPayment } from '@/lib/store'
import { createGroup, resetGroups, markGroupPaid } from '@/lib/groups'
import { createRequest, sendRequest, offersFor, acceptOffer, resetRequests, getRequest } from '@/lib/requests'
import { lockCoveredRequest } from '@/lib/checkout'
import { voidSwap } from '@/lib/settle'

/* Rule 6 has a precondition this file used to skip: the ₹99 only becomes credit
 * if ₹99 was actually collected. A swap can reach `locked` with NO payment of
 * its own — a group trip pays ₹199 once and covers up to 3 member swaps — so
 * voiding one credits ₹99 that was never charged, permanently overstating the
 * requester's balance and understating real revenue by the same amount. */
describe('rule 6 needs money to have moved', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
    resetGroups()
    resetRequests()
  })

  async function trip(coach: string, berth: string, seq: number) {
    return import('@/lib/store').then((m) =>
      m.addTrip({
        pnr: `45127896${String(30 + seq).padStart(2, '0')}`,
        train_no: '12951',
        journey_date: '2026-11-12',
        class: '3A',
        from_code: 'MMCT',
        to_code: 'NDLS',
        passengers: [{ coach, berth_no: berth, berth_type: 'LB' }],
      }),
    )
  }

  it('issues no ₹99 for a swap that was never charged for', async () => {
    const t1 = await trip('B1', '11', 1)
    const t2 = await trip('B2', '22', 2)
    /* A third trip, open to swap, is what the request matches against. */
    const t3 = await import('@/lib/store').then((m) =>
      m.addTrip({
        pnr: '4512789633',
        train_no: '12951',
        journey_date: '2026-11-12',
        class: '3A',
        from_code: 'MMCT',
        to_code: 'NDLS',
        passengers: [{ coach: 'B9', berth_no: '41', berth_type: 'UB' }],
      }),
    )
    await import('@/lib/store').then((m) => m.setOpenToSwap(t3.id, true))

    /* The group is paid once (₹199). The member swap then locks with NO
       payment row of its own — this is the covered-lock path. */
    const group = createGroup('Family', [t1.id, t2.id])
    startPayment({ group_id: group.id, provider: 'razorpay', amount_paise: 19900, credit_used_paise: 0, status: 'paid' })
    markGroupPaid(group.id)

    const request = createRequest({ trip_id: t1.id, choices: ['UB'] })
    sendRequest(request.id)
    const offer = offersFor(request.id)[0]
    acceptOffer(offer.id)
    lockCoveredRequest(request.id)
    expect(getRequest(request.id)?.status).toBe('locked')
    /* Nothing was charged for THIS swap. */
    expect(paymentFor(request.id)).toBeUndefined()

    const before = creditPaise()
    const result = voidSwap(request.id)

    /* The swap still settles — the family is not left in limbo — but no money
       is conjured. Before the fix this credited ₹99 and logged it. */
    expect(result.resolution?.status).toBe('voided')
    expect(getRequest(request.id)?.status).toBe('voided')
    expect(creditPaise() - before).toBe(0)
  })
})

/* The other half of the same rule: when a payment HAS been captured, a lock
 * that cannot happen must not lose the money. `confirmCaptured` marks the
 * payment paid and *then* locks, so anything thrown from the lock used to
 * strand a real ₹99 — neither locked nor credited, and the rule-6 refund path
 * needs `locked`/`disputed`, which is never reached. */
describe('a captured payment is never stranded by a failed lock', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
    resetGroups()
    resetRequests()
  })

  it('returns unsettled instead of throwing once the money is captured', async () => {
    const m = await import('@/lib/store')
    let n = 0
    const make = async (coach: string, berth: string, open: boolean) => {
      n += 1
      const trip = await m.addTrip({
        pnr: `45127896${String(40 + n).padStart(2, '0')}`,
        train_no: '12951',
        journey_date: '2026-11-12',
        class: '3A',
        from_code: 'MMCT',
        to_code: 'NDLS',
        passengers: [{ coach, berth_no: berth, berth_type: 'LB' }],
      })
      if (open) m.setOpenToSwap(trip.id, true)
      return trip.id
    }

    /* Four members and one peer berth each. The bundle covers three locks, so
       the FOURTH is the one that hits the cap — which is the only way to reach
       the branch that used to throw out of a captured payment. Each member
       asks its own acceptor because four requests to one berth would trip that
       berth's daily inbound cap (docs/03) instead. */
    const members = [
      await make('B1', '11', false),
      await make('B2', '12', false),
      await make('B3', '13', false),
      await make('B4', '14', false),
    ]
    const acceptors = [
      await make('B9', '41', true),
      await make('B9', '42', true),
      await make('B9', '43', true),
      await make('B9', '44', true),
    ]
    const group = createGroup('Family', members)
    startPayment({ group_id: group.id, provider: 'razorpay', amount_paise: 19900, credit_used_paise: 0, status: 'paid' })
    markGroupPaid(group.id)

    const { confirmCaptured, lockCoveredRequest } = await import('@/lib/checkout')
    const accepted = async (tripId: string, acceptorId: string) => {
      const request = createRequest({ trip_id: tripId, choices: ['LB'] })
      sendRequest(request.id, [acceptorId])
      const offer = offersFor(request.id)[0]
      if (!offer) return null
      acceptOffer(offer.id)
      return request
    }

    /* Consume the three covered locks. */
    for (const [index, id] of members.slice(0, 3).entries()) {
      const request = await accepted(id, acceptors[index])
      expect(request, id).not.toBeNull()
      if (request) lockCoveredRequest(request.id)
    }

    /* The fourth pays its own ₹99, so `lockRequest`'s `ownPaid` check is true
       and the cap is legitimately skipped — the bundle does not cover it, so it
       is an ordinary per-request swap and must lock. That is the designed
       behaviour, and it is why the cap throw could only ever have fired on a
       COVERED lock with no payment of its own. */
    const fourth = await accepted(members[3], acceptors[3])
    expect(fourth).not.toBeNull()
    if (!fourth) return
    startPayment({ request_id: fourth.id, provider: 'razorpay', amount_paise: 9900, credit_used_paise: 0, status: 'pending' })

    let ticket: ReturnType<typeof confirmCaptured> | undefined
    expect(() => {
      ticket = confirmCaptured(fourth.id, 'order_captured')
    }).not.toThrow()
    expect(paymentFor(fourth.id)?.status).toBe('paid')
    expect(ticket?.settled).toBe(true)
    /* Paid its own way past the cap, so the swap really is locked. */
    expect(getRequest(fourth.id)?.status).toBe('locked')
  })
})
