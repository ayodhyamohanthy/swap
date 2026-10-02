/* Design 17's Swap detail panel: the history of one swap.
 *
 * The panel was left unbuilt for a while because its Requester/Acceptor columns
 * want names the model does not carry (the missing-peer-rows blocker, filed on
 * the lane board). The timeline is the half that needs no names at all — it is
 * the `activity_log` rows this console already reads — so it is the half that
 * can be built and tested today.
 *
 * What is worth pinning, and why:
 *
 * 1. A swap's lifecycle and its money are logged as two different entities
 *    (`swap_request` vs `payment`), and the payment's row names its request
 *    only through `PaymentRow.request_id`. A join on the request id alone
 *    quietly drops the payment step — the step an operator is asked about most.
 * 2. The log is stored newest-first; a timeline read in that order answers the
 *    wrong question. Direction is asserted against an explicitly unsorted input
 *    rather than against whatever the fixture happens to be in.
 * 3. Rule 13. The history is a second, denser way to read the same rows, so the
 *    mask that protects the Details column has to hold here too.
 */

import { describe, expect, it } from 'vitest'

import { paymentIdsFor, swapTimeline } from '@/lib/admin'
import { SHIPPED_LANGS, translate } from '@/lib/i18n'
import type { ActivityRow, PaymentRow } from '@/lib/store'

const SCREEN = (process.getBuiltinModule('node:fs') as typeof import('node:fs')).readFileSync(
  (process.getBuiltinModule('node:path') as typeof import('node:path')).join(
    import.meta.dirname,
    '..',
    'src',
    'routes',
    'admin.swaps.tsx',
  ),
  'utf8',
)

const REQUEST = 'req_a1b2c3d4'

function row(partial: Partial<ActivityRow> & Pick<ActivityRow, 'id' | 'action'>): ActivityRow {
  return {
    actor_id: null,
    actor_role: 'user',
    entity: null,
    entity_id: null,
    meta: {},
    created_at: '2026-09-29T10:00:00.000Z',
    ...partial,
  }
}

/** A row as `lib/requests.ts` writes it: the request entity carries the id. */
function swapStep(
  id: string,
  action: string,
  at: string,
  meta: Record<string, unknown> = {},
): ActivityRow {
  return {
    ...row({ id, action, entity: 'swap_request', entity_id: REQUEST, meta }),
    created_at: at,
  }
}

/** A row as `lib/store.ts` writes it: the payment entity carries the payment id. */
function paymentStep(id: string, action: string, paymentId: string, at: string) {
  return row({ id, action, created_at: at, entity: 'payment', entity_id: paymentId })
}

const PAYMENT: PaymentRow = {
  id: 'pay_1111',
  request_id: REQUEST,
  group_id: null,
  payer_id: 'user_1',
  provider: 'razorpay',
  provider_ref: null,
  amount_paise: 9900,
  credit_used_paise: 0,
  currency: 'INR',
  status: 'paid',
  receipt_number: 'SS-10482',
  created_at: '2026-09-29T10:00:00.000Z',
  updated_at: '2026-09-29T10:00:00.000Z',
}

describe('swapTimeline (design 17, Swap detail)', () => {
  it('keeps one swap out of another swap\u2019s history', () => {
    const rows = [
      swapStep('a1', 'request_sent', '2026-09-29T10:00:00.000Z'),
      row({
        id: 'b1',
        action: 'request_sent',
        entity: 'swap_request',
        entity_id: 'req_9999',
        created_at: '2026-09-29T10:01:00.000Z',
      }),
      /* Same request id, different entity — a trip or group row must not become
         a swap step just because something shares an id. */
      row({
        id: 'c1',
        action: 'trip_added',
        entity: 'booking',
        entity_id: REQUEST,
        created_at: '2026-09-29T10:02:00.000Z',
      }),
    ]

    expect(swapTimeline(rows, REQUEST).map((step) => step.id)).toEqual(['a1'])
  })

  it('reads forwards, whatever order the log is in', () => {
    /* The log stores newest-first (`store.ts` unshifts), so the input is built
       that way and the assertion would fail on a passthrough. */
    const rows = [
      swapStep('4', 'swap_confirmed', '2026-09-29T10:40:00.000Z'),
      swapStep('3', 'swap_locked', '2026-09-29T10:30:00.000Z'),
      swapStep('2', 'offer_accepted', '2026-09-29T10:20:00.000Z'),
      swapStep('1', 'request_sent', '2026-09-29T10:10:00.000Z'),
    ]

    expect(swapTimeline(rows, REQUEST).map((step) => step.id)).toEqual(['1', '2', '3', '4'])
  })

  it('orders steps written in the same second deterministically', () => {
    const at = '2026-09-29T10:00:00.000Z'
    const rows = [
      swapStep('zz', 'swap_locked', at),
      swapStep('aa', 'offer_accepted', at),
      swapStep('mm', 'payment_paid', at),
    ]

    expect(swapTimeline(rows, REQUEST).map((step) => step.id)).toEqual(['aa', 'mm', 'zz'])
  })

  it('carries the payment step, joined through the request\u2019s own payment ids', () => {
    const rows = [
      swapStep('1', 'offer_accepted', '2026-09-29T10:20:00.000Z'),
      paymentStep('2', 'payment_paid', 'pay_1111', '2026-09-29T10:30:00.000Z'),
      /* Someone else's payment: the id is a payment id, but not this swap's. */
      paymentStep('3', 'payment_paid', 'pay_2222', '2026-09-29T10:31:00.000Z'),
    ]

    const timeline = swapTimeline(rows, REQUEST, paymentIdsFor([PAYMENT], REQUEST))
    expect(timeline.map((step) => step.action)).toEqual(['offer_accepted', 'payment_paid'])
  })

  it('drops the payment step when the join key is missing, rather than guessing', () => {
    /* The failure mode this pins: matching `payment` rows by request id, which
       never matches, so the money silently disappears from the history. */
    const rows = [paymentStep('2', 'payment_paid', 'pay_1111', '2026-09-29T10:30:00.000Z')]
    expect(swapTimeline(rows, REQUEST)).toHaveLength(0)
    expect(swapTimeline(rows, 'pay_1111')).toHaveLength(0)
  })

  it('takes only the payments that name this request', () => {
    const other: PaymentRow = { ...PAYMENT, id: 'pay_2222', request_id: 'req_9999' }
    expect(paymentIdsFor([PAYMENT, other], REQUEST)).toEqual(['pay_1111'])
    expect(paymentIdsFor([other], REQUEST)).toEqual([])
  })

  it('is an empty history, never a crash, for a swap with no log rows', () => {
    expect(swapTimeline([], REQUEST)).toEqual([])
    expect(swapTimeline([], REQUEST, [])).toEqual([])
  })

  it('labels every step through the activity vocabulary, in both languages', () => {
    const rows = [
      swapStep('1', 'request_sent', '2026-09-29T10:10:00.000Z', { matches: 3 }),
      swapStep('2', 'offer_accepted', '2026-09-29T10:20:00.000Z'),
      swapStep('3', 'swap_locked', '2026-09-29T10:30:00.000Z'),
      paymentStep('4', 'payment_paid', 'pay_1111', '2026-09-29T10:31:00.000Z'),
      swapStep('5', 'confirmation', '2026-09-29T10:40:00.000Z', { side: 'acceptor' }),
      swapStep('6', 'swap_confirmed', '2026-09-29T10:41:00.000Z'),
    ]
    const timeline = swapTimeline(rows, REQUEST, [PAYMENT.id])

    /* One step per logged event: a timeline that swallowed a duplicate would be
       a history with a hole in it. */
    expect(timeline).toHaveLength(rows.length)

    for (const step of timeline) {
      for (const lang of SHIPPED_LANGS) {
        const label = translate(lang, step.label)
        expect(label.trim(), `${lang} has no label for ${step.action}`).not.toBe('')
        /* `translate` falls back to the key itself, so an action with no label
           renders `admin.act.some_new_thing` — loud, but only if it is caught. */
        expect(label, `${lang} is missing ${step.label}`).not.toContain('admin.act.')
      }
    }
  })

  it('keeps a full PNR out of the timeline (rule 13)', () => {
    /* `pnr_added` logs four characters under `last4`, and a full PNR is never
       stored at all. The mask is nevertheless a property of `activityDetails`,
       not of the value it is handed — so it is pinned on a *full* PNR logged
       under that key, which is the case the guard exists for. The timeline must
       inherit it rather than rendering `meta` on its own. */
    const logged = '1234567890'
    const [step] = swapTimeline(
      [swapStep('1', 'request_sent', '2026-09-29T10:00:00.000Z', { last4: logged })],
      REQUEST,
    )

    expect(step.details).not.toContain(logged)
    /* Still useful: the tail is shown. A mask that hid the value entirely would
       be a different bug than the one this guards against. */
    expect(step.details).toBe('····7890')
  })
})

describe('design 17 swap history (screen wiring)', () => {
  it('renders the history the helper returns', () => {
    expect(SCREEN).toContain('swapTimeline(activity, row.id, paymentIdsFor(payments, row.id))')
  })

  it('computes a row\u2019s history only while its disclosure is open', () => {
    /* Walking the whole log once per rendered row is the one way this panel
       could get slow, so the gate is pinned, not just the call. */
    const line = SCREEN.split('\n').find((l) => l.trimStart().startsWith('const timeline ='))
    expect(line, 'the screen no longer derives a history').toBeDefined()
    expect(line, 'the history is computed for every row again').toContain('open')
  })

  it('renders the label from the catalogue rather than the raw action', () => {
    expect(SCREEN).toContain('{t(step.label)}')
    /* The raw action appears exactly once, and only as the tooltip that keeps a
       row greppable against the code — a second use is the raw enum on screen,
       which is the defect `activityLabelKey` exists to prevent. */
    expect(SCREEN).toContain('title={step.action}')
    expect(SCREEN.match(/step\.action/g) ?? []).toHaveLength(1)
  })

  it('is a keyboard-reachable disclosure, not a mouse-only affordance', () => {
    expect(SCREEN).toContain('aria-expanded={open}')
    expect(SCREEN).toContain('aria-controls=')
    expect(SCREEN).toContain('swap-history-')
  })
})
