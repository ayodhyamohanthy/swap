/* Rule 2 on the PAY ROUTE, not just in the lib (docs/04 A9-A11, AGENTS rule 2).
   `lib/checkout` already refuses to charge a settled swap twice, but refusing
   on tap is not the same as not offering: the child screens under the
   `/pay/$requestId` layout render through the parent's `<Outlet/>`, so the
   guard that lived inside `PayScreen` never ran for `/method`, `/paypal`,
   `/upi` or `/status`. A confirmed swap still drew a working "Pay ₹99". */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { beforeEach, describe, expect, it } from 'vitest'

import { beginCheckout, confirmCaptured, payGateFor } from '@/lib/checkout'
import { createGroup, markGroupPaid, resetGroups } from '@/lib/groups'
import {
  acceptOffer,
  createRequest,
  offersFor,
  resetRequests,
  sendRequest,
} from '@/lib/requests'
import { addTrip, resetStore, setOpenToSwap } from '@/lib/store'

const ROUTES = join(import.meta.dirname, '..', 'src', 'routes')

async function acceptedRequest() {
  const mine = await addTrip({
    pnr: '4512789630',
    train_no: '12951',
    journey_date: '2026-11-12',
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
  const theirs = await addTrip({
    pnr: '4512789648',
    train_no: '12951',
    journey_date: '2026-11-12',
    class: '3A',
    from_code: 'MMCT',
    to_code: 'NDLS',
    passengers: [{ coach: 'B4', berth_no: '41', berth_type: 'UB' }],
  })
  setOpenToSwap(theirs.id, true)
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  acceptOffer(offersFor(request.id)[0].id)
  return request
}

describe('payGateFor reads a pay URL, not just a request status', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
    resetGroups()
  })

  it('is payable once someone has accepted, and paid once money lands', async () => {
    const request = await acceptedRequest()
    expect(payGateFor(request.id)).toBe('payable')
    beginCheckout(request.id, 'razorpay')
    /* Still payable while the gateway has not captured: rule 2 locks on paid. */
    expect(payGateFor(request.id)).toBe('payable')
    confirmCaptured(request.id, 'test_ref')
    expect(payGateFor(request.id)).toBe('paid')
  })

  it('refuses before an acceptance and for an id with no request at all', async () => {
    const mine = await addTrip({
      pnr: '4512789630',
      train_no: '12951',
      journey_date: '2026-11-12',
      class: '3A',
      passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
    })
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(payGateFor(request.id)).toBe('not-yet')
    expect(payGateFor('req_nope')).toBe('missing')
  })

  it('reads a group trip by group.paid, which a request status cannot express', () => {
    const group = createGroup('Family trip', [])
    expect(payGateFor(group.id)).toBe('payable')
    markGroupPaid(group.id)
    expect(payGateFor(group.id)).toBe('paid')
  })

  it('never offers to charge for a group id that does not exist', () => {
    /* `grp_…` parses as a group id but there is no trip behind it. Falling
       through to `payable` here would draw a ₹199 screen for nothing. */
    expect(payGateFor('grp_zzzz_nope')).toBe('missing')
  })
})

describe('every screen under the pay layout applies the gate', () => {
  /* The parent route is a bare `<Outlet/>`, so a guard in one screen protects
     exactly that screen. This walks the files rather than the router: it fails
     the moment a new pay screen is added without the gate, which is how the
     hole appeared in the first place. */
  const CHILDREN = [
    'pay.$requestId.index.tsx',
    'pay.$requestId.method.tsx',
    'pay.$requestId.paypal.tsx',
    'pay.$requestId.upi.tsx',
    'pay.$requestId.status.tsx',
    'pay.$requestId.done.tsx',
  ]

  it.each(CHILDREN)('%s gates on rule 2 before rendering a payment UI', (file) => {
    const src = readFileSync(join(ROUTES, file), 'utf8')
    /* index renders PayScreen from the parent file, which holds the gate;
       done has its own stricter one (a paid payment row, not just a status). */
    if (file.endsWith('index.tsx')) {
      expect(src).toMatch(/PayScreen/)
      return
    }
    if (file.endsWith('done.tsx')) {
      expect(src).toMatch(/payment\.status !== 'paid'/)
      return
    }
    expect(src, `${file} must read payGateFor`).toMatch(/payGateFor\(requestId\)/)
    expect(src, `${file} must render PayBlocked when not payable`).toMatch(
      /gate !== 'payable'\)\s*return <PayBlocked/,
    )
  })

  it('keeps one definition of the gate — no screen re-derives rule 2', () => {
    for (const file of CHILDREN) {
      const src = readFileSync(join(ROUTES, file), 'utf8')
      expect(src, `${file} should not read request.status directly`).not.toMatch(
        /status === 'locked'|status === 'confirmed'/,
      )
    }
  })
})
