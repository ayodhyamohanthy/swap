/* Appreciation (owner rulings 2026-10-21): a cash thank-you from the
   requester AFTER a confirmed swap; the helper receives 100% of it as credit,
   never cash; no split, no refunds, one per swap. Presets ₹50/₹100/₹200.

   These tests pin the money invariants:
   presets only, credit never pays for a tip, capture-before-credit, and the
   idempotency that keeps a double webhook from minting credit twice. */
import { beforeEach, describe, expect, it } from 'vitest'

import { beginCheckout, confirmCaptured } from '@/lib/checkout'
import { TIP_PRESETS_PAISE } from '@/lib/money'
import {
  acceptOffer,
  createRequest,
  getRequest,
  offersFor,
  resetRequests,
  sendRequest,
  type SwapRequest,
} from '@/lib/requests'
import { answerSwap } from '@/lib/settle'
import {
  addTrip,
  credit,
  creditPaise,
  getSnapshot,
  listPayments,
  resetStore,
  setOpenToSwap,
  setPaymentStatus,
} from '@/lib/store'
import {
  beginTip,
  settleTip,
  tipGateFor,
  tipPaymentFor,
  TipError,
} from '@/lib/tips'

/** A swap that is confirmed done — the only state a tip may ever attach to. */
async function confirmedJourney(): Promise<SwapRequest> {
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
  answerSwap(request.id, 'requester', 'swapped')
  answerSwap(request.id, 'acceptor', 'swapped')
  return request
}

const tipCredits = () => getSnapshot().wallet.filter((tx) => tx.kind === 'tip_credit')

describe('tips', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
  })

  it('gates: a missing or unconfirmed swap can never be tipped', async () => {
    expect(tipGateFor('req_nope')).toBe('missing')
    expect(() => beginTip('req_nope', 10000, 'razorpay')).toThrow('missing')
    const request = await confirmedJourney()
    expect(getRequest(request.id)?.status).toBe('confirmed')
    expect(tipGateFor(request.id)).toBe('tippable')
  })

  it('gates: a swap that is not confirmed done refuses the tip', async () => {
    const mine = await addTrip({
      pnr: '4512789630',
      train_no: '12951',
      journey_date: '2026-11-12',
      class: '3A',
      passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
    })
    const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
    sendRequest(request.id)
    expect(tipGateFor(request.id)).toBe('not_confirmed')
    expect(() => beginTip(request.id, 10000, 'razorpay')).toThrow('not_confirmed')
  })

  it('only ever charges a preset amount', async () => {
    const request = await confirmedJourney()
    for (const bad of [0, 4999, 5001, 9999, 20001, -2000]) {
      expect(() => beginTip(request.id, bad, 'razorpay')).toThrow('bad_tip_amount')
    }
    expect(listPayments().filter((p) => p.request_id.startsWith('tip:'))).toHaveLength(0)
  })

  it('opens the payment before the gateway, with credit hard-pinned to zero', async () => {
    const request = await confirmedJourney()
    credit({ to: 'requester', amountPaise: 10000, kind: 'swap_to_credit' })
    const payment = beginTip(request.id, 10000, 'razorpay')
    expect(payment.request_id).toBe(`tip:${request.id}`)
    expect(payment.amount_paise).toBe(10000)
    expect(payment.credit_used_paise).toBe(0)
    /* A tip must never read as the swap's own ₹100 payment. */
    expect(tipPaymentFor(request.id)?.id).toBe(payment.id)
  })

  it('one tip per swap — a live payment blocks a second charge', async () => {
    const request = await confirmedJourney()
    beginTip(request.id, 5000, 'razorpay')
    expect(tipGateFor(request.id)).toBe('already_tipped')
    expect(() => beginTip(request.id, 5000, 'razorpay')).toThrow('already_tipped')
  })

  it('a failed tip may be retried; only the retry can charge', async () => {
    const request = await confirmedJourney()
    const payment = beginTip(request.id, 5000, 'razorpay')
    setPaymentStatus(payment.id, 'failed')
    expect(tipGateFor(request.id)).toBe('tippable')
    const retry = beginTip(request.id, 5000, 'razorpay')
    expect(retry.id).not.toBe(payment.id)
    expect(tipGateFor(request.id)).toBe('already_tipped')
  })

  it('no capture, no credit: pending and failed tips mint nothing', async () => {
    const request = await confirmedJourney()
    const before = creditPaise()
    const payment = beginTip(request.id, 20000, 'razorpay')
    expect(settleTip(payment.id)).toBeUndefined()
    setPaymentStatus(payment.id, 'pending')
    expect(settleTip(payment.id)).toBeUndefined()
    setPaymentStatus(payment.id, 'failed')
    expect(settleTip(payment.id)).toBeUndefined()
    expect(creditPaise()).toBe(before)
    expect(tipCredits()).toHaveLength(0)
  })

  it('a captured tip lands 100% as credit for the helper, 12-month life', async () => {
    const request = await confirmedJourney()
    const before = creditPaise()
    const payment = beginTip(request.id, 20000, 'razorpay')
    setPaymentStatus(payment.id, 'paid')
    const tx = settleTip(payment.id)
    expect(tx).toMatchObject({ amount_paise: 20000, kind: 'tip_credit', ref_request_id: payment.id })
    expect(creditPaise()).toBe(before + 20000)
    /* Roughly 12 months out, never null (rule 4). */
    const lifeMs = Date.parse(tx!.expires_at!) - Date.parse(tx!.created_at)
    expect(lifeMs).toBeGreaterThan(360 * 86_400_000)
  })

  it('a double capture can never mint the credit twice', async () => {
    const request = await confirmedJourney()
    const payment = beginTip(request.id, 10000, 'razorpay')
    setPaymentStatus(payment.id, 'paid')
    const first = settleTip(payment.id)
    const second = settleTip(payment.id)
    expect(second?.id).toBe(first?.id)
    expect(tipCredits()).toHaveLength(1)
  })

  it('never settles credit off a non-tip payment', async () => {
    const request = await confirmedJourney()
    const swapPayment = listPayments().find((p) => p.request_id === request.id)
    expect(swapPayment?.status).toBe('paid')
    const before = tipCredits().length
    expect(settleTip(swapPayment!.id)).toBeUndefined()
    expect(tipCredits()).toHaveLength(before)
  })

  it('the ledger refuses a tip amount the payer was never charged', () => {
    expect(() => credit({ to: 'acceptor', amountPaise: 750, kind: 'tip_credit' })).toThrow(
      'credit_amount_must_match_kind',
    )
    for (const preset of TIP_PRESETS_PAISE) {
      expect(credit({ to: 'acceptor', amountPaise: preset, kind: 'tip_credit' }).amount_paise).toBe(preset)
    }
  })

  it('a tip is exactly one preset per swap, end to end', async () => {
    const request = await confirmedJourney()
    const payment = beginTip(request.id, 5000, 'razorpay')
    setPaymentStatus(payment.id, 'paid')
    settleTip(payment.id)
    expect(tipGateFor(request.id)).toBe('already_tipped')
    expect(() => beginTip(request.id, 20000, 'razorpay')).toThrow(TipError)
    expect(tipCredits()).toHaveLength(1)
  })
})

describe('the tip card on the done screen (source guard)', () => {
  /* The card may render only behind the gate — an ungated card would offer a
     tip for a swap that never confirmed, or a second tip for one already
     tipped. Read the source so a future edit that drops the gate fails here. */
  const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
  const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')

  it('renders only when tipGateFor says tippable, and names credit, not cash', () => {
    const source = readFileSync(join(__dirname, '../src/routes/swaps.$id.done.tsx'), 'utf8')
    expect(source).toContain("tipGateFor(id) === 'tippable'")
    expect(source).toContain('tip.cardTitle')
    const locales = JSON.parse(readFileSync(join(__dirname, '../locales/en.json'), 'utf8'))
    expect(locales.tip.cardNote).toContain('credit')
    expect(locales.tip.note).toContain('never cash')
    /* No copy may promise the helper cash. */
    for (const value of Object.values(locales.tip) as string[]) {
      expect(value).not.toMatch(/cash back|paid out|in cash to/i)
    }
  })
})
