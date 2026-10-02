import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import {
  StoreError,
  credit,
  isGroupPayment,
  paymentFor,
  pickPaymentFor,
  paymentTargetId,
  paymentTargets,
  resetStore,
  startPayment,
  useCredit,
  type PaymentRow,
  type WalletTx,
} from '@/lib/store'
import { usePaymentFor } from '@/lib/use-store'
import { createGroup, markGroupPaid, resetGroups, getGroup } from '@/lib/groups'
import { beginGroupCheckout } from '@/lib/checkout'
import { paymentIdsFor, paymentOutcome, paymentRows } from '@/lib/admin'
import { stripSqlComments } from '../scripts/staging-lib.mjs'

/* `payments` has two target columns and the schema admits exactly one of them:
     payments_target CHECK ((request_id IS NULL) != (group_id IS NULL)).
   The local mirror used to have only `request_id`, and the ₹199 family plan was
   written into it with the group id — a value that is neither a uuid nor a row in
   `swap_requests`. It worked on-device and was unsyncable, and the lookup that
   decides "you have already paid" read one column only, so the idempotency that
   stops a second ₹199 charge was quietly reading the wrong thing. These pin the
   split from both sides. */

const GROUP_PRICE = 19900
const SWAP_PRICE = 9900

function row(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay_1',
    request_id: 'req_a',
    group_id: null,
    payer_id: 'user_1',
    provider: 'razorpay',
    provider_ref: null,
    amount_paise: SWAP_PRICE,
    credit_used_paise: 0,
    currency: 'INR',
    status: 'paid',
    receipt_number: null,
    created_at: '2026-11-12T10:00:00.000Z',
    updated_at: '2026-11-12T10:00:00.000Z',
    ...over,
  }
}

/** What `store.ts` persists under `KEYS.payments`, read back off disk. */
const PAYMENTS_KEY = 'seatswap.payments.v1'
const WALLET_KEY = 'seatswap.wallet.v1'

function stored<T>(key: string): T[] {
  return JSON.parse(window.localStorage.getItem(key) ?? '[]') as T[]
}

function storeRaw(rows: unknown[]): void {
  window.localStorage.setItem(PAYMENTS_KEY, JSON.stringify(rows))
  /* resetStore() writes the empty state over storage, so the seed goes in after
     it. This is then the cross-tab path a second window would really take:
     write under the key, and the store reloads itself from disk. */
  window.dispatchEvent(new StorageEvent('storage', { key: PAYMENTS_KEY }))
}

/** Credit in legal ₹99 chunks (rule 1: the only amount `credit` accepts), up to
    at least `paise`, so a ₹199 group payment can be covered without a gateway. */
function fundWallet(paise: number): void {
  for (let left = paise; left > 0; left -= 9900) {
    credit({ to: 'requester', amountPaise: 9900, kind: 'swap_to_credit', ref_request_id: null })
  }
}

beforeEach(() => {
  window.localStorage.clear()
  resetStore()
  resetGroups()
})

describe('a group payment is found by the id it targets', () => {
  it('matches a payment whose group_id is the target', () => {
    const group = row({ id: 'pay_g', request_id: null, group_id: 'grp_1', amount_paise: GROUP_PRICE })
    expect(paymentTargets(group, 'grp_1')).toBe(true)
    expect(paymentTargets(group, 'req_a')).toBe(false)
  })

  it('still matches an ordinary swap payment by request_id', () => {
    const swap = row()
    expect(paymentTargets(swap, 'req_a')).toBe(true)
    expect(paymentTargets(swap, 'req_b')).toBe(false)
  })

  /* The columns are not one field. The schema forbids two targets, so a lookup
     that treats them as interchangeable would match the wrong payment. */
  it('does not treat the two columns as one field', () => {
    const both = row({ group_id: 'req_a' })
    expect(paymentTargets(both, 'req_a')).toBe(true)
    expect(paymentTargets(both, 'grp_1')).toBe(false)
  })

  it('reports the target it actually carries', () => {
    expect(paymentTargetId(row())).toBe('req_a')
    expect(paymentTargetId(row({ request_id: null, group_id: 'grp_1' }))).toBe('grp_1')
  })

  /* The receipt screen asks this question to decide whether to show a ₹199
     family line or a ₹99 swap line. A server group trip's id is a uuid, so
     anything that sniffs for a `grp_` prefix answers "no" for it — this is the
     difference between the right receipt and a wrong one. */
  it('recognises a group payment from the column, including a server uuid id', () => {
    expect(isGroupPayment(row())).toBe(false)
    /* A uuid, not `grp_…`: the case an id-shape check gets wrong. */
    expect(isGroupPayment(row({ request_id: null, group_id: 'c1b42c33-88cd-41d4-b38d-a9fda7ea5a9f' }))).toBe(true)
    expect(isGroupPayment(row({ request_id: null, group_id: 'grp_1' }))).toBe(true)
  })

  /* On any row the schema permits, "is a group payment" and "has no request"
     are the same sentence — which is exactly why the rule has to be written as
     the one that means what it says. They part company on a row with no target
     at all, which `normalisePayment` will not invent one for and the admin list
     renders as an em dash. */
  it('is not "a payment with no request": a targetless row is neither', () => {
    expect(isGroupPayment(row({ request_id: null, group_id: null }))).toBe(false)
  })

  it('finds a paid ₹199 through paymentFor() by the group id', () => {
    const written = startPayment({ group_id: 'grp_1', provider: 'razorpay', amount_paise: GROUP_PRICE, credit_used_paise: 0, status: 'paid' })
    const found = paymentFor('grp_1')
    expect(found?.id).toBe(written.id)
    expect(found?.amount_paise).toBe(GROUP_PRICE)
    expect(found?.request_id).toBeNull()
    expect(found?.group_id).toBe('grp_1')
  })
})

describe('paymentFor() and usePaymentFor() cannot disagree', () => {
  /* These were two copies of one filter and only one of them knew a payment
     could be for a group, so the pay screen could say "already paid" while the
     function that decides whether to charge said otherwise. One rule, one
     function — so assert the hook answers exactly what the function answers. */
  it('the hook resolves what the function resolves, for both target kinds', () => {
    startPayment({ request_id: 'req_a', provider: 'razorpay', amount_paise: SWAP_PRICE, credit_used_paise: 0, status: 'created' })
    startPayment({ group_id: 'grp_1', provider: 'razorpay', amount_paise: GROUP_PRICE, credit_used_paise: 0, status: 'paid' })

    for (const target of ['req_a', 'grp_1', 'nothing']) {
      const { result } = renderHook(() => usePaymentFor(target))
      expect(result.current).toEqual(paymentFor(target))
    }
  })

  /* The specific regression: the hook matched `request_id` only, so it could
     not see a group's ₹199 at all. */
  it('the hook sees a group payment the imperative lookup sees', () => {
    startPayment({ group_id: 'grp_1', provider: 'razorpay', amount_paise: GROUP_PRICE, credit_used_paise: 0, status: 'paid' })
    const { result } = renderHook(() => usePaymentFor('grp_1'))
    expect(result.current?.group_id).toBe('grp_1')
    expect(result.current?.amount_paise).toBe(GROUP_PRICE)
  })

  it('prefers paid, then pending, then created, then the newest', () => {
    const rows = [
      row({ id: 'old', status: 'created' }),
      row({ id: 'live', status: 'pending' }),
      row({ id: 'done', status: 'paid' }),
    ]
    expect(pickPaymentFor(rows, 'req_a')?.id).toBe('done')
    expect(pickPaymentFor(rows.filter((r) => r.id !== 'done'), 'req_a')?.id).toBe('live')
    expect(pickPaymentFor(rows.filter((r) => r.id === 'old'), 'req_a')?.id).toBe('old')
  })

  it('is undefined, not a row belonging to another target', () => {
    expect(pickPaymentFor([row({ id: 'pay_s' })], 'grp_1')).toBeUndefined()
    expect(pickPaymentFor([row({ id: 'pay_s' })], 'req_a')?.id).toBe('pay_s')
  })
})

describe('startPayment enforces the XOR the schema enforces', () => {
  it('accepts either target on its own', () => {
    const swap = startPayment({ request_id: 'req_a', provider: 'razorpay', amount_paise: SWAP_PRICE, credit_used_paise: 0 })
    const group = startPayment({ group_id: 'grp_1', provider: 'razorpay', amount_paise: GROUP_PRICE, credit_used_paise: 0 })
    expect(swap.request_id).toBe('req_a')
    expect(swap.group_id).toBeNull()
    expect(group.group_id).toBe('grp_1')
    expect(group.request_id).toBeNull()
  })

  /* TypeScript already refuses both-or-neither at compile time; this is the same
     XOR for a value that arrived from localStorage, where nothing checked it.
     The database would reject such an insert, so the mirror refuses it here
     rather than storing a row that can never sync. */
  it('refuses both targets at once', () => {
    const both = { request_id: 'req_a', group_id: 'grp_1', provider: 'razorpay', amount_paise: SWAP_PRICE, credit_used_paise: 0 }
    const call = () => startPayment(both as unknown as Parameters<typeof startPayment>[0])
    expect(call).toThrow(StoreError)
    expect(call).toThrow(/payment_target/)
    expect(stored<PaymentRow>(PAYMENTS_KEY)).toHaveLength(0)
  })

  it('refuses no target at all', () => {
    const neither = { provider: 'razorpay', amount_paise: SWAP_PRICE, credit_used_paise: 0 }
    const call = () => startPayment(neither as unknown as Parameters<typeof startPayment>[0])
    expect(call).toThrow(/payment_target/)
    expect(stored<PaymentRow>(PAYMENTS_KEY)).toHaveLength(0)
  })

  /* Rule 2: money moves once. The lookup has to see the group's ₹199 or the
     second attempt is not a repeat and the traveller is charged twice. */
  it('is idempotent per target, whichever column carries it', () => {
    const first = startPayment({ request_id: 'req_a', provider: 'razorpay', amount_paise: SWAP_PRICE, credit_used_paise: 0, status: 'pending' })
    const again = startPayment({ request_id: 'req_a', provider: 'paypal', amount_paise: SWAP_PRICE, credit_used_paise: 0 })
    expect(again.id).toBe(first.id)

    const g1 = startPayment({ group_id: 'grp_1', provider: 'razorpay', amount_paise: GROUP_PRICE, credit_used_paise: 0, status: 'pending' })
    const g2 = startPayment({ group_id: 'grp_1', provider: 'razorpay', amount_paise: GROUP_PRICE, credit_used_paise: 0 })
    expect(g2.id).toBe(g1.id)
    expect(stored<PaymentRow>(PAYMENTS_KEY)).toHaveLength(2)
  })
})

describe('a row written before the fix still reads as paid', () => {
  /* Every group payment the pre-fix beginGroupCheckout() wrote carries the group
     id in request_id. Rewriting only on write would leave those rows in a shape
     the XOR accepts but the foreign key never would — and, worse, drop them out
     of the lookup, so a paid ₹199 reads as unpaid and checkout mints a second
     one. So the move happens on load. */
  const legacy = (over: Record<string, unknown> = {}) => ({
    id: 'pay_old', request_id: 'grp_abc123', payer_id: 'user_1', provider: 'razorpay',
    provider_ref: null, amount_paise: GROUP_PRICE, credit_used_paise: 0, currency: 'INR',
    status: 'paid', receipt_number: 'SS-1', created_at: '2026-11-12T10:00:00.000Z',
    updated_at: '2026-11-12T10:00:00.000Z', ...over,
  })

  it('moves a grp_ id out of request_id into group_id', () => {
    storeRaw([legacy()])
    const found = paymentFor('grp_abc123')
    expect(found?.id).toBe('pay_old')
    expect(found?.status).toBe('paid')
    expect(found?.request_id).toBeNull()
    expect(found?.group_id).toBe('grp_abc123')
  })

  /* And the ₹199 is still found by the same id it always was, which is the whole
     point: nothing about the traveller's payment changed. The legacy row has to
     name the REAL group id, because that is what the pre-fix checkout wrote. */
  it('does not charge a second ₹199 for a group already paid before the fix', () => {
    const group = createGroup('Family', [])
    storeRaw([legacy({ request_id: group.id })])
    const ticket = beginGroupCheckout(group.id, 'razorpay', false)
    expect(ticket.paymentId).toBe('pay_old')
    expect(ticket.settled).toBe(true)
    expect(paymentFor(group.id)?.status).toBe('paid')
    expect(stored<PaymentRow>(PAYMENTS_KEY)).toHaveLength(1)
  })

  it('keeps the request when the two columns already disagree', () => {
    /* The request wins: it is the column every other table hangs off, and a
       group payment with no group row behind it is not readable anyway. */
    storeRaw([legacy({ id: 'pay_both', request_id: 'req_a', group_id: null })])
    const found = paymentFor('req_a')
    expect(found?.id).toBe('pay_both')
    expect(found?.group_id).toBeNull()
  })

  it('adds the missing group_id key to rows that predate the column', () => {
    storeRaw([legacy({ id: 'pay_swap', request_id: 'req_a', group_id: undefined })])
    const found = paymentFor('req_a')
    expect(found?.group_id).toBeNull()
    expect(found?.request_id).toBe('req_a')
    expect(found?.amount_paise).toBe(GROUP_PRICE)
  })
})

describe('beginGroupCheckout pays for the group', () => {
  it('writes the ₹199 into group_id and leaves request_id null', () => {
    const group = createGroup('Family', [])
    const ticket = beginGroupCheckout(group.id, 'razorpay', false)
    const found = paymentFor(group.id)
    expect(found?.group_id).toBe(group.id)
    expect(found?.request_id).toBeNull()
    expect(ticket.paymentId).toBe(found?.id)
    expect(stored<PaymentRow>(PAYMENTS_KEY)).toHaveLength(1)
  })

  /* Two `startPayment` calls sit in this function — one for the gateway branch
     and one for the credit-only branch — and only covering one of them leaves the
     other free to go back to writing request_id without anything noticing. */
  it('writes the same target when credit covers the whole ₹199', () => {
    fundWallet(29700)
    const group = createGroup('Family', [])
    const ticket = beginGroupCheckout(group.id, 'razorpay', true)
    expect(ticket.provider).toBe('credit')
    expect(ticket.settled).toBe(true)
    expect(getGroup(group.id)?.paid).toBe(true)
    const found = paymentFor(group.id)
    expect(found?.group_id).toBe(group.id)
    expect(found?.request_id).toBeNull()
    expect(stored<PaymentRow>(PAYMENTS_KEY)).toHaveLength(1)
  })

  /* Rule 4: the credit a group payment spends has no swap request behind it. */
  it('spends the group credit with no ref_request_id', () => {
    fundWallet(29700)
    const group = createGroup('Family', [])
    beginGroupCheckout(group.id, 'razorpay', true)
    const spends = stored<WalletTx>(WALLET_KEY).filter((tx) => tx.kind === 'used')
    expect(spends).toHaveLength(1)
    expect(spends[0]?.ref_request_id).toBeNull()
  })

  it('reuses the one payment on a second call instead of charging again', () => {
    const group = createGroup('Family', [])
    const first = beginGroupCheckout(group.id, 'razorpay', false)
    const second = beginGroupCheckout(group.id, 'razorpay', false)
    expect(second.paymentId).toBe(first.paymentId)
    expect(stored<PaymentRow>(PAYMENTS_KEY)).toHaveLength(1)
  })

  it('is still unsettled once the gateway order is opened, and settled after capture', () => {
    const group = createGroup('Family', [])
    beginGroupCheckout(group.id, 'razorpay', false)
    expect(paymentFor(group.id)?.status).toBe('pending')
    markGroupPaid(group.id)
    expect(getGroup(group.id)?.paid).toBe(true)
    const third = beginGroupCheckout(group.id, 'razorpay', false)
    expect(third.paymentId).toBe(paymentFor(group.id)?.id)
  })
})

describe('the admin view reads a group payment without inventing a swap', () => {
  const group = row({ id: 'pay_g', request_id: null, group_id: 'grp_1', amount_paise: GROUP_PRICE })

  it('lists the payment under its group id', () => {
    expect(paymentIdsFor([group], 'grp_1')).toEqual(['pay_g'])
    expect(paymentIdsFor([group], 'req_a')).toEqual([])
  })

  /* Rule 6 sends a requester to credit only when a swap did not happen. A group
     trip has no swap request to void, so the lookup must not be fed the group
     id — that would file a ₹199 as a refund. */
  it('never marks a group payment as going to credit', () => {
    expect(paymentOutcome(group, new Set(['grp_1']))).toBe('paid')
    expect(paymentOutcome(row({ request_id: 'req_a' }), new Set(['req_a']))).toBe('to_credit')
  })

  it('shows the target in the swap column rather than an empty cell', () => {
    const [listed] = paymentRows([group], [])
    expect(listed?.target_id).toBe('grp_1')
    expect(listed?.request_id).toBeNull()
    expect(listed?.swap).toBe('#1')
    expect(listed?.received_paise).toBe(GROUP_PRICE)
  })

  it('shows a dash, never a bare hash, when a row carries no target', () => {
    const [listed] = paymentRows([row({ request_id: null, group_id: null })], [])
    expect(listed?.swap).toBe('—')
  })
})

describe('credit spent on a group payment has no swap request to point at', () => {
  /* wallet_tx.ref_request_id is a uuid FK to swap_requests and wallet_tx has no
     group_id of its own, so a group payment's spend is attributed to the payer
     with a null reference. Pointing it at the group id would fail the same cast
     the payment row used to fail. */
  it('writes ref_request_id null for a group payment and the id for a swap', () => {
    /* `useCredit` refuses more than the balance (rule 4: credit only ever lowers
       a fee), so there has to be some credit to spend. */
    credit({ to: 'requester', amountPaise: 9900, kind: 'swap_to_credit', ref_request_id: null })
    useCredit(5000, null)
    useCredit(4000, 'req_a')
    const refs = stored<WalletTx>(WALLET_KEY).map((tx) => tx.ref_request_id)
    expect(refs).toContain(null)
    expect(refs).toContain('req_a')
  })

  /* And the guard still holds: a spend cannot exceed the balance, whatever the
     reference is. */
  it('still refuses to spend credit that was never earned', () => {
    expect(useCredit(5000, null)).toBeUndefined()
    expect(stored<WalletTx>(WALLET_KEY)).toHaveLength(0)
  })
})

/* This suite renders no routes — there is no router harness — so these two are
   source-level on purpose, and say so. Both defects they cover were real and
   were invisible to every behavioural test above: one route reads the wrong
   column, the other re-derives a value its data layer had already derived. The
   behaviour each one depends on (`isGroupPayment`, `paymentRows().swap`) IS
   pinned behaviourally above; this only pins that the route calls it. */
describe('the two routes read the target, not the request column', () => {
  const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
  const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
  /* Comments are stripped, for the reason schema.test.ts gives: a comment that
     merely *names* the wrong expression is not the code doing it, and both of
     these routes explain the defect they were fixed for right next to the fix. */
  const route = (name: string): string =>
    stripSqlComments(readFileSync(join(import.meta.dirname, '..', 'src', 'routes', name), 'utf8'))

  it('the receipt asks the row, not the shape of its id', () => {
    const src = route('profile.payments.$id.tsx')
    expect(src).toMatch(/isGroupPayment\(payment\)/)
    /* `startsWith('grp_')` is how this went wrong: server group ids are uuids. */
    expect(src).not.toMatch(/startsWith\(\s*['"]grp_/)
    expect(src).not.toMatch(/isGroupRequestId/)
  })

  it('the admin list renders the swap label its data layer already derived', () => {
    const src = route('admin.payments.tsx')
    expect(src).toMatch(/title=\{row\.target_id \?\? undefined\}/)
    expect(src).toMatch(/\{row\.swap\}/)
    /* Recomputing it here shortened request_id, which is null for every group
       payment, so every ₹199 row printed a bare `#`. */
    expect(src).not.toMatch(/shortId\(row\./)
    expect(src).not.toMatch(/title=\{row\.request_id\}/)
  })
})