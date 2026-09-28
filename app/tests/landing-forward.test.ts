/* The bare `/swaps/$id` landing is the forwarder docs/05 assigns screens
   29/47/48/49 to — shared links and notifications land here, so what it
   chooses IS what a traveller sees after their money moved.

   Why a unit test on the table rather than a render test: the two decisions
   that can lie about money are invisible to every other suite. `voided` only
   ever gets written by a resolution that also credited the ₹99, but nothing
   stopped the acceptor — who never paid (rule 3) — from being shown
   "Added to your credit" (rule 6). And a dispute has to reach screen 49's
   held-money copy (rule 7) instead of quietly sitting on the offline ticket.
   Both are pure `status × side` decisions, so the table is exported and
   pinned here; the source check at the end keeps the component using it. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import { landingForward } from '@/routes/swaps.$id.index'
import type { RequestStatus } from '@/lib/requests'

describe('landing forwarder (docs/05 screens 47/48/49)', () => {
  it('sends both sides of a dispute to the held-money screen', () => {
    expect(landingForward('disputed', true)).toEqual({ kind: 'review' })
    expect(landingForward('disputed', false)).toEqual({ kind: 'review' })
  })

  it('shows the credit screen to the side that paid, and only that side', () => {
    expect(landingForward('voided', true)).toEqual({ kind: 'credit' })
    /* The acceptor never pays ₹99; "Added to your credit" would invent it. */
    expect(landingForward('voided', false)).toEqual({ kind: 'status' })
  })

  it('keeps the live statuses on the screens they already had', () => {
    expect(landingForward('locked', true)).toEqual({ kind: 'summary' })
    expect(landingForward('confirmed', false)).toEqual({ kind: 'summary' })
    expect(landingForward('accepted_awaiting_payment', true)).toEqual({ kind: 'pay' })
  })

  it('invents no screen for anything pre-payment', () => {
    const prePayment: RequestStatus[] = ['draft', 'searching', 'withdrawn', 'expired']
    for (const status of prePayment) {
      for (const requesterSide of [true, false]) {
        expect(landingForward(status, requesterSide), status).toEqual({ kind: 'status' })
      }
    }
  })

  it('is the table the route actually uses', () => {
    const src = readFileSync(
      join(import.meta.dirname, '..', 'src', 'routes', 'swaps.$id.index.tsx'),
      'utf8',
    )
    expect(src).toContain('landingForward(request.status, requesterSide)')
  })

  it('gates the cancel screen’s credit claim behind a settled void', () => {
    /* Cancel used to navigate straight to "Added to your credit" for whoever
       pressed it — including the acceptor, and including swaps whose void
       could not settle at all. The claim must sit behind both gates. */
    const src = readFileSync(
      join(import.meta.dirname, '..', 'src', 'routes', 'swaps.$id.cancel.tsx'),
      'utf8',
    )
    const gate = src.indexOf('settled && requesterSide')
    const claim = src.indexOf("search: { state: 'credit' }")
    expect(gate, 'cancel must gate on a settled void + the paying side').toBeGreaterThan(-1)
    expect(claim, 'the credit screen must sit behind the gate').toBeGreaterThan(gate)
  })
})
