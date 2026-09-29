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
    startPayment({ request_id: group.id, provider: 'razorpay', amount_paise: 19900, credit_used_paise: 0, status: 'paid' })
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
