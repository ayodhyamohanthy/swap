/* `lib/settle` is the ONLY place that writes credit (rules 3, 6). `outcomes`
   tests the pure resolution table; this file pins the stateful half — that the
   right amount reaches the right person exactly once, that nothing is minted
   for a swap that never happened, and that there is no path back to a bank. */
import { beforeEach, describe, expect, it } from 'vitest'

import { beginCheckout, confirmCaptured } from '@/lib/checkout'
import { cancelAfterPay } from '@/lib/outcomes'
import {
  acceptOffer,
  createRequest,
  getRequest,
  offersFor,
  resetRequests,
  sendRequest,
  type SwapRequest,
} from '@/lib/requests'
import { answerSwap, applyResolution, missingAnswers, voidSwap } from '@/lib/settle'
import {
  activityLog,
  addTrip,
  confirmationsFor,
  creditPaise,
  getSnapshot,
  resetStore,
  setOpenToSwap,
} from '@/lib/store'

/** A request that reached `locked`: accepted, paid and captured. */
async function lockedJourney(): Promise<SwapRequest> {
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
  beginCheckout(request.id, 'razorpay')
  confirmCaptured(request.id, 'pay_1')
  return request
}

const wallet = () => getSnapshot().wallet
const earned = () => wallet().filter((tx) => tx.kind !== 'used')

describe('answerSwap', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('settles nothing while the other side has not answered', async () => {
    const request = await lockedJourney()
    const first = answerSwap(request.id, 'requester', 'swapped')
    expect(first.resolution).toBeNull()
    expect(getRequest(request.id)?.status).toBe('locked')
    expect(creditPaise()).toBe(0)
    expect(missingAnswers(request.id)).toEqual(['acceptor'])
  })

  it('both swapped pays the acceptor ₹50 and nobody else (rule 3)', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'swapped')
    const result = answerSwap(request.id, 'acceptor', 'swapped')
    expect(result.resolution).toMatchObject({ status: 'confirmed', resultKey: 'swapped' })
    expect(getRequest(request.id)?.status).toBe('confirmed')
    expect(creditPaise()).toBe(5000)
    /* The acceptor helped, so the ₹50 is theirs — the requester paid ₹99 for a
       swap that worked and must come out with nothing. */
    expect(earned()).toMatchObject([{ kind: 'acceptor_credit', amount_paise: 5000 }])
    expect(missingAnswers(request.id)).toEqual([])
  })

  it('an agreed miss moves the ₹99 to credit, never to a bank (rule 6)', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'no_show')
    const result = answerSwap(request.id, 'acceptor', 'no_show')
    expect(result.resolution).toMatchObject({ status: 'voided', resultKey: 'credit_added' })
    expect(getRequest(request.id)?.status).toBe('voided')
    expect(creditPaise()).toBe(9900)
    expect(earned()).toMatchObject([{ kind: 'swap_to_credit', amount_paise: 9900 }])
    /* Rule 4: the only thing an outcome can produce here is a wallet row — this
       module has no refund/withdrawal entry point to assert on. */
    expect(wallet().every((tx) => tx.kind === 'swap_to_credit')).toBe(true)
  })

  it('differing answers dispute and move no money (rule 7)', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'swapped')
    const result = answerSwap(request.id, 'acceptor', 'no_show')
    expect(result.resolution).toMatchObject({ status: 'disputed', resultKey: 'disputed' })
    expect(result.resolution?.credits).toEqual([])
    expect(getRequest(request.id)?.status).toBe('disputed')
    expect(wallet()).toEqual([])
    expect(creditPaise()).toBe(0)
  })

  it('re-answering after settlement cannot mint credit twice', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'swapped')
    answerSwap(request.id, 'acceptor', 'swapped')
    expect(creditPaise()).toBe(5000)
    /* Both sides re-answering must not re-run settlement: a second ₹50 here
       would be free money the acceptor never earned. */
    const again = answerSwap(request.id, 'requester', 'swapped')
    const again2 = answerSwap(request.id, 'acceptor', 'swapped')
    expect(again.resolution).toBeNull()
    expect(again2.resolution).toBeNull()
    expect(creditPaise()).toBe(5000)
    expect(earned()).toHaveLength(1)
    expect(getRequest(request.id)?.status).toBe('confirmed')
  })

  it('changing an answer before the other replies is still one answer each', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'no_show')
    answerSwap(request.id, 'requester', 'swapped')
    expect(confirmationsFor(request.id)).toHaveLength(1)
    const result = answerSwap(request.id, 'acceptor', 'swapped')
    expect(result.resolution?.status).toBe('confirmed')
    expect(creditPaise()).toBe(5000)
  })

  it('never pays out for a swap that was never paid for', async () => {
    const mine = await addTrip({
      pnr: '4512789630',
      train_no: '12951',
      journey_date: '2026-11-12',
      class: '3A',
      passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
    })
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    answerSwap(request.id, 'requester', 'swapped')
    const result = answerSwap(request.id, 'acceptor', 'swapped')
    expect(result.resolution).toBeNull()
    expect(wallet()).toEqual([])
  })

  it('writes an activity_log row for each answer and for the settlement', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'swapped')
    answerSwap(request.id, 'acceptor', 'swapped')
    const actions = activityLog().map((row) => row.action)
    expect(actions.filter((a) => a === 'confirmation')).toHaveLength(2)
    expect(actions).toContain('swap_confirmed')
    expect(actions).toContain('credit_added')
  })

  it('credit written here expires 12 months out and is never cash (rule 4)', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'no_show')
    answerSwap(request.id, 'acceptor', 'no_show')
    const [tx] = earned()
    const expiry = new Date(tx.expires_at ?? 0)
    const now = new Date()
    expect(expiry.getUTCFullYear()).toBe(now.getUTCFullYear() + 1)
    expect(expiry.getUTCMonth()).toBe(now.getUTCMonth())
    expect(tx.ref_request_id).toBe(request.id)
  })
})

describe('voidSwap (cancel after payment)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('sends the ₹99 to requester credit', async () => {
    const request = await lockedJourney()
    const result = voidSwap(request.id)
    expect(result.resolution).toMatchObject({ status: 'voided' })
    expect(getRequest(request.id)?.status).toBe('voided')
    expect(earned()).toMatchObject([{ kind: 'swap_to_credit', amount_paise: 9900 }])
  })

  it('does not pay a second time on an already-voided swap', async () => {
    const request = await lockedJourney()
    voidSwap(request.id)
    const again = voidSwap(request.id)
    expect(again.resolution).toBeNull()
    expect(earned()).toHaveLength(1)
    expect(creditPaise()).toBe(9900)
  })

  it('does not claw back the acceptor ₹50 from a confirmed swap', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'swapped')
    answerSwap(request.id, 'acceptor', 'swapped')
    const result = voidSwap(request.id)
    expect(result.resolution).toBeNull()
    expect(getRequest(request.id)?.status).toBe('confirmed')
    expect(creditPaise()).toBe(5000)
  })
})

describe('applyResolution (admin resolving a dispute)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('moves a disputed swap to credit exactly once', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'swapped')
    answerSwap(request.id, 'acceptor', 'no_show')
    expect(getRequest(request.id)?.status).toBe('disputed')
    expect(creditPaise()).toBe(0)

    const resolved = applyResolution(request.id, cancelAfterPay())
    expect(resolved.resolution?.status).toBe('voided')
    expect(creditPaise()).toBe(9900)

    /* Re-applying the admin's decision, or a cancel arriving afterwards, must
       not top the requester up to ₹198. */
    expect(applyResolution(request.id, cancelAfterPay()).resolution).toBeNull()
    expect(voidSwap(request.id).resolution).toBeNull()
    expect(creditPaise()).toBe(9900)
    expect(earned()).toHaveLength(1)
  })

  it('re-resolving a dispute back into a dispute moves no money', async () => {
    const request = await lockedJourney()
    answerSwap(request.id, 'requester', 'swapped')
    answerSwap(request.id, 'acceptor', 'no_show')
    const before = activityLog().length
    const result = applyResolution(request.id, {
      status: 'disputed', credits: [], resultKey: 'disputed',
    })
    /* A dispute is not a transition out of itself: nothing is written, no
       activity row is added, and the swap stays open for an admin decision. */
    expect(result.request).toBeUndefined()
    expect(getRequest(request.id)?.status).toBe('disputed')
    expect(creditPaise()).toBe(0)
    expect(activityLog()).toHaveLength(before)
  })
})
