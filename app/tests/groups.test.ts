/* Family trips: organiser links PNRs, ₹199 covers up to 3 swaps (docs/04 C). */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createGroup,
  getGroup,
  groupForTrip,
  groupJourney,
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
  activityLog,
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

describe('family groups: "3 of 4 together" (docs/01, docs/04 C)', () => {
  const DAY = '2026-11-12'
  let n = 0
  async function member(coach: string, opts: { journey?: string; train?: string } = {}): Promise<string> {
    n += 1
    const trip = await addTrip({
      pnr: `45127896${String(30 + n).padStart(2, '0')}`,
      train_no: opts.train ?? '12951',
      journey_date: opts.journey ?? DAY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach, berth_no: String(10 + n), berth_type: 'LB' }],
    })
    return trip.id
  }

  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
    resetGroups()
    n = 0
  })

  it('counts the biggest cluster, not whichever trip was linked first', async () => {
    /* The odd one out is linked FIRST. Anchoring on trips[0] answered
       "1 of 4 together" when 3 of 4 really are together. */
    const outlier = await member('B5')
    const together = [await member('B1'), await member('B1'), await member('B1')]
    const group = createGroup('Sharma family', [outlier, ...together])
    expect(groupTogetherCount(group)).toEqual({ done: 3, total: 4 })
  })

  it('a different train or journey date is never "together"', async () => {
    const together = [await member('B1'), await member('B1')]
    const otherTrain = await member('B1', { train: '12952' })
    const otherDay = await member('B1', { journey: '2026-11-13' })
    const group = createGroup('Mixed family', [...together, otherTrain, otherDay])
    expect(groupTogetherCount(group)).toEqual({ done: 2, total: 4 })
  })

  it('counts the best coach, not the first coach seen', async () => {
    const group = createGroup('Two coaches', [
      await member('B2'),
      await member('B1'),
      await member('B1'),
    ])
    expect(groupTogetherCount(group)).toEqual({ done: 2, total: 3 })
  })

  it('a group of one is trivially together', async () => {
    const only = await member('B1')
    expect(groupTogetherCount(createGroup('Solo', [only]))).toEqual({ done: 1, total: 1 })
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

describe('unused group cover converts to credit (docs/01, rule 6)', () => {
  const DAY = Date.parse('2026-11-12T00:00:00Z')
  it('converts only paid trips past journey end with zero covered swaps', async () => {
    const { isUnusedGroupCover } = await import('@/lib/jobs')
    const after = DAY + 86400000
    expect(isUnusedGroupCover(after, DAY, 0)).toBe(true)
    /* Journey not over yet. */
    expect(isUnusedGroupCover(DAY - 1000, DAY, 0)).toBe(false)
    /* Partially used bundles are spent, never converted. */
    expect(isUnusedGroupCover(after, DAY, 1)).toBe(false)
    expect(isUnusedGroupCover(after, DAY, 3)).toBe(false)
  })
})

describe('"x of y together" counts people, not tickets (designs 5a, 19a)', () => {
  const DAY = '2026-11-12'
  let n = 0
  /** One PNR, which may hold several passengers — design 19a's "PNR ••• 4821,
      2 people · A2". A null coach means no berth allotted yet (WL/RAC) or a
      child travelling without one. */
  async function ticket(
    seats: Array<{ coach: string | null; berth?: string; child?: boolean }>,
  ): Promise<string> {
    n += 1
    const trip = await addTrip({
      pnr: `45127896${String(50 + n).padStart(2, '0')}`,
      train_no: '12951',
      journey_date: DAY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: seats.map((seat) => ({
        coach: seat.coach,
        berth_no: seat.berth ?? null,
        berth_type: seat.coach ? ('LB' as const) : undefined,
        status: seat.coach ? ('CNF' as const) : ('WL' as const),
        is_child_no_berth: seat.child === true,
      })),
    })
    return trip.id
  }

  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
    resetGroups()
    n = 0
  })

  it('a two-person ticket counts as two people', async () => {
    const pair = await ticket([{ coach: 'A2', berth: '11' }, { coach: 'A2', berth: '12' }])
    const solo = await ticket([{ coach: 'B1', berth: '40' }])
    /* Counting trips answered "1 of 2": the family is three people, two of
       whom are together. */
    expect(groupTogetherCount(createGroup('Sharma family', [pair, solo]))).toEqual({
      done: 2,
      total: 3,
    })
  })

  it('design 5a: two in A2 and two in B1 reads "2 of 4"', async () => {
    const parents = await ticket([{ coach: 'A2', berth: '12' }, { coach: 'A2', berth: '14' }])
    const others = await ticket([{ coach: 'B1', berth: '40' }, { coach: 'B1', berth: '42' }])
    expect(groupTogetherCount(createGroup('Four across two coaches', [parents, others]))).toEqual({
      done: 2,
      total: 4,
    })
  })

  it('a child without a berth is a member who is never seated', async () => {
    /* docs/04 C: "Child without berth → counted in group, never offered." */
    const withChild = await ticket([{ coach: 'A2', berth: '11' }, { coach: null, child: true }])
    const other = await ticket([{ coach: 'A2', berth: '12' }])
    expect(groupTogetherCount(createGroup('Child along', [withChild, other]))).toEqual({
      done: 2,
      total: 3,
    })
  })

  it('members with no coach are in the total and never in the cluster', async () => {
    /* The bug this pins: keying the cluster on `coach ?? ''` grouped every
       unallocated passenger under the same empty key, so two waitlisted
       travellers read "2 of 2 together". */
    const wl1 = await ticket([{ coach: null }])
    const wl2 = await ticket([{ coach: null }])
    expect(groupTogetherCount(createGroup('Still waitlisted', [wl1, wl2]))).toEqual({
      done: 0,
      total: 2,
    })
    const cnf = await ticket([{ coach: 'A2', berth: '11' }])
    const stillOut = await ticket([{ coach: null }])
    const alsoOut = await ticket([{ coach: null }])
    expect(groupTogetherCount(createGroup('Partly confirmed', [cnf, stillOut, alsoOut]))).toEqual({
      done: 1,
      total: 3,
    })
  })
})

describe('one trip belongs to one family trip', () => {
  const DAY = '2026-11-12'
  let n = 0
  async function member(): Promise<string> {
    n += 1
    const trip = await addTrip({
      pnr: `45127896${String(70 + n).padStart(2, '0')}`,
      train_no: '12951',
      journey_date: DAY,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach: 'B1', berth_no: String(20 + n), berth_type: 'LB' }],
    })
    return trip.id
  }

  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
    resetGroups()
    n = 0
  })

  it('refuses to put one booking in two ₹199 bundles', async () => {
    /* `group_for_trip()` picks the first group containing the trip, and which
       one it picks decides whether a member's swap is covered by the ₹199
       already paid or costs another ₹99. Nothing in the UI asks, so the model
       refuses the state. */
    const t1 = await member()
    const t2 = await member()
    const first = createGroup('Wedding party', [t1])
    const second = createGroup('Another cousin group', [t1, t2])
    expect(second.trip_ids).toEqual([t2])
    expect(linkTrip(second.id, t1)).toBeUndefined()
    expect(groupForTrip(t1)?.id).toBe(first.id)
    /* The audit row counts what was actually linked, not what was asked for. */
    const row = activityLog().find((r) => r.action === 'group_created' && r.entity_id === second.id)
    expect(row?.meta).toEqual({ trips: 1 })
  })
})

describe('group audit rows use the money constants (docs/08)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetGroups()
  })

  it('logs GROUP_PRICE_PAISE, not a literal that can drift from it', () => {
    const group = createGroup('Sharma family', ['t1'])
    markGroupPaid(group.id)
    const row = activityLog().find((r) => r.action === 'group_paid' && r.entity_id === group.id)
    expect(row?.meta).toEqual({ amount_paise: GROUP_PRICE_PAISE })
  })
})

describe('the family flow is reachable (docs/05 screens 52-53)', () => {
  const { readdirSync, readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
  const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
  const ROUTES = join(import.meta.dirname, '..', 'src', 'routes')

  /** [file name, source] for every route file, excluding the group routes. */
  function otherRoutes(): Array<[string, string]> {
    return readdirSync(ROUTES)
      .filter((name) => name.endsWith('.tsx') && !name.startsWith('groups.'))
      .map((name) => [name, readFileSync(join(ROUTES, name), 'utf8')])
  }

  it('has at least one link into /groups from outside the group screens', () => {
    /* This feature was unreachable for a long stretch: the only links to
       /groups/$id sat in the pay screens, i.e. *after* a group payment that
       nothing could start, and `components/new-group-card` — the create form —
       was rendered by nobody. A family trip therefore needs an entry point that
       is not itself inside the flow it opens. */
    const entries = otherRoutes().filter(([, src]) => /to="\/groups"/.test(src))
    expect(entries.map(([name]) => name)).toContain('profile.tsx')
  })

  it('moves with the router instead of reloading the page', () => {
    for (const name of ['groups.index.tsx', 'groups.$id.tsx', 'groups.$id.plan.tsx']) {
      const src = readFileSync(join(ROUTES, name), 'utf8')
      expect(src, name).not.toMatch(/window\.location\.(assign|href|replace)/)
    }
  })

  it('shows the three-tab bar on the screens docs/05 gives a tab', () => {
    /* AGENTS.md 12: three tabs everywhere except setup screens. Design 19a/19b
       draw the tab bar and docs/05 lists screens 52/53 under Home; screen 34
       (`/onboard/$tripId`, design 7a) likewise. */
    for (const name of [
      'groups.index.tsx',
      'groups.$id.index.tsx',
      'groups.$id.plan.tsx',
      'onboard.$tripId.tsx',
    ]) {
      const src = readFileSync(join(ROUTES, name), 'utf8')
      expect(src, name).toMatch(/chrome: 'tabs', tab: 'home'/)
    }
  })
})

describe('groupJourney (design 19b subtitle)', () => {
  const DAY = '2026-11-12'
  let n = 0
  async function member(train: string, day: string): Promise<string> {
    n += 1
    const trip = await addTrip({
      pnr: `45127896${String(80 + n).padStart(2, '0')}`,
      train_no: train,
      train_name: 'Rajdhani',
      journey_date: day,
      class: '3A',
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: [{ coach: 'B1', berth_no: String(30 + n), berth_type: 'LB' }],
    })
    return trip.id
  }

  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
    resetGroups()
    n = 0
  })

  it('names the journey when every ticket shares it, and says nothing when they do not', async () => {
    const a = await member('12951', DAY)
    const b = await member('12951', DAY)
    expect(groupJourney(createGroup('Together', [a, b]))).toEqual({
      train_no: '12951',
      train_name: 'Rajdhani',
      journey_date: DAY,
    })
    /* Two trains: there is no single headline, and printing the first trip's
       would describe 2 of the family as if it were all of them. Fresh PNRs —
       `a` is already in the group above, and one trip belongs to one family. */
    const splitA = await member('12951', DAY)
    const splitB = await member('12952', DAY)
    expect(groupJourney(createGroup('Split', [splitA, splitB]))).toBeNull()
    expect(groupJourney(createGroup('Empty', []))).toBeNull()
  })
})
