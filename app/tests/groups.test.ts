/* Family trips: organiser links PNRs, ₹199 covers up to 3 swaps (docs/04 C). */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BERTHS_PER_BAY,
  baySlot,
  createGroup,
  getGroup,
  groupBayRows,
  groupCoachMap,
  groupForTrip,
  groupJourney,
  groupTogetherCount,
  groupUnplacedBerths,
  linkTrip,
  listGroups,
  markGroupPaid,
  resetGroups,
  type GroupCoach,
} from '@/lib/groups'
import { GROUP_PRICE_PAISE } from '@/lib/money'
import type { BerthType } from '@/lib/pnr'
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

/* Source scan, the `qa-placeholders` idiom: one rule-13 guarantee is about
   what the *route* renders rather than what this file's helpers return, so it
   has to read the route. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')

function read(rel: string): string {
  return readFileSync(join(import.meta.dirname, '..', rel), 'utf8')
}

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
  async function acceptedMemberRequest(tripId: string, acceptorId?: string) {
    const request = createRequest({ trip_id: tripId, choices: ['UB'] })
    sendRequest(request.id, acceptorId ? [acceptorId] : undefined)
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
    expect(listPayments().filter((p) => p.group_id === group.id)).toHaveLength(1)
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
    /* One peer berth per member. Every trip on this device belongs to the same
       local account, so four requests aimed at ONE acceptor would hit that
       acceptor's daily inbound cap (docs/03, default 3 — pinned by
       tests/abuse-limits.test.ts) before this test ever reached the group's
       three-lock cover cap, which is what it is actually about. */
    const acceptors = [await acceptorTrip(), await acceptorTrip(), await acceptorTrip(), await acceptorTrip()]
    /* Pay the group trip first. */
    const paid = beginCheckout(group.id, 'razorpay')
    confirmCaptured(group.id, 'order_demo_grp')
    expect(paid.total).toBe(19900)
    const locked: string[] = []
    for (const [index, tripId] of tripIds.entries()) {
      const request = await acceptedMemberRequest(tripId, acceptors[index])
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

  it('puts the plan card above the coach map, as 19b does', () => {
    /* Design 19b reads top to bottom: "3 of 4 seated together" → the coach map
       → the pay button. Shipping the map first meant the two things a user came
       to compare — the count and the shape behind it — were separated by a
       card boundary in the wrong order. Position, not presence: an assertion
       that both exist would have stayed green through the swap.

       Measured from the **return**, not the top of the file. An earlier
       version of this test searched the whole source and found `groupBayRows`
       on its derivation line, which sits above the plan card on every layout —
       so the assertion was really about where the data is computed, and it
       failed the moment the cards were ordered the way the design orders them.
       The question is what the user reads first. */
    const src = readFileSync(join(ROUTES, 'groups.$id.plan.tsx'), 'utf8')
    const jsx = src.slice(src.indexOf('return ('))
    const partial = jsx.indexOf("t('groups.partial'")
    /* The map is the block that renders bay rows, not the line that derives
       them. */
    const map = jsx.indexOf('bayRows.map')
    expect(partial).toBeGreaterThan(-1)
    expect(map).toBeGreaterThan(-1)
    expect(partial).toBeLessThan(map)
  })

  it('makes 19a’s member rows real links, not divs with a chevron', () => {
    /* A chevron is a promise of somewhere to go. The capture showed the design
       drawing one on every linked ticket while the row was a <div> that went
       nowhere — an affordance that lies. */
    const src = readFileSync(join(ROUTES, 'groups.$id.tsx'), 'utf8')
    expect(src).toMatch(/to="\/trips\/\$tripId"/)
    const row = src.slice(src.indexOf('groupTrips.map'), src.indexOf('Link a PNR'))
    expect(row).toMatch(/<Link/)
    expect(row).toMatch(/ChevronRight/)
  })
})

describe('the onboard live chip only says Live while it is live (design 7a)', () => {
  const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
  const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'onboard.$tripId.tsx'), 'utf8')

  it('derives liveness from the journey date instead of always claiming it', () => {
    /* "Live coach board" is the promise of this screen. A chip that says Live
       on a journey three weeks past, or one that departs tomorrow, is the one
       small lie it must never tell — the screen's entire value is that what it
       shows is happening now. Asserted on the derivation, not the rendering. */
    expect(src).toMatch(/journey_date/)
    expect(src).toMatch(/live\s*=/)
    expect(src).toMatch(/onboard\.notLive/)
  })

  it('keeps state and stop in ONE chip, as 7a draws it', () => {
    /* Two pills read as two facts when the design means one sentence. The
       first attempt at this pass shipped two, and the capture showed it. */
    const chips = src.match(/<Pill/g)?.length ?? 0
    const header = src.slice(0, src.indexOf('<Card className="mt-4 border-primary'))
    expect((header.match(/<Pill/g) ?? []).length).toBeLessThanOrEqual(1)
    expect(chips).toBeGreaterThan(0)
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

describe('coach map (design 19b, docs/04 C "see everyone on one coach map")', () => {
  const DAY = '2026-11-12'
  let n = 0
  async function ticket(
    train: string,
    seats: Array<{ coach: string | null; berth?: string | null; type?: BerthType; child?: boolean }>,
    klass: '3A' | 'CC' = '3A',
  ): Promise<string> {
    n += 1
    const trip = await addTrip({
      pnr: `45127896${String(60 + n).padStart(2, '0')}`,
      train_no: train,
      journey_date: DAY,
      class: klass,
      from_code: 'MMCT',
      to_code: 'NDLS',
      passengers: seats.map((seat) => ({
        coach: seat.coach,
        berth_no: seat.berth ?? null,
        ...(seat.type ? { berth_type: seat.type } : {}),
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

  it('places every berth the family holds, biggest coach first', async () => {
    const pair = await ticket('12951', [
      { coach: 'B1', berth: '40' },
      { coach: 'B1', berth: '42' },
    ])
    const parents = await ticket('12951', [
      { coach: 'A2', berth: '12' },
      { coach: 'A2', berth: '14' },
      { coach: 'A2', berth: '16' },
    ])
    /* Opens on the coach with most of the family (the strip's default view),
       and keeps link order inside a coach. */
    expect(groupCoachMap(createGroup('Five across two coaches', [pair, parents]))).toEqual({
      coaches: [
        {
          coach: 'A2',
          train_no: '12951',
          journey_date: DAY,
          berths: [
            { berth_no: '12', bay: 2, slot: 4 },
            { berth_no: '14', bay: 2, slot: 6 },
            { berth_no: '16', bay: 2, slot: 8 },
          ],
        },
        {
          coach: 'B1',
          train_no: '12951',
          journey_date: DAY,
          /* 40 is the last berth of bay 5, 42 the second of bay 6: a pair on
             adjacent bays, not in one. The map is the only place that shows. */
          berths: [
            { berth_no: '40', bay: 5, slot: 8 },
            { berth_no: '42', bay: 6, slot: 2 },
          ],
        },
      ],
      unseated: 0,
    })
  })

  it('ties keep link order, and a coach is train + date + code', async () => {
    const first = await ticket('12951', [{ coach: 'A2', berth: '12' }])
    const second = await ticket('12951', [{ coach: 'B1', berth: '40' }])
    expect(groupCoachMap(createGroup('Two coaches, one each', [first, second])).coaches.map((c) => c.coach)).toEqual([
      'A2',
      'B1',
    ])
    /* "A2 on 12951" and "A2 on 12952" are not the same place. Fresh PNRs:
       `first` is already in the group above. */
    const onFirst = await ticket('12951', [{ coach: 'A2', berth: '12' }])
    const sameCodeOtherTrain = await ticket('12952', [{ coach: 'A2', berth: '9' }])
    const map = groupCoachMap(createGroup('Two trains', [onFirst, sameCodeOtherTrain]))
    expect(map.coaches).toHaveLength(2)
    expect(map.coaches.map((c) => `${c.train_no}/${c.coach}`)).toEqual(['12951/A2', '12952/A2'])
  })

  it('counts the seatless without placing them in a coach', async () => {
    /* The map must not imply a location for someone who does not have one:
       waitlisted, RAC, and the child travelling without a berth (docs/04 C). */
    const berth = await ticket('12951', [{ coach: 'A2', berth: '12' }])
    const childTicket = await ticket('12951', [
      { coach: 'A2', berth: '13' },
      { coach: null, child: true },
    ])
    const waitlisted = await ticket('12951', [{ coach: null }])
    const map = groupCoachMap(createGroup('One waiting', [berth, childTicket, waitlisted]))
    expect(map.coaches).toHaveLength(1)
    expect(map.coaches[0].berths.map((b) => b.berth_no)).toEqual(['12', '13'])
    expect(map.unseated).toBe(2)
  })

  it('draws one row per bay, so "together" is a shape and not just a count', async () => {
    const trip = await ticket('12951', [
      { coach: 'A2', berth: '12' },
      { coach: 'A2', berth: '14' },
      { coach: 'A2', berth: '16' },
      { coach: 'A2', berth: '42' },
    ])
    const coach = groupCoachMap(createGroup('One bay and a far berth', [trip])).coaches[0]
    const rows = groupBayRows(coach)
    /* Bay 2 is berths 9-16, so 12, 14 and 16 are one row — three of the four
       together — while 42 sits alone four bays down. That "same bay / different
       bay" answer is what a flat list of four numbers cannot give, and it is
       the question the screen is named after. */
    expect(rows.map((row) => row.bay)).toEqual([2, 6])
    for (const row of rows) expect(row.slots).toHaveLength(BERTHS_PER_BAY)
    expect(rows[0].slots.filter(Boolean).map((slot) => slot?.berth_no)).toEqual(['12', '14', '16'])
    expect(rows[1].slots.filter(Boolean).map((slot) => slot?.berth_no)).toEqual(['42'])
    /* A berth lands at its own index in the bay, which is what makes the row a
       layout rather than a list. */
    expect(rows[0].slots[3]?.berth_no).toBe('12')
    expect(rows[0].slots[5]?.berth_no).toBe('14')
    expect(rows[0].slots[7]?.berth_no).toBe('16')
  })

  it('leaves every slot the family does not hold empty', async () => {
    const trip = await ticket('12951', [{ coach: 'A2', berth: '12' }])
    const coach = groupCoachMap(createGroup('One berth', [trip])).coaches[0]
    const [row] = groupBayRows(coach)
    /* `null`, not a filler — there is no berth in scope for the view to print,
       which is what keeps another passenger's number off the screen. */
    expect(row.slots.filter((slot) => slot === null)).toHaveLength(BERTHS_PER_BAY - 1)
    expect(row.slots.filter(Boolean)).toEqual([{ berth_no: '12', bay: 2, slot: 4 }])
  })

  it('places by the berth number alone, never by berth_type', async () => {
    /* `addTrip` defaults `berth_type` to 'LB' whenever the PNR carried no berth
       word (lib/store.ts: `passenger.berth_type ?? (chair ? 'WINDOW' : 'LB')`),
       so a genuine upper stored that way is indistinguishable from a real
       lower. Only slots 1 and 4 of a bay are lower berths, so cross-checking
       the number against the type would refuse to place three berths in four.
       Berth 14 is the sixth slot of bay 2, and it must land there regardless. */
    const untyped = await ticket('12951', [{ coach: 'A2', berth: '14' }])
    expect(groupCoachMap(createGroup('No berth word', [untyped])).coaches[0].berths[0]).toEqual({
      berth_no: '14',
      bay: 2,
      slot: 6,
    })
    /* Even a type that flatly contradicts the number does not move it: the
       type is not evidence about position, and overruling the ticket with it
       would be inventing a seat. */
    const contradicted = await ticket('12951', [{ coach: 'A2', berth: '14', type: 'SL' }])
    expect(groupCoachMap(createGroup('Contradicted', [contradicted])).coaches[0].berths[0].slot).toBe(6)
  })

  it('a confirmed seat with no berth number is seated but off the map', async () => {
    /* Some quotas carry a coach without a berth number. The member exists
       there, so the cell exists with nothing to print — and crucially it is
       NOT drawn in the seatless row, which means "no seat yet". */
    const seat = await ticket('12951', [{ coach: 'D1', berth: null }])
    const coach = groupCoachMap(createGroup('No number', [seat])).coaches[0]
    expect(coach.berths).toEqual([{ berth_no: '', bay: null, slot: null }])
    expect(groupBayRows(coach)).toEqual([])
    expect(groupUnplacedBerths(coach)).toHaveLength(1)
  })

  it('a chair car is seated but has no bays to draw', async () => {
    const trip = await ticket('12951', [{ coach: 'D1', berth: '21' }], 'CC')
    const coach = groupCoachMap(createGroup('Chair car', [trip])).coaches[0]
    /* A seat number in a chair car is not a berth, and a row of seats is not a
       bay — placing seat 21 at "bay 3, slot 5" would be a made-up position. */
    expect(coach.berths).toEqual([{ berth_no: '21', bay: null, slot: null }])
    expect(groupBayRows(coach)).toEqual([])
    expect(groupUnplacedBerths(coach)).toHaveLength(1)
  })

  it('the view cannot print a berth number in an empty slot (rule 13)', () => {
    /* Two facts, and both are needed. (1) `groupBayRows` hands the view `null`
       for every slot the family does not hold, so no number is ever in scope.
       (2) The route does no bay arithmetic of its own — all of it lives in
       lib/groups.ts — so it cannot reconstruct one. A number in an empty slot
       would be another passenger's berth, which rule 13 forbids before
       payment; and it is derivable (slot 3 of bay 2 is berth 11), which is
       exactly why this is pinned rather than assumed. */
    const coach: GroupCoach = {
      coach: 'A2',
      train_no: '12951',
      journey_date: DAY,
      berths: [{ berth_no: '12', bay: 2, slot: 4 }],
    }
    const [row] = groupBayRows(coach)
    expect(row.slots.filter((slot) => slot === null)).toHaveLength(BERTHS_PER_BAY - 1)
    expect(read('src/routes/groups.$id.plan.tsx')).not.toContain('BERTHS_PER_BAY')
  })
})

describe('baySlot (a berth number is a position, not just a label)', () => {
  it('reads the bay and the slot straight out of the number', () => {
    /* The coach's own numbering, repeating an eight-berth bay all the way
       down — which is the whole reason design 19b's map can be drawn from a
       ticket at all. No seat chart, no lookup table. */
    expect(baySlot('1', false)).toEqual({ bay: 1, slot: 1 })
    expect(baySlot('8', false)).toEqual({ bay: 1, slot: 8 })
    expect(baySlot('9', false)).toEqual({ bay: 2, slot: 1 })
    expect(baySlot('12', false)).toEqual({ bay: 2, slot: 4 })
    expect(baySlot('40', false)).toEqual({ bay: 5, slot: 8 })
    expect(baySlot('42', false)).toEqual({ bay: 6, slot: 2 })
    expect(baySlot('72', false)).toEqual({ bay: 9, slot: 8 })
  })

  it('puts the bay boundary on the last berth of the bay, not one past it', () => {
    /* Bay 2 is berths 9-16: 16 is the *eighth* slot of bay 2 and 17 the first
       of bay 3. An off-by-one here is the whole map — it is the difference
       between "your family is in one bay" and "your family is in two". */
    expect(baySlot('8', false)).toEqual({ bay: 1, slot: 8 })
    expect(baySlot('9', false)).toEqual({ bay: 2, slot: 1 })
    expect(baySlot('16', false)).toEqual({ bay: 2, slot: 8 })
    expect(baySlot('17', false)).toEqual({ bay: 3, slot: 1 })
  })

  it('refuses anything that is not a berth', () => {
    /* A chair car has rows of seats, not bays of berths (CHAIR_CLASSES). */
    expect(baySlot('21', true)).toBeNull()
    /* No number, or not a number, or not a berth. */
    expect(baySlot(null, false)).toBeNull()
    expect(baySlot('', false)).toBeNull()
    expect(baySlot('12A', false)).toBeNull()
    expect(baySlot('0', false)).toBeNull()
    expect(baySlot('-3', false)).toBeNull()
  })
})
