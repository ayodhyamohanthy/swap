/* Admin helpers + scheduled-job date cores (docs/04-D, docs/08).
   The job comment in lib/jobs.ts claims these are "tested in admin.test.ts" —
   this is that file. Guards: paise integers, CSV escaping, masked PNRs only. */
/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool
   (same reason as tests/schema.test.ts). */
const { readFileSync, readdirSync, statSync } = process.getBuiltinModule(
  'node:fs',
) as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { beforeEach, describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'

import {
  ACTIVITY_CATEGORIES,
  ADMIN_ROUTES,
  acceptorName,
  activityActions,
  activityCategory,
  activityDetails,
  activityLabelKey,
  activityTime,
  activityToCsv,
  activityTone,
  activityTrain,
  buildOverview,
  collectedPaise,
  creditSummary,
  creditsToCsv,
  filterActivity,
  filterSwaps,
  firstOnTrainToday,
  PAYMENT_OUTCOMES,
  PAYMENT_OUTCOME_LABEL,
  PAYMENT_STATE_LABEL,
  paymentOutcome,
  paymentRows,
  paymentsToCsv,
  reportRows,
  reportsToCsv,
  shortId,
  statusesByPhase,
  SWAP_PHASES,
  SWAP_PHASE_LABEL,
  swapPhase,
  swapToCreditRequestIds,
  swapsThisWeek,
  swapsToCsv,
  toCsv,
  tonedActions,
  uncategorisedActions,
  usersToCsv,
  type AdminOverviewInput,
  type AdminPaymentRow,
  type AdminSwapRow,
  type AdminUserRow,
  type ActivityTone,
  type SwapPhase,
} from '@/lib/admin'
import {
  isCreditExpired,
  isRequestExpired,
  needsCreditReminder,
  shouldAutoConfirm,
  shouldNotifyChartTime,
} from '@/lib/jobs'
import { CATALOGS, SHIPPED_LANGS } from '@/lib/i18n'
import { FEE_PAISE, GROUP_PRICE_PAISE, PRICE_PAISE, THANK_YOU_PAISE } from '@/lib/money'
import {
  activityLog,
  getSnapshot,
  logActivity,
  resetStore,
  setPaymentStatus,
  startPayment,
  type ActivityRow,
  type PaymentRow,
  type WalletTx,
} from '@/lib/store'
import type { RequestStatus, SwapOffer, SwapRequest } from '@/lib/requests'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-11-12T10:00:00.000Z')

/** Follow a dotted catalogue path ("admin.act.pnr_added"). */
function catalogueValue(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (current, part) =>
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)[part]
        : undefined,
    node,
  )
}

/** The label string at a catalogue path, or null when it is missing. */
function lookupLabel(catalogue: unknown, path: string): string | null {
  const value = catalogueValue(catalogue, path)
  return typeof value === 'string' ? value : null
}

describe('admin route table', () => {
  it('lists the seven console screens', () => {
    expect(ADMIN_ROUTES.map((r) => r.path)).toEqual([
      '/admin',
      '/admin/activity',
      '/admin/users',
      '/admin/swaps',
      '/admin/payments',
      '/admin/credits',
      '/admin/reports',
    ])
  })
})

describe('toCsv', () => {
  it('writes a header, rows and a trailing newline', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\n1,2\n')
  })

  it('escapes commas, quotes and newlines', () => {
    expect(toCsv(['x'], [['a,b']])).toBe('x\n"a,b"\n')
    expect(toCsv(['x'], [['say "hi"']])).toBe('x\n"say ""hi"""\n')
    expect(toCsv(['x'], [['line1\nline2']])).toBe('x\n"line1\nline2"\n')
  })

  it('renders null and undefined as empty cells', () => {
    expect(toCsv(['x', 'y'], [[null, undefined]])).toBe('x,y\n,\n')
  })
})

describe('admin CSV exporters never leak a full PNR', () => {
  const swap: AdminSwapRow = {
    id: 'req_1',
    requester_last4: '9630',
    train_no: '12951',
    journey_date: '2026-11-12',
    status: 'locked',
    acceptor_name: 'Arjun S',
    amount_paise: PRICE_PAISE,
    phase: 'paid',
    updated_at: '2026-11-12',
  }

  it('exports the masked last4 only', () => {
    const csv = swapsToCsv([swap])
    expect(csv).toContain('9630')
    expect(csv).not.toMatch(/\b\d{10}\b/)
  })

  it('keeps every exporter ending in a newline', () => {
    expect(usersToCsv([]).endsWith('\n')).toBe(true)
    expect(paymentsToCsv([]).endsWith('\n')).toBe(true)
    expect(creditsToCsv([]).endsWith('\n')).toBe(true)
    expect(activityToCsv([]).endsWith('\n')).toBe(true)
  })
})

/* ---- design 17: the Swaps screen's phases and its two derivable columns ---- */

function swapRequest(over: Partial<SwapRequest> = {}): SwapRequest {
  return {
    id: 'req_1',
    trip_id: 'trip_1',
    requester_id: null,
    group_id: null,
    choices: ['LB'],
    same_coach: false,
    keep_together: false,
    reason_key: null,
    status: 'searching',
    paused: false,
    locked_offer_id: null,
    sent_at: null,
    created_at: '2026-11-12T10:00:00.000Z',
    updated_at: '2026-11-12T10:00:00.000Z',
    ...over,
  }
}

function swapOffer(over: Partial<SwapOffer> = {}): SwapOffer {
  return {
    id: 'off_1',
    request_id: 'req_1',
    acceptor_trip_id: 'trip_2',
    acceptor_name: 'Arjun S',
    acceptor_berth_type: 'UB',
    acceptor_coach: 'S4',
    acceptor_berth_no: '21',
    matched_choice_rank: 1,
    status: 'sent',
    created_at: '2026-11-12T10:00:00.000Z',
    responded_at: null,
    ...over,
  }
}

/** A screen row with `phase` derived from `status`, the way the route builds it. */
function swapRow(over: Partial<AdminSwapRow> = {}): AdminSwapRow {
  const status = over.status ?? 'searching'
  return {
    id: 'req_1',
    requester_last4: '9630',
    train_no: '12951',
    journey_date: '2026-11-12',
    status,
    acceptor_name: null,
    amount_paise: 0,
    phase: swapPhase(status),
    updated_at: '2026-11-12',
    ...over,
  }
}

describe('swapPhase — design 17\'s chips, and the states they cannot reach', () => {
  /* The union as it stands today. The real guard is the
     `Record<RequestStatus, SwapPhase>` in lib/admin.ts — adding a status to the
     state machine is a compile error there — and this list is what makes the
     runtime counts assertable at all, since types are erased. */
  const ALL: RequestStatus[] = [
    'draft',
    'searching',
    'accepted_awaiting_payment',
    'locked',
    'confirmed',
    'voided',
    'disputed',
    'expired',
    'withdrawn',
  ]

  it('maps every status, so no row is unfilterable', () => {
    for (const status of ALL) {
      expect(SWAP_PHASES, status).toContain(swapPhase(status))
    }
  })

  it('partitions them: every status lands in exactly one phase', () => {
    const seen = SWAP_PHASES.flatMap((phase) => statusesByPhase(phase))
    expect([...seen].sort()).toEqual([...ALL].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('leaves no chip dead — every phase owns at least one status', () => {
    for (const phase of SWAP_PHASES) {
      expect(statusesByPhase(phase).length, `${phase} is unreachable`).toBeGreaterThan(0)
    }
  })

  it("keeps the design's five names wherever they map", () => {
    expect(swapPhase('searching')).toBe('waiting')
    expect(swapPhase('accepted_awaiting_payment')).toBe('accepted')
    expect(swapPhase('locked')).toBe('paid')
    expect(swapPhase('confirmed')).toBe('done')
    expect(swapPhase('voided')).toBe('to_credit')
  })

  it('adds a chip for `disputed`, which the design has none for', () => {
    /* The design draws five chips and the state machine has nine values, so
       four of them are unreachable through the design's filter — `disputed`
       among them, and that is the one state where money is held and a person
       has to decide. It is the worst of the four to hide. */
    expect(SWAP_PHASES).toContain('disputed')
    expect(swapPhase('disputed')).toBe('disputed')
  })

  it('has a chip label in both languages for every phase', () => {
    const missing: string[] = []
    for (const chip of ['all', ...SWAP_PHASES] as Array<SwapPhase | 'all'>) {
      for (const lang of SHIPPED_LANGS) {
        if (!lookupLabel(CATALOGS[lang], SWAP_PHASE_LABEL[chip])) {
          missing.push(`${lang}:${SWAP_PHASE_LABEL[chip]}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('can name the exact state behind a phase, in both languages', () => {
    /* The pill shows the phase and the tooltip shows the real state, so the two
       vocabularies never collapse into one — and every status the map can
       produce needs a tooltip string to exist. */
    const missing: string[] = []
    for (const status of ALL) {
      for (const lang of SHIPPED_LANGS) {
        if (!lookupLabel(CATALOGS[lang], `request.statuses.${status}`)) {
          missing.push(`${lang}:request.statuses.${status}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe('filterSwaps — the All chip is the sum of the parts', () => {
  const rows = [
    swapRow({ id: 'a', status: 'searching' }),
    swapRow({ id: 'b', status: 'locked' }),
    swapRow({ id: 'c', status: 'confirmed' }),
    swapRow({ id: 'd', status: 'disputed' }),
  ]

  it('returns everything for null, which is what All means', () => {
    expect(filterSwaps(rows, null)).toHaveLength(rows.length)
  })

  it('partitions: the phase counts add up to the total', () => {
    /* If this fails, a chip is hiding a row — which is the whole reason the
       design's five chips were widened to seven. */
    const counted = SWAP_PHASES.reduce(
      (total, phase) => total + filterSwaps(rows, phase).length,
      0,
    )
    expect(counted).toBe(rows.length)
  })

  it('narrows to one phase', () => {
    expect(filterSwaps(rows, 'paid').map((r) => r.id)).toEqual(['b'])
    expect(filterSwaps(rows, 'waiting').map((r) => r.id)).toEqual(['a'])
    expect(filterSwaps(rows, 'disputed').map((r) => r.id)).toEqual(['d'])
  })
})

describe('swapsToCsv carries design 17\'s columns', () => {
  it('writes both vocabularies: the phase for reading, the status for grepping', () => {
    const csv = swapsToCsv([
      swapRow({ status: 'locked', acceptor_name: 'Arjun S', amount_paise: 4900 }),
    ])
    const [header, line] = csv.trim().split('\n')
    expect(header.split(',')).toEqual([
      'id',
      'requester_last4',
      'train_no',
      'journey_date',
      'phase',
      'acceptor_name',
      'amount_paise',
      'status',
      'updated_at',
    ])
    expect(line).toContain('paid')
    expect(line).toContain('locked')
    expect(line).toContain('Arjun S')
    expect(line).toContain('4900')
  })

  it('leaves the acceptor blank rather than writing the word null', () => {
    expect(swapsToCsv([swapRow({ acceptor_name: null })])).not.toContain('null')
  })
})

describe('collectedPaise (design 17 Amount, rule 1)', () => {
  const paid = (amount: number, credit: number, status: PaymentRow['status'] = 'paid'): PaymentRow => ({
    id: 'pay_1',
    request_id: 'req_1',
    payer_id: null,
    provider: 'razorpay',
    provider_ref: null,
    amount_paise: amount,
    credit_used_paise: credit,
    currency: 'INR',
    status,
    receipt_number: 'SS-00001',
    created_at: '2026-11-12T10:00:00.000Z',
    updated_at: '2026-11-12T10:00:00.000Z',
  })

  it('counts the cash, not the list price', () => {
    /* Design 17 prints ₹49 on a swap part-paid with credit and ₹99 on the ones
       paid in full. This is that rule, and it is the same one `moneyInTodayPaise`
       uses — a tile and a table on one console must not disagree. */
    expect(collectedPaise(paid(PRICE_PAISE, 0))).toBe(PRICE_PAISE)
    expect(collectedPaise(paid(PRICE_PAISE, THANK_YOU_PAISE))).toBe(PRICE_PAISE - THANK_YOU_PAISE)
  })

  it('is zero until the money is actually in', () => {
    expect(collectedPaise(undefined)).toBe(0)
    expect(collectedPaise(paid(PRICE_PAISE, 0, 'pending'))).toBe(0)
    expect(collectedPaise(paid(PRICE_PAISE, 0, 'created'))).toBe(0)
    expect(collectedPaise(paid(PRICE_PAISE, 0, 'failed'))).toBe(0)
  })

  it('never goes negative, even if credit somehow exceeded the price', () => {
    expect(collectedPaise(paid(PRICE_PAISE, PRICE_PAISE + 1000))).toBe(0)
  })
})

describe('acceptorName (design 17 Acceptor, rule 13)', () => {
  it('is null before anyone accepts — the design prints an em dash', () => {
    expect(acceptorName(swapRequest(), [swapOffer({ status: 'sent' })])).toBeNull()
    expect(acceptorName(swapRequest(), [])).toBeNull()
  })

  it('finds the offer awaiting payment', () => {
    const accepted = swapOffer({ status: 'accepted' })
    expect(acceptorName(swapRequest({ status: 'accepted_awaiting_payment' }), [accepted])).toBe(
      'Arjun S',
    )
  })

  it('follows locked_offer_id once payment has locked the swap', () => {
    /* `lockRequest` supersedes every other offer but deliberately leaves the
       locked one `accepted`, so the name survives into Paid and Done. It is
       `locked_offer_id` that says WHICH acceptor, and it has to win even when
       another offer is still sitting there accepted. */
    const stale = swapOffer({ id: 'off_1', acceptor_name: 'Arjun S', status: 'accepted' })
    const locked = swapOffer({ id: 'off_2', acceptor_name: 'Sneha R', status: 'accepted' })
    const request = swapRequest({ status: 'locked', locked_offer_id: 'off_2' })
    expect(acceptorName(request, [stale, locked])).toBe('Sneha R')
  })

  it('ignores offers belonging to another request', () => {
    const other = swapOffer({
      id: 'off_9',
      request_id: 'req_2',
      acceptor_name: 'Someone Else',
      status: 'accepted',
    })
    expect(acceptorName(swapRequest(), [other])).toBeNull()
  })
})

/** A live (unexpired) credit row, for the balance tiles. */function liveCredit(amountPaise: number, id = 'w_live') {
  return {
    id,
    amount_paise: amountPaise,
    expires_at: new Date(Date.now() + 86_400_000 * 300).toISOString(),
  }
}

/** buildOverview over the local store's own rows (design 23). */
function overview(overrides: Partial<AdminOverviewInput> = {}, nowMs = Date.now()) {
  return buildOverview(
    {
      activity: activityLog(),
      wallet: [],
      payments: getSnapshot().payments,
      requests: [],
      trips: [],
      ...overrides,
    },
    nowMs,
  )
}

describe('buildOverview', () => {
  beforeEach(() => resetStore())

  it('counts only today and ranks the busiest trains', () => {
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('pnr_added', { train_no: '12219' })
    logActivity('request_sent', { train_no: '12951' })

    /* logActivity stamps real wall-clock time, so "today" is the real today. */
    const stats = overview({ wallet: [liveCredit(5000)] })
    expect(stats.pnrsToday).toBe(3)
    expect(stats.requestsToday).toBe(1)
    expect(stats.creditInCirculationPaise).toBe(5000)
    /* A PNR is not a swap: nothing has been swapped, so no train is "busiest". */
    expect(stats.busiestTrains).toEqual([])
  })

  /* The panel is headed "Swaps done" (design 23) but counted every row that
     carried a `train_no` — and `pnr_added` and the chart toggle both do. */
  it('ranks trains by confirmed swaps, not by any activity on the train', () => {
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('swap_confirmed', {}, { type: 'swap_request', id: 'req_b' })

    const stats = overview({
      requests: [{ id: 'req_b', trip_id: 'trip_b' }],
      trips: [{ id: 'trip_b', train_no: '12219', train_name: 'Rajdhani' }],
    })

    expect(stats.busiestTrains).toEqual([{ train_no: '12219', train_name: 'Rajdhani', swaps: 1 }])
  })

  /* `confirmation` is written once PER SIDE and re-answering logs again, so
     counting it made "Swaps done" larger than the number of swaps. */
  it('counts one swap per confirmed swap, not one per side that answered', () => {
    logActivity('confirmation', { side: 'requester', outcome: 'swapped' })
    logActivity('confirmation', { side: 'acceptor', outcome: 'swapped' })
    logActivity('confirmation', { side: 'requester', outcome: 'swapped' })
    expect(overview().swapsDoneToday).toBe(0)

    logActivity('swap_confirmed', {}, { type: 'swap_request', id: 'req_1' })
    expect(overview().swapsDoneToday).toBe(1)
  })

  it('counts an accepted offer from either acceptance path', () => {
    /* `acceptOffer` (offer flow) and `respondToIncoming` (incoming board) are
       different state machines that log the same action. */
    logActivity('offer_accepted', { rank: 1 }, { type: 'swap_request', id: 'req_1' })
    logActivity('offer_accepted', { side: 'acceptor', trip: 'trip_1' }, { type: 'booking', id: 'trip_1' })
    expect(overview().acceptedToday).toBe(2)
  })

  it('excludes rows from a previous day', () => {
    const yesterday = new Date(Date.now() - 2 * DAY).toISOString()
    const stats = overview({ activity: [{ ...logActivity('pnr_added'), created_at: yesterday }] })
    expect(stats.pnrsToday).toBe(0)
  })
})

/* "Money in" is the money the gateway actually captured. `amount_paise` on a
   payment is the GROSS price, and credit can cover part of it (rule 4), so
   summing the gross would count credit as revenue. */
describe('buildOverview money in (rule 1)', () => {
  beforeEach(() => resetStore())

  it('counts the full price when no credit was used', () => {
    const row = startPayment({
      request_id: 'req_1',
      provider: 'razorpay',
      amount_paise: PRICE_PAISE,
      credit_used_paise: 0,
    })
    setPaymentStatus(row.id, 'paid')
    expect(overview().moneyInTodayPaise).toBe(PRICE_PAISE)
  })

  it('subtracts the credit that was spent, and logs it on the row', () => {
    const row = startPayment({
      request_id: 'req_1',
      provider: 'razorpay',
      amount_paise: PRICE_PAISE,
      credit_used_paise: 5000,
    })
    setPaymentStatus(row.id, 'paid')

    const paid = activityLog().find((entry) => entry.action === 'payment_paid')
    expect(paid?.meta).toMatchObject({ amount_paise: 9900, credit_used_paise: 5000 })
    expect(overview().moneyInTodayPaise).toBe(4900)
  })

  it('counts a credit-only payment as no money in', () => {
    const row = startPayment({
      request_id: 'req_1',
      provider: 'credit',
      amount_paise: PRICE_PAISE,
      credit_used_paise: PRICE_PAISE,
      status: 'paid',
    })
    expect(getSnapshot().payments.some((p) => p.id === row.id)).toBe(true)
    expect(overview().moneyInTodayPaise).toBe(0)
    expect(overview().paidToday).toBe(0)
  })

  /* Never assume an unreadable row collected the full price. */
  it('leaves an unknown credit portion out and counts it, rather than guessing', () => {
    logActivity('payment_paid', { amount_paise: 9900 }, { type: 'payment', id: 'pay_pruned' })
    const stats = overview({ payments: [] })
    expect(stats.moneyInTodayPaise).toBe(0)
    expect(stats.moneyInUnknownToday).toBe(1)
  })
})

describe('buildOverview credit given (rule 4)', () => {
  beforeEach(() => resetStore())

  it('counts credit issued today, not the balance still outstanding', () => {
    logActivity('credit_added', { to: 'u_acc', amount_paise: 5000, kind: 'acceptor_credit' })
    logActivity('credit_added', { to: 'u_req', amount_paise: 9900, kind: 'swap_to_credit' })
    logActivity('credit_used', { amount_paise: 4900 })

    const stats = overview({ wallet: [liveCredit(10000)] })
    expect(stats.creditGivenTodayPaise).toBe(14900)
    expect(stats.creditInCirculationPaise).toBe(10000)
  })

  /* Design 18's "Moved to credit" tile, which the board recorded as needing a
     definition because rule 6's ₹99 and the acceptor's ₹50 are both
     `credit_added` rows. They are — but the ledger already separates them by
     `kind`, so the tile is a narrower filter, not a new decision. */
  it('counts only the rule-6 kind as moved to credit', () => {
    logActivity('credit_added', { to: 'u_acc', amount_paise: 5000, kind: 'acceptor_credit' })
    logActivity('credit_added', { to: 'u_req', amount_paise: 9900, kind: 'swap_to_credit' })
    logActivity('credit_added', { to: 'u_req2', amount_paise: 9900, kind: 'swap_to_credit' })

    const stats = overview()
    expect(stats.movedToCreditTodayPaise).toBe(19800)
    /* The ₹50 thank-yous are NOT money moved — rule 3 is an earn. */
    expect(stats.creditGivenTodayPaise).toBe(24800)
  })

  /* The property that makes the two tiles coherent side by side: design 18 draws
     "Credit given ₹1,250" and "Moved to credit ₹297", which only reads correctly
     if given CONTAINS moved. They are summed by one function with one predicate,
     so this holds by construction — a second independent sum is exactly how it
     would stop holding. */
  it('keeps moved-to-credit a strict subset of credit given', () => {
    logActivity('credit_added', { to: 'u_acc', amount_paise: 5000, kind: 'acceptor_credit' })
    logActivity('credit_added', { to: 'u_req', amount_paise: 9900, kind: 'swap_to_credit' })

    const stats = overview()
    /* `<=` alone is too weak — it also holds when the filter is missing
       entirely and both tiles are the same number. The difference is what
       proves the narrow filter: it is exactly the thank-you credit. */
    expect(stats.movedToCreditTodayPaise).toBeLessThanOrEqual(stats.creditGivenTodayPaise)
    expect(stats.creditGivenTodayPaise - stats.movedToCreditTodayPaise).toBe(THANK_YOU_PAISE)

    /* And the other direction: an all-thank-you day moves nothing, so a tile
       reading ₹0 there is the truth rather than a missing filter. */
    resetStore()
    logActivity('credit_added', { to: 'u_acc', amount_paise: 5000, kind: 'acceptor_credit' })
    const onlyEarns = overview()
    expect(onlyEarns.movedToCreditTodayPaise).toBe(0)
    expect(onlyEarns.creditGivenTodayPaise).toBe(5000)
  })

  /* Design 18's fourth tile. `useCredit` stores `-amount` in the wallet but logs
     the positive magnitude, so the tile sums the log as-is. */
  it('counts credit spent today as a positive number', () => {
    logActivity('credit_used', { amount_paise: 4900 })
    logActivity('credit_used', { amount_paise: 1100 })

    const stats = overview()
    expect(stats.creditUsedTodayPaise).toBe(6000)
  })

  it('is zero, not negative, when no credit moved', () => {
    const stats = overview()
    expect(stats.movedToCreditTodayPaise).toBe(0)
    expect(stats.creditUsedTodayPaise).toBe(0)
  })

  /* The defect this pins: "Credit in circulation" is documented as credit still
     unspent AND UNEXPIRED, but the caller passed a bare sum of every row, so
     expired credit was reported as still circulating. */
  it('leaves expired credit out of circulation', () => {
    const expired = {
      id: 'w_old',
      amount_paise: 9900,
      expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    }
    const stats = overview({ wallet: [expired, liveCredit(5000)] })
    expect(stats.creditInCirculationPaise).toBe(5000)
  })
})

describe('filterActivity', () => {
  beforeEach(() => resetStore())

  it('filters by action and matches the query across fields', () => {
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('request_sent', { train_no: '12951' })

    expect(filterActivity(activityLog(), { action: 'pnr_added', category: 'all', query: '' })).toHaveLength(1)
    expect(filterActivity(activityLog(), { action: null, category: 'all', query: '12951' })).toHaveLength(2)
    expect(filterActivity(activityLog(), { action: null, category: 'all', query: 'nomatch' })).toHaveLength(0)
  })

  it('lists distinct actions for the dropdown', () => {
    logActivity('pnr_added', {})
    logActivity('request_sent', {})
    expect(activityActions(activityLog())).toEqual(['pnr_added', 'request_sent'])
  })
})

/* Design 15's chips. `all` matches every category; a category matches only its
   own actions; and the two filters compose. */
describe('filterActivity by category (design 15)', () => {
  beforeEach(() => resetStore())

  function seed() {
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('request_sent', {})
    logActivity('payment_paid', { amount_paise: 9900, credit_used_paise: 0 })
    logActivity('swap_confirmed', {}, { type: 'swap_request', id: 'req_1' })
    logActivity('report_filed', { reason: 'cash' })
    logActivity('sign_in', { method: 'google' })
    logActivity('settings_changed', {})
  }

  it('buckets actions the way the chips say', () => {
    expect(activityCategory('pnr_added')).toBe('trips')
    expect(activityCategory('offer_accepted')).toBe('requests')
    expect(activityCategory('payment_paid')).toBe('payments')
    expect(activityCategory('swap_confirmed')).toBe('swaps')
    expect(activityCategory('report_filed')).toBe('reports')
    expect(activityCategory('sign_in')).toBe('signins')
    expect(activityCategory('settings_changed')).toBe('account')
  })

  it('narrows to one category and keeps `all` whole', () => {
    seed()
    const rows = activityLog()
    const pick = (category: Parameters<typeof filterActivity>[1]['category']) =>
      filterActivity(rows, { action: null, category, query: '' })

    expect(pick('all')).toHaveLength(7)
    expect(pick('trips').map((row) => row.action)).toEqual(['pnr_added'])
    expect(pick('payments').map((row) => row.action)).toEqual(['payment_paid'])
    expect(pick('swaps').map((row) => row.action)).toEqual(['swap_confirmed'])
  })

  it('composes the category with the action and the query', () => {
    seed()
    const rows = activityLog()
    expect(filterActivity(rows, { action: 'pnr_added', category: 'trips', query: '' })).toHaveLength(1)
    /* Right action, wrong category — the contradiction the screen prevents. */
    expect(filterActivity(rows, { action: 'pnr_added', category: 'payments', query: '' })).toHaveLength(0)
    expect(filterActivity(rows, { action: null, category: 'trips', query: '12951' })).toHaveLength(1)
  })

  it('offers `other` only when something is in it', () => {
    logActivity('pnr_added', {})
    expect(uncategorisedActions(activityLog())).toEqual([])
    logActivity('brand_new_thing', {})
    expect(uncategorisedActions(activityLog())).toEqual(['brand_new_thing'])
    /* An unmapped action is still visible under `all` — never hidden. */
    expect(filterActivity(activityLog(), { action: null, category: 'all', query: '' })).toHaveLength(2)
  })

  /* The trap: docs/08's action list omits swap_confirmed, acceptor_backed_out,
     someone_faster, meet_answered, group_*, trip_removed and the welcome and
     settings actions. A category map derived from that list would drop those
     rows out of every chip while still looking complete. So build the map from
     what the code logs, and prove it here by reading the code. */
  describe('every action the code logs is claimed by a chip', () => {
    /** Every action name passed to logActivity anywhere under src/. */
    function loggedActions(): string[] {
      const files: string[] = []
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) walk(full)
          else if (/\.tsx?$/.test(full)) files.push(full)
        }
      }
      walk(join(import.meta.dirname, '..', 'src'))

      const found = new Set<string>()
      for (const file of files) {
        const text = readFileSync(file, 'utf8')
        let index = text.indexOf('logActivity(')
        while (index !== -1) {
          /* Only the FIRST argument: later arguments carry `'payment'`,
             `'admin'`, `'swap_request'` etc. as entity types, which are not
             actions and must not be mistaken for them. */
          const open = index + 'logActivity'.length
          let depth = 0
          let end = open
          for (let cursor = open; cursor < text.length; cursor++) {
            const char = text[cursor]
            if (char === '(' || char === '{' || char === '[') depth++
            else if (char === ')' || char === '}' || char === ']') {
              depth--
              if (depth === 0) { end = cursor; break }
            } else if (char === ',' && depth === 1) { end = cursor; break }
          }
          const args = text.slice(open, end)
          for (const match of args.matchAll(/'([a-z][a-z_0-9]*)'/g)) {
            /* A literal on the RIGHT of a comparison is a value being tested,
               not the action being logged: `status === 'paid' ? 'payment_paid'
               : …` must yield `payment_paid` and not `paid`. Without this the
               guard reports `paid`/`failed`/`confirmed`/`voided` as unmapped
               actions and the temptation is to add them to the category map —
               which would be mapping values as if they were events. */
            const before = args.slice(0, match.index).trimEnd()
            if (/(?:===|!==|==|!=)$/.test(before)) continue
            found.add(match[1])
          }
          index = text.indexOf('logActivity(', end)
        }
      }
      return [...found].sort()
    }

    /* Without this the guard below passes vacuously if the scanner finds
       nothing — which is the whole failure it exists to catch. */
    it('actually finds the logActivity call sites', () => {
      const actions = loggedActions()
      expect(actions.length).toBeGreaterThan(30)
      expect(actions).toContain('pnr_added')
      expect(actions).toContain('swap_confirmed')
      expect(actions).toContain('acceptor_backed_out')
      /* Entity types must not leak in as actions. */
      expect(actions).not.toContain('swap_request')
      expect(actions).not.toContain('admin')
    })

    it('leaves nothing in `other`', () => {
      const orphans = loggedActions().filter((action) => activityCategory(action) === 'other')
      expect(orphans).toEqual([])
    })

    it('has an `admin.act.*` label in both languages for every logged action', () => {
      /* `activityLabelKey` is `admin.act.${action}` with a null fallback, so a
         logged action with no label renders as a raw dotted path in the audit
         table — the screen whose whole job is to be readable. `credit_expired`
         did exactly this: the nightly expiry job logs it every night and
         nothing checked, because this guard did not exist (the report-issue
         equivalent above guards a different catalogue).

         The failure is invisible in review — the key looks fine, the fallback
         looks harmless — and only shows up in a capture, which is how it was
         found. Asserting it here means the next action added to either logging
         entry point cannot repeat that.

         `en.admin.act` is keyed by the BARE action name; the `admin.act.` prefix
         is what `activityLabelKey` adds at the call site. Indexing the catalogue
         with the prefixed key finds nothing and reports every action as missing,
         which is how this guard's first draft failed. */
      /* BOTH entry points, not just `logActivity`. `server/jobs.ts` writes
         through `logEffect(client, action, entity, entityId)`, whose SECOND
         argument is the action and whose THIRD is the entity type. Scanning
         only `logActivity` passed while `credit_expired` had no label at all —
         a green guard that never saw the action.

         Every call site of that function is one line and the first argument is
         always a bare identifier, so a single anchored regex is both sufficient
         and easier to verify than a hand-rolled balanced-paren scanner. (Three
         drafts of the scanner were wrong in ways that all reported success: the
         function DEFINITION matched first; the argument scan stopped at the
         `client` argument; and `indexOf(',') + 1` is `slice(0)` when the
         comma is missing, returning the whole string instead of nothing. The
         self-check below is what caught those — without it all three were
         indistinguishable from a working guard.) */
      const viaLogEffect = new Set<string>()
      const callSite = /logEffect\(\s*[A-Za-z_][\w.]*\s*,\s*'([a-z][a-z_0-9]*)'/g
      const walk = (d: string): void => {
        for (const entry of readdirSync(d)) {
          const full = join(d, entry)
          if (statSync(full).isDirectory()) walk(full)
          else if (/\.tsx?$/.test(full)) {
            for (const m of readFileSync(full, 'utf8').matchAll(callSite)) {
              viaLogEffect.add(m[1])
            }
          }
        }
      }
      walk(join(import.meta.dirname, '..', 'src'))
      expect(viaLogEffect.size, 'scanner found no logEffect call sites').toBeGreaterThan(0)
      expect([...viaLogEffect]).toContain('credit_expired')

      const missing: string[] = []
      for (const action of [...loggedActions(), ...viaLogEffect]) {
        const key = action as keyof typeof en.admin.act
        if (!en.admin.act[key] || !hi.admin.act[key]) missing.push(action)
      }
      expect(missing).toEqual([])
    })

    it('offers the design-15 chips, plus the two the log needs', () => {
      /* Sign-ins, Requests, Payments, Swaps and Reports are the design's;
         Trips and Account are added because the log really writes those
         actions — design 15's own table shows "Added PNR". */
      expect(ACTIVITY_CATEGORIES).toEqual([
        'trips',
        'requests',
        'payments',
        'swaps',
        'reports',
        'signins',
        'account',
      ])
    })

    /* Design 15 shows "Added PNR", not `pnr_added`. The label key is derived
       from the action name, so the only way to get this wrong is to add an
       action and forget its copy — which is what this catches. */
    it('has a human label for every action, in both languages', () => {
      const missing: string[] = []
      for (const action of loggedActions()) {
        const key = activityLabelKey(action)
        for (const lang of SHIPPED_LANGS) {
          if (!lookupLabel(CATALOGS[lang], key)) missing.push(`${lang}:${key}`)
        }
      }
      expect(missing).toEqual([])
    })

    it('keeps every label short enough to read in a row', () => {
      /* These are row headings, not sentences (design 15: "Paid ₹99",
         "Sent request"). A label that grew into a sentence would wrap the
         list; catch it here rather than on the screen. */
      const tooLong: string[] = []
      for (const action of loggedActions()) {
        for (const lang of SHIPPED_LANGS) {
          const label = lookupLabel(CATALOGS[lang], activityLabelKey(action))
          if (label && label.length > 28) tooLong.push(`${lang}:${action} = ${label}`)
        }
      }
      expect(tooLong).toEqual([])
    })
  })
})

describe('scheduled job date cores (docs/08)', () => {
  it('expired once now has passed the journey end', () => {
    // journey end already behind us -> expired
    expect(isRequestExpired(T0, T0 - 1000)).toBe(true)
    // journey end still ahead -> not expired
    expect(isRequestExpired(T0, T0 + 1000)).toBe(false)
  })

  it('auto-confirms after 12 quiet hours, but only if a side is silent', () => {
    expect(shouldAutoConfirm(T0 + 12 * 60 * 60 * 1000, T0, 0)).toBe(true)
    expect(shouldAutoConfirm(T0 + 11 * 60 * 60 * 1000, T0, 0)).toBe(false)
    expect(shouldAutoConfirm(T0 + 48 * 60 * 60 * 1000, T0, 2)).toBe(false)
  })

  it('expires credit 12 months after it was earned (rule 4)', () => {
    const earned = Date.parse('2026-01-10T00:00:00.000Z')
    expect(isCreditExpired(earned + 11 * 30 * DAY, earned)).toBe(false)
    expect(isCreditExpired(earned + 13 * 30 * DAY, earned)).toBe(true)
  })

  it('reminds 30 days before expiry, never after', () => {
    const expires = T0 + 10 * DAY
    expect(needsCreditReminder(T0, expires)).toBe(true)
    expect(needsCreditReminder(T0, T0 + 90 * DAY)).toBe(false)
    expect(needsCreditReminder(T0, T0 - DAY)).toBe(false)
  })

  it('notifies on the chart-time false -> true edge only', () => {
    expect(shouldNotifyChartTime(false, true)).toBe(true)
    expect(shouldNotifyChartTime(true, true)).toBe(false)
    expect(shouldNotifyChartTime(false, false)).toBe(false)
  })
})

describe('admin money is paise (rule 1)', () => {
  it('never floats and never rounds', () => {
    for (const value of [PRICE_PAISE, FEE_PAISE, THANK_YOU_PAISE, GROUP_PRICE_PAISE]) {
      expect(Number.isInteger(value)).toBe(true)
    }
    expect(PRICE_PAISE).toBe(FEE_PAISE + THANK_YOU_PAISE)
  })
})

describe('server admin planners move money and state, then log (docs/04-D)', () => {
  it('moves a dead paid swap to ₹99 requester credit (rule 6)', async () => {
    const { planAdminAction } = await import('@/server/admin')
    const plan = planAdminAction('credit_added', 'req_1', { payerId: 'u_pay', reason: 'no show' })
    expect(plan.updates).toContainEqual({ table: 'swap_requests', id: 'req_1', patch: { status: 'voided' } })
    expect(plan.inserts).toContainEqual({
      table: 'wallet_tx',
      row: expect.objectContaining({ user_id: 'u_pay', amount_paise: 9900, kind: 'swap_to_credit', ref_request_id: 'req_1' }),
    })
    expect(plan.activityAction).toBe('credit_added')
  })

  it('confirms a swap and awards the acceptor ₹50 (rule 3)', async () => {
    const { planAdminAction } = await import('@/server/admin')
    const plan = planAdminAction('confirmation', 'req_2', { acceptorId: 'u_acc' })
    expect(plan.updates).toContainEqual({ table: 'swap_requests', id: 'req_2', patch: { status: 'confirmed' } })
    expect(plan.inserts).toContainEqual({
      table: 'wallet_tx',
      row: expect.objectContaining({ user_id: 'u_acc', amount_paise: 5000, kind: 'acceptor_credit' }),
    })
  })

  it('resolves a dispute to voided with credit, or confirmed with award', async () => {
    const { planAdminAction } = await import('@/server/admin')
    const voided = planAdminAction('dispute_resolved', 'dsp_1', { requestId: 'req_3', payerId: 'u_pay', resolution: 'voided', reason: 'no show' })
    expect(voided.updates).toContainEqual({ table: 'swap_requests', id: 'req_3', patch: { status: 'voided' } })
    expect(voided.inserts.some((i) => i.table === 'wallet_tx' && (i.row as { amount_paise: number }).amount_paise === 9900)).toBe(true)
    const done = planAdminAction('dispute_resolved', 'dsp_2', { requestId: 'req_4', acceptorId: 'u_acc', resolution: 'confirmed' })
    expect(done.updates).toContainEqual({ table: 'swap_requests', id: 'req_4', patch: { status: 'confirmed' } })
    expect(done.inserts.some((i) => i.table === 'wallet_tx' && (i.row as { amount_paise: number }).amount_paise === 5000)).toBe(true)
  })

  it('blocks by pausing and rejects adjust without a valid amount', async () => {
    const { planAdminAction } = await import('@/server/admin')
    const blocked = planAdminAction('user_blocked', 'u_bad', { reason: 'spam' })
    expect(blocked.updates).toContainEqual({ table: 'settings', id: 'u_bad', key: 'user_id', patch: { paused: true } })
    expect(() => planAdminAction('admin_adjust', 'u_x', { amountPaise: 0 })).toThrow('adjust_amount_invalid')
    const adjust = planAdminAction('admin_adjust', 'u_x', { amountPaise: -500, reason: 'correction' })
    expect(adjust.inserts[0].row).toMatchObject({ user_id: 'u_x', amount_paise: -500, kind: 'admin_adjust' })
    /* Rule 4: even staff-granted credit expires 12 months out — never null. */
    const grant = planAdminAction('admin_adjust', 'u_x', { amountPaise: 5000, reason: 'goodwill' })
    const exp = Date.parse((grant.inserts[0].row as { expires_at: string }).expires_at)
    const year = 365 * 24 * 3600 * 1000
    expect(exp).toBeGreaterThan(Date.now() + year - 30 * 24 * 3600 * 1000)
    expect(exp).toBeLessThan(Date.now() + year + 40 * 24 * 3600 * 1000)
  })
})

describe('console actions fall back to the device log without a backend', () => {
  it('runs every action through runAdminAction and audits the tap', async () => {
    const { runAdminAction } = await import('@/lib/admin')
    const { activityLog, resetStore } = await import('@/lib/store')
    resetStore()
    for (const action of ['block_user', 'move_to_credit', 'mark_done', 'resolve_dispute', 'adjust_credit', 'close_report'] as const) {
      const result = await runAdminAction(action, {
        target: 'local-device',
        reason: 'test',
        amountPaise: 500,
        resolution: 'voided',
        requestId: 'req-test',
      })
      expect(result).toEqual({ outcome: 'device', persisted: false, demo: true })
    }
    const logged = activityLog().filter((row) => row.action === 'admin_action')
    expect(logged).toHaveLength(6)
  })

  it('records exactly one admin_action event per tap, never two', async () => {
    const { runAdminAction } = await import('@/lib/admin')
    const { readEvents, resetAnalyticsForTests } = await import('@/lib/analytics')
    resetAnalyticsForTests()
    await runAdminAction('block_user', { target: 'local-device', reason: 'test' })
    expect(readEvents().filter((event) => event.event === 'admin_action')).toHaveLength(1)
  })

  /* The bug this pins: a configured backend that REFUSED an action was
     reported as a demo, so the console said the server would "apply it when
     connected" (nothing replays a device log) and wrote an admin_action row
     for a block or a credit move that never happened. */
  it('keeps "the server did it", "logged here" and "it failed" apart', async () => {
    const { adminNoticeKey } = await import('@/lib/admin')
    expect(adminNoticeKey({ outcome: 'applied', persisted: true, demo: false }, 'admin.blocked')).toBe('admin.blocked')
    expect(adminNoticeKey({ outcome: 'device', persisted: false, demo: true }, 'admin.blocked')).toBe('admin.actedDemo')
    expect(adminNoticeKey({ outcome: 'failed', persisted: false, demo: false }, 'admin.blocked')).toBe('admin.actedFailed')
  })
})

describe('buildOverview counts the local day, not the UTC day', () => {
  function rowAt(when: Date) {
    return { ...logActivity('pnr_added', { train_no: '12951' }), created_at: when.toISOString() }
  }

  it('starts the day at local midnight', () => {
    /* Built from local wall-clock, so this asserts the same thing in any zone
       — but it only *catches* the old UTC comparison at a nonzero offset,
       which is where the launch market (IST, +5:30) lives. */
    const justAfter = new Date()
    justAfter.setHours(0, 1, 0, 0)
    const justBefore = new Date(justAfter.getTime() - 5 * 60 * 1000)

    const nowMs = justAfter.getTime()
    expect(overview({ activity: [rowAt(justAfter)] }, nowMs).pnrsToday).toBe(1)
    expect(overview({ activity: [rowAt(justBefore)] }, nowMs).pnrsToday).toBe(0)
  })
})

/* Design 23's "Swaps this week". The chart and the "Swaps done" tile sit on
   the same screen, so most of this is about them not disagreeing. */
describe('swapsThisWeek (design 23)', () => {
  /* Built from local wall-clock, so the intended local day is the same in any
     timezone the suite runs in. 2026-11-12 is a Thursday, 2026-11-30 a Monday
     — both asserted below rather than trusted. */
  const NOW = new Date(2026, 10, 12, 10, 0, 0).getTime()

  function at(iso: string): Date {
    return new Date(`${iso}T12:00:00`)
  }
  function confirmed(when: Date) {
    return { ...logActivity('swap_confirmed', {}), created_at: when.toISOString() }
  }
  /** The days that have actually happened, oldest first. */
  function elapsed(week: ReturnType<typeof swapsThisWeek>) {
    return week.filter((point): point is { day: string; swaps: number } => point.swaps !== null)
  }

  it('always returns one Monday-to-Sunday week of seven contiguous days', () => {
    const week = swapsThisWeek([], NOW)
    expect(week).toHaveLength(7)
    for (const point of week) expect(point.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${week[0].day}T00:00:00`).getDay()).toBe(1) // Monday
    expect(new Date(`${week[6].day}T00:00:00`).getDay()).toBe(0) // Sunday
    for (let index = 1; index < week.length; index += 1) {
      const previous = new Date(`${week[index - 1].day}T00:00:00`).getTime()
      const current = new Date(`${week[index].day}T00:00:00`).getTime()
      expect(current - previous).toBe(DAY)
    }
    expect(week[0].day).toBe('2026-11-09')
  })

  it('zero-fills a day that happened with no swaps, but leaves future days null', () => {
    const week = swapsThisWeek(
      [confirmed(at('2026-11-09')), confirmed(at('2026-11-11')), confirmed(at('2026-11-12'))],
      NOW,
    )
    expect(week.map((point) => point.day)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ])
    /* Tue 10th happened and had none (0); Fri–Sun have not happened (null). */
    expect(week.map((point) => point.swaps)).toEqual([1, 0, 1, 1, null, null, null])
  })

  it('ends on today, and its last point equals the Swaps done tile', () => {
    const activity = [
      confirmed(at('2026-11-10')),
      confirmed(at('2026-11-12')),
      confirmed(at('2026-11-12')),
    ]
    const stats = overview({ activity }, NOW)
    const last = elapsed(stats.swapsThisWeek).at(-1)
    expect(last?.day).toBe('2026-11-12')
    expect(last?.swaps).toBe(2)
    /* The whole point: one screen must not show two answers for the same day. */
    expect(last?.swaps).toBe(stats.swapsDoneToday)
  })

  it('counts confirmed swaps, not confirmations and not PNRs', () => {
    const when = at('2026-11-12').toISOString()
    const activity = [
      { ...logActivity('confirmation', {}), created_at: when },
      { ...logActivity('pnr_added', { train_no: '12951' }), created_at: when },
      { ...logActivity('payment_paid', {}), created_at: when },
    ]
    expect(elapsed(swapsThisWeek(activity, NOW)).at(-1)?.swaps).toBe(0)
  })

  it('starts each column at local midnight, the same boundary the tiles use', () => {
    const justAfter = new Date(2026, 10, 12, 0, 1, 0, 0)
    const justBefore = new Date(justAfter.getTime() - 5 * 60 * 1000)
    const week = elapsed(swapsThisWeek([confirmed(justAfter), confirmed(justBefore)], NOW))
    expect(week.at(-1)?.swaps).toBe(1) // 00:01 today
    expect(week.at(-2)?.swaps).toBe(1) // 23:56 yesterday
  })

  it('crosses a month boundary without skipping or repeating a day', () => {
    const week = swapsThisWeek([], new Date(2026, 10, 30, 10, 0, 0).getTime())
    expect(week.map((point) => point.day)).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ])
  })

  it('ignores swaps outside the week, including ones later the same month', () => {
    const activity = [confirmed(at('2026-11-08')), confirmed(at('2026-11-20'))]
    const week = swapsThisWeek(activity, NOW)
    expect(week.every((point) => point.swaps === null || point.swaps === 0)).toBe(true)
  })
})

/* Design 23's "First on their train today" (docs/01 line 38, docs/12 line 78).
   The metric exists to answer "how often do we hit the zero-match dead end", so
   what it EXCLUDES matters as much as what it counts. */
describe('firstOnTrainToday (design 23)', () => {
  const NOW = new Date(2026, 10, 12, 10, 0, 0).getTime()

  function viewed(matches: number, capped = false, when = NOW) {
    return {
      ...logActivity('matches_viewed', { matches, capped }),
      created_at: new Date(when).toISOString(),
    }
  }

  it('reports null, not 0%, when nobody searched', () => {
    const stats = firstOnTrainToday([])
    expect(stats.searched).toBe(0)
    expect(stats.percent).toBeNull()
    /* 0 would assert "everyone who looked found someone". Nobody looked. */
    expect(stats.percent).not.toBe(0)
  })

  it('reports a real 0% when every search found someone', () => {
    const stats = firstOnTrainToday([viewed(3), viewed(1)])
    expect(stats.searched).toBe(2)
    expect(stats.first).toBe(0)
    expect(stats.percent).toBe(0)
  })

  it('excludes capped searches, which did not fail to find anyone', () => {
    /* A capped user's pool may be full of people — the matches screen already
       refuses to show them the "you're the first" card. Counting them here
       would resurrect the lie the card avoids. */
    const stats = firstOnTrainToday([viewed(0, true), viewed(4)])
    expect(stats.searched).toBe(1)
    expect(stats.first).toBe(0)
    expect(stats.percent).toBe(0)
    /* Without the exclusion this reads 1/2 = 50%. */
  })

  it('counts a zero-match search as first on their train', () => {
    const stats = firstOnTrainToday([viewed(0), viewed(0), viewed(2), viewed(5)])
    expect(stats.searched).toBe(4)
    expect(stats.first).toBe(2)
    expect(stats.percent).toBe(50)
  })

  it('rounds to a whole percent', () => {
    expect(firstOnTrainToday([viewed(0), viewed(1), viewed(2)]).percent).toBe(33)
    expect(firstOnTrainToday([viewed(0), viewed(0), viewed(1)]).percent).toBe(67)
  })

  it('ignores every other action, including the cap', () => {
    const when = new Date(NOW).toISOString()
    const rows = [
      { ...logActivity('request_sent', {}), created_at: when },
      { ...logActivity('request_capped', { limit: 10 }), created_at: when },
    ]
    expect(firstOnTrainToday(rows).searched).toBe(0)
  })

  it('leaves an unreadable count out of both sides and reports it', () => {
    const broken = {
      ...logActivity('matches_viewed', {}),
      created_at: new Date(NOW).toISOString(),
    }
    const stats = firstOnTrainToday([viewed(0), viewed(2), broken])
    expect(stats.unknown).toBe(1)
    expect(stats.searched).toBe(2)
    expect(stats.first).toBe(1)
    expect(stats.percent).toBe(50)
  })

  it('is scoped to today, like every other tile', () => {
    const yesterday = new Date(2026, 10, 11, 12, 0, 0).getTime()
    const stats = overview({ activity: [viewed(0), viewed(0, false, yesterday)] }, NOW)
    expect(stats.firstOnTrainToday.searched).toBe(1)
    expect(stats.firstOnTrainToday.first).toBe(1)
  })
})

/* The cap has to survive into the operator's log, or the exclusion above is
   invisible on the one row where it matters. */
describe('activityDetails shows the cap flag', () => {
  it('names the flag on a capped search', () => {
    expect(activityDetails(logActivity('matches_viewed', { matches: 0, capped: true }))).toBe(
      '0 · capped',
    )
  })

  it('stays quiet when the flag is false', () => {
    expect(activityDetails(logActivity('matches_viewed', { matches: 3, capped: false }))).toBe('3')
  })
})

/* Design 16's table is Name / Joined / Trips / Swaps / Credit / Status. */
describe('usersToCsv carries the design-16 columns', () => {
  const user: AdminUserRow = {
    id: 'u_1',
    first_name: 'Asha',
    last_initial: 'R',
    created_at: '2026-11-01',
    trips: 2,
    swaps: 1,
    credit_paise: 5000,
    blocked: false,
    reported: true,
  }

  it('exports trips, swaps and credit alongside the account state', () => {
    const csv = usersToCsv([user])
    expect(csv.split('\n')[0]).toBe(
      'id,first_name,last_initial,created_at,trips,swaps,credit_paise,blocked,reported',
    )
    expect(csv.split('\n')[1]).toBe('u_1,Asha,R,2026-11-01,2,1,5000,false,true')
  })

  it('keeps credit in whole paise, never rupees', () => {
    expect(usersToCsv([user])).toContain(',5000,')
    expect(usersToCsv([user])).not.toContain(',50,')
  })
})

/* Design 15's Details column. The risk here is not a wrong number, it is
   showing something that should not be shown: log meta is written by ~50 call
   sites and two of them carry caller-controlled values — `settings_changed`
   stores an arbitrary patch object, and `report_filed` / `admin_action` store
   free text. So the column reads an allow-list, never `meta`. */
describe('activityDetails reads an allow-list, never the whole meta (rule 13)', () => {
  function row(meta: Record<string, unknown>, action = 'pnr_added'): ActivityRow {
    return {
      id: 'act_1',
      actor_id: 'u_1',
      actor_role: 'user',
      action,
      entity: 'booking',
      entity_id: 'b_1',
      meta,
      created_at: '2026-11-12T10:00:00.000Z',
    }
  }

  it('summarises a PNR row with the tail masked and no full PNR', () => {
    const text = activityDetails(row({ train_no: '12951', class: '3A', last4: '9630', passengers: 2 }))
    expect(text).toBe('12951 · 3A · ····9630 · 2')
    expect(text).not.toMatch(/\b\d{10}\b/)
  })

  it('renders money as whole rupees from paise', () => {
    expect(activityDetails(row({ amount_paise: 9900, provider: 'razorpay' }, 'payment_paid'))).toBe(
      'razorpay · ₹99',
    )
    expect(activityDetails(row({ amount_paise: 9900, credit_used_paise: 5000 }, 'payment_paid'))).toBe(
      '₹99 · ₹50',
    )
  })

  /* The mask is the guard, not just a formatter: if a call site ever logged a
     full PNR under `last4`, only the last four characters may reach the row. */
  it('keeps only the last four characters of a masked tail', () => {
    const text = activityDetails(row({ last4: '1234567890' }))
    expect(text).toBe('····7890')
    expect(text).not.toContain('123456')
  })

  it('shows nothing it was not told to show', () => {
    const pii = {
      pnr: '1234567890',
      email: 'asha@example.com',
      phone: '+91 98765 43210',
      full_name: 'Asha Ramanathan',
      ticket_photo: 'https://example.com/t.jpg',
      /* A future setting lands in `settings_changed`'s patch verbatim. */
      anything_new: 'leaked',
    }
    const text = activityDetails(row(pii, 'settings_changed'))
    expect(text).toBe('')
    for (const value of Object.values(pii)) expect(text).not.toContain(value)
  })

  it('flattens free text to one line and cuts it short', () => {
    expect(activityDetails(row({ reason: 'line one\nline two   spaced' }, 'report_filed'))).toBe(
      'line one line two spaced',
    )
    expect(activityDetails(row({ reason: 'x'.repeat(200) }, 'report_filed')).length).toBe(40)
  })

  it('bounds the whole summary to one short line', () => {
    const text = activityDetails(
      row({
        train_no: '12951',
        class: '3A',
        last4: '9630',
        passengers: 2,
        provider: 'razorpay',
        kind: 'acceptor_credit',
        reason: 'y'.repeat(200),
      }),
    )
    expect(text.length).toBeLessThanOrEqual(60)
    expect(text.endsWith('…')).toBe(true)
  })
})

/* Design 15 gives the train its own column, which means the Details list has
   to stop carrying it — otherwise the same number is printed twice in one row
   and reads as two facts. */
describe('activityTrain, and the train leaving the Details list', () => {
  const row = (meta: Record<string, unknown>) => logActivity('pnr_added', meta)

  it('reads the train number for its own column', () => {
    expect(activityTrain(row({ train_no: '12951', passengers: 2 }))).toBe('12951')
  })

  it('is null when the row has no train, so the column renders empty', () => {
    expect(activityTrain(row({ passengers: 2 }))).toBeNull()
    expect(activityTrain(row({ train_no: '' }))).toBeNull()
  })

  it('bounds the value the same way the Details list does', () => {
    /* A `train_no` that is not a bounded string is null in both places rather
       than a number in one and a string in the other. */
    expect(activityTrain(row({ train_no: 12951 }))).toBe('12951')
    expect(activityTrain(row({ train_no: 'x'.repeat(60) }))).toHaveLength(24)
  })

  it('leaves the train in Details by default, and drops it on request', () => {
    const full = row({ train_no: '12951', class: '3A', passengers: 2 })
    expect(activityDetails(full)).toBe('12951 · 3A · 2')
    expect(activityDetails(full, { omit: ['train_no'] })).toBe('3A · 2')
  })

  it('does not leave a dangling separator when the train was the only field', () => {
    expect(activityDetails(row({ train_no: '12951' }), { omit: ['train_no'] })).toBe('')
  })
})

/* Design 15's row colour. The tone map is sparse on purpose — `neutral` is the
   default — so the risk is not a wrong colour, it is a key that silently does
   nothing because it is misspelled or names an action that was renamed. */
describe('activityTone (design 15)', () => {
  it('marks the outcomes the product exists for as good', () => {
    expect(activityTone('payment_paid')).toBe('good')
    expect(activityTone('swap_confirmed')).toBe('good')
  })

  it('separates a decline from a problem', () => {
    /* `offer_declined` is a normal answer, not a failure — the requester's
       request is still open for someone else to accept. */
    expect(activityTone('offer_declined')).toBe('neutral')
    expect(activityTone('acceptor_backed_out')).toBe('bad')
  })

  it('defaults to neutral, so a new action is grey until someone decides', () => {
    expect(activityTone('sign_in')).toBe('neutral')
    expect(activityTone('an_action_that_does_not_exist')).toBe('neutral')
  })

  it('names only real actions — no typo can sit here doing nothing', () => {
    const toned = tonedActions()
    expect(toned.length).toBeGreaterThan(0)
    for (const action of toned) {
      /* `activityCategory` answers `other` for anything it has never heard of,
         and `tests/admin.test.ts` already fails if a *logged* action lands in
         `other` — so `other` here means the name is not a real action. */
      expect(activityCategory(action), `${action} is not a known action`).not.toBe('other')
    }
  })

  it('covers every tone the map can return', () => {
    const seen = new Set<ActivityTone>(tonedActions().map(activityTone))
    expect(seen).toEqual(new Set(['good', 'warn', 'bad']))
  })
})

/* Design 15's Time column. It shows the time AND the date: the design's own
   rows are all one evening, so a bare "22:41" is unambiguous there and
   ambiguous in a real log, where it cannot tell today from three weeks ago. */
describe('activityTime', () => {
  it('renders a zero-padded 24-hour time', () => {
    expect(activityTime('2026-09-28T22:41:00+05:30', 'en')).toMatch(/^\d{2}:\d{2}$/)
    expect(activityTime('2026-09-28T09:05:00+05:30', 'en')).toMatch(/^\d{2}:\d{2}$/)
  })

  it('uses the locale it is given, not the machine default', () => {
    /* Both are HH:MM; the point is that the argument is threaded through
       `localeFor()` rather than ignored. */
    const iso = '2026-09-28T22:41:00+05:30'
    expect(activityTime(iso, 'hi')).toMatch(/^\d{2}:\d{2}$/)
    expect(activityTime(iso, 'en')).toBe(activityTime(iso, 'hi'))
  })

  it('returns nothing rather than "Invalid Date"', () => {
    expect(activityTime('not a date', 'en')).toBe('')
    expect(activityTime('', 'en')).toBe('')
  })
})

/* Design 24's credit tiles. The ledger is SIGNED (docs/02: "balance =
   sum(amount) where not expired"), so every one of these turns on a sign. */
describe('creditSummary (design 24)', () => {
  const NOW = Date.parse('2026-09-28T12:00:00+05:30')
  const inDays = (days: number): string => new Date(NOW + days * 86_400_000).toISOString()
  const tx = (id: string, amount_paise: number, expires_at: string | null) => ({
    id,
    amount_paise,
    expires_at,
  })

  it('separates credit given from credit used by sign', () => {
    const summary = creditSummary([tx('a', 5000, inDays(300)), tx('b', -9900, null)], NOW)
    expect(summary.givenPaise).toBe(5000)
    expect(summary.usedPaise).toBe(9900)
  })

  it('reduces the balance when credit is spent', () => {
    const summary = creditSummary([tx('a', 5000, inDays(300)), tx('b', -5000, null)], NOW)
    expect(summary.balancePaise).toBe(0)
  })

  it('counts an expired earn as given, but not as balance', () => {
    const summary = creditSummary([tx('a', 5000, inDays(-1))], NOW)
    expect(summary.givenPaise).toBe(5000)
    expect(summary.balancePaise).toBe(0)
  })

  it('given - used - balance is exactly the credit that expired away', () => {
    const summary = creditSummary(
      [tx('a', 9900, inDays(-2)), tx('b', 5000, inDays(300)), tx('c', -2000, null)],
      NOW,
    )
    expect(summary.givenPaise - summary.usedPaise - summary.balancePaise).toBe(9900)
  })

  it('floors the balance at zero rather than showing a negative', () => {
    /* An earn expires while the spend it funded does not — spends carry no
       expiry, so this is reachable. The unfloored sum would be -5000. */
    const summary = creditSummary([tx('a', 5000, inDays(-1)), tx('b', -5000, null)], NOW)
    expect(summary.balancePaise).toBe(0)
  })

  it('treats an unparseable expiry as live, matching isCreditLive', () => {
    const summary = creditSummary([tx('a', 5000, 'not-a-date')], NOW)
    expect(summary.balancePaise).toBe(5000)
  })

  it('counts a negative staff adjustment as used, not as given', () => {
    const summary = creditSummary(
      [tx('a', 5000, inDays(300)), tx('b', -1000, inDays(300))],
      NOW,
    )
    expect(summary.givenPaise).toBe(5000)
    expect(summary.usedPaise).toBe(1000)
    expect(summary.balancePaise).toBe(4000)
  })

  it('is all zeros for an empty ledger', () => {
    expect(creditSummary([], NOW)).toEqual({ givenPaise: 0, usedPaise: 0, balancePaise: 0 })
  })
})

/* Design 18's Payments screen. The route used to render a literal empty array —
   `const rows: AdminPaymentRow[] = []` — under a comment claiming the emptiness
   was legitimate because "nothing is captured until a provider webhook confirms
   it". Wrong on both counts: `usePayments()` already existed in
   `lib/use-store.ts`, and `startPayment` writes a local row (plus a
   `payment_created` log line) the moment checkout opens. The list was empty
   because of the code, not the state. */
function paymentRow(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay_1',
    request_id: 'req_a1b2c3d4',
    payer_id: null,
    provider: 'razorpay',
    provider_ref: null,
    amount_paise: PRICE_PAISE,
    credit_used_paise: 0,
    currency: 'INR',
    status: 'paid',
    receipt_number: null,
    created_at: '2026-11-12T10:00:00.000Z',
    updated_at: '2026-11-12T10:00:00.000Z',
    ...over,
  }
}

/** A credit-ledger row with the two fields design 18's tiles turn on. */
function creditRow(over: Partial<WalletTx> = {}): WalletTx {
  return {
    id: 'tx_1',
    user_id: null,
    amount_paise: THANK_YOU_PAISE,
    kind: 'acceptor_credit',
    ref_request_id: null,
    expires_at: null,
    created_at: '2026-11-12T10:00:00.000Z',
    ...over,
  }
}

/* Design 18b's Reports table. The screen used to print two internal
   identifiers where the design puts an Issue and a Status — `report_filed` as a
   title and `swap_request` as a pill — so the queue told an operator nothing
   they could act on. The screen now derives both from one function, and the
   risk that matters is not a wrong label but a leaked one. */
describe('reportRows — design 18b\'s Issue and Status', () => {
  let n = 0
  function row(
    action: string,
    meta: Record<string, unknown> = {},
    entityId: string | null = null,
    at = '2026-11-12T10:00:00.000Z',
  ): ActivityRow {
    n += 1
    return {
      id: `act_${n}`,
      actor_id: 'u_1',
      actor_role: 'user',
      action,
      entity: 'swap_request',
      entity_id: entityId,
      meta,
      created_at: at,
    }
  }

  beforeEach(() => {
    n = 0
  })

  it('names the KIND of report from a bounded vocabulary, not the text', () => {
    const [cash] = reportRows([
      row('report_filed', { request_id: 'req_1', reason: 'He asked for cash instead of swapping' }),
    ])
    expect(cash.issue).toBe('cash')
    expect(cash.request_id).toBe('req_1')
    expect(cash.closed).toBe(false)
  })

  it('falls back to a neutral label rather than guessing at unknown text', () => {
    const [other] = reportRows([
      row('report_filed', { request_id: 'req_1', reason: 'something we have no word for' }),
    ])
    expect(other.issue).toBeNull()
  })

  it('never puts the traveller\'s free text in the row the screen renders', () => {
    /* The reason is written by the caller and the type allows a transcript,
       which can carry a phone number or a UPI id — what lib/chat-guard.ts
       exists to keep off a screen. The raw text is carried for the CSV only,
       and the screen renders `issue`. */
    const [rowOut] = reportRows([
      row('report_filed', {
        request_id: 'req_1',
        reason: 'my number is 9876543210 and he wanted upi to arjun@ybl',
      }),
    ])
    expect(JSON.stringify(rowOut.issue)).not.toMatch(/9876543210|upi|ybl/)
    expect(rowOut.reason).toContain('9876543210')
  })

  it('joins a report to the report_closed that answers it', () => {
    const rows = reportRows([
      row('report_filed', { request_id: 'req_1', reason: 'asked for cash' }),
      row('report_filed', { request_id: 'req_2', reason: 'asked for cash' }),
      row('report_closed', { request_id: 'req_1' }, 'req_1', '2026-11-12T11:00:00.000Z'),
    ])
    /* Keyed by request, not by position: the queue is sorted newest-first, so
       an index-based assertion tests the sort and only incidentally the join. */
    expect(Object.fromEntries(rows.map((r) => [r.request_id, r.closed]))).toEqual({
      req_1: true,
      req_2: false,
    })
  })

  it('lists only filed reports, newest first — a block is not a report', () => {
    const rows = reportRows([
      row('report_filed', { request_id: 'req_1' }, null, '2026-11-12T10:00:00.000Z'),
      row('block', {}, 'u_9'),
      row('report_filed', { request_id: 'req_2' }, null, '2026-11-12T12:00:00.000Z'),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].request_id).toBe('req_2')
  })

  it('exports the raw reason to CSV, which is a file the operator opened', () => {
    const csv = reportsToCsv([
      reportRows([row('report_filed', { request_id: 'req_1', reason: 'asked for cash' })])[0],
    ])
    expect(csv).toContain('req_1')
    expect(csv).toContain('asked for cash')
    expect(csv).toContain('open')
  })

  it('has a label in both languages for every issue the allow-list can return', () => {
    /* The screen composes `admin.report_${issue}`, so a key added to
       `REPORT_ISSUES` without a label in both catalogues renders a raw dotted
       path in an operator's queue. The mapping is the key name by design (the
       same convention as `admin.act.*`), which means the list of what can be
       returned and the list of what is translated are two things that can part
       company — and the null fallback means nothing else would notice. */
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'admin.ts'), 'utf8')
    const block = src.slice(src.indexOf('const REPORT_ISSUES'), src.indexOf('function reportIssue'))
    /* The entries are `[/<pattern>/i, '<key>']` — the key is the SECOND field,
       after a regex, not a quoted string in first position. A first-field
       pattern finds nothing and passes vacuously, which is the failure mode a
       guard like this most needs to avoid: it would report "0 issues, all
       labelled" forever while the list grew underneath it. Mutation-checked by
       adding an untranslated entry, which fails naming it. */
    const keys = [...block.matchAll(/,\s*'([a-z_]+)'\]/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(en.admin[`report_${key}` as keyof typeof en.admin], key).toBeTruthy()
      expect(hi.admin[`report_${key}` as keyof typeof hi.admin], key).toBeTruthy()
    }
  })
})

describe('shortId — the Swap column designs 17 and 18 share', () => {
  it('keeps the tail of a prefixed id', () => {
    expect(shortId('req_a1b2c3d4')).toBe('#a1b2c3d4')
    expect(shortId('pay_12345678')).toBe('#12345678')
  })

  it('falls back to the whole id when there is no underscore', () => {
    expect(shortId('abc')).toBe('#abc')
  })
})

describe('swapToCreditRequestIds — the rule-6 rows, and only those', () => {
  it('takes swap_to_credit and ignores the acceptor thank-you', () => {
    const ids = swapToCreditRequestIds([
      creditRow({ id: 'a', kind: 'swap_to_credit', ref_request_id: 'req_1' }),
      creditRow({ id: 'b', kind: 'acceptor_credit', ref_request_id: 'req_2' }),
    ])
    expect([...ids]).toEqual(['req_1'])
  })

  it('ignores spends, expiries and staff grants', () => {
    const ids = swapToCreditRequestIds([
      creditRow({ id: 'a', kind: 'used', amount_paise: -5000, ref_request_id: 'req_1' }),
      creditRow({ id: 'b', kind: 'expired', amount_paise: -5000, ref_request_id: 'req_2' }),
      creditRow({ id: 'c', kind: 'admin_adjust', ref_request_id: 'req_3' }),
    ])
    expect(ids.size).toBe(0)
  })

  it('ignores a rule-6 row with no request attached', () => {
    const ids = swapToCreditRequestIds([
      creditRow({ kind: 'swap_to_credit', ref_request_id: null }),
    ])
    expect(ids.size).toBe(0)
  })
})

describe("paymentOutcome — design 18's Status column", () => {
  const NONE: ReadonlySet<string> = new Set()

  it('reads the payment state on its own', () => {
    expect(paymentOutcome(paymentRow({ status: 'paid' }), NONE)).toBe('paid')
    expect(paymentOutcome(paymentRow({ status: 'created' }), NONE)).toBe('pending')
    expect(paymentOutcome(paymentRow({ status: 'pending' }), NONE)).toBe('pending')
    expect(paymentOutcome(paymentRow({ status: 'failed' }), NONE)).toBe('failed')
  })

  it('is to_credit when the paid money became credit under rule 6', () => {
    const ids = new Set(['req_a1b2c3d4'])
    expect(paymentOutcome(paymentRow({ status: 'paid' }), ids)).toBe('to_credit')
  })

  /* The guard that matters: "To credit" is an outcome of a PAID payment, not a
     label for any request that happens to hold a rule-6 row. A payment still in
     flight is pending — there is no money there to move. */
  it('never calls an unpaid payment to_credit', () => {
    const ids = new Set(['req_a1b2c3d4'])
    expect(paymentOutcome(paymentRow({ status: 'pending' }), ids)).toBe('pending')
    expect(paymentOutcome(paymentRow({ status: 'created' }), ids)).toBe('pending')
    expect(paymentOutcome(paymentRow({ status: 'failed' }), ids)).toBe('failed')
  })

  it('does not flip a payment whose request is not in the set', () => {
    const ids = new Set(['req_someone_else'])
    expect(paymentOutcome(paymentRow({ status: 'paid' }), ids)).toBe('paid')
  })
})

describe("paymentRows — design 18's table", () => {
  it('amounts are what was collected, not what was charged', () => {
    const rows = paymentRows(
      [paymentRow({ amount_paise: PRICE_PAISE, credit_used_paise: THANK_YOU_PAISE })],
      [],
    )
    expect(rows[0].amount_paise).toBe(PRICE_PAISE)
    expect(rows[0].credit_used_paise).toBe(THANK_YOU_PAISE)
    /* The design's ₹49 on a ₹99 swap paid with ₹50 credit. */
    expect(rows[0].received_paise).toBe(PRICE_PAISE - THANK_YOU_PAISE)
  })

  it('collects nothing until the payment is paid', () => {
    expect(paymentRows([paymentRow({ status: 'pending' })], [])[0].received_paise).toBe(0)
    expect(paymentRows([paymentRow({ status: 'created' })], [])[0].received_paise).toBe(0)
  })

  it('carries the design Swap column and sorts newest first', () => {
    const rows = paymentRows(
      [
        paymentRow({ id: 'p_old', request_id: 'req_aaaaaaaa', created_at: '2026-11-12T10:00:00.000Z' }),
        paymentRow({ id: 'p_new', request_id: 'req_bbbbbbbb', created_at: '2026-11-12T22:41:00.000Z' }),
      ],
      [],
    )
    expect(rows.map((r) => r.id)).toEqual(['p_new', 'p_old'])
    expect(rows[0].swap).toBe('#bbbbbbbb')
  })

  /* The tile sums the LOG and the row status reads the WALLET — two sources,
     because `credit_added`'s meta carries no request id. This is the test that
     says they agree, so a call site writing one without the other is caught. */
  it('agrees with the tile about which request moved to credit', () => {
    const rows = paymentRows(
      [paymentRow({ request_id: 'req_a1b2c3d4', status: 'paid' })],
      [creditRow({ kind: 'swap_to_credit', ref_request_id: 'req_a1b2c3d4' })],
    )
    expect(rows[0].outcome).toBe('to_credit')
  })
})

describe("paymentsToCsv — design 18's columns", () => {
  const row: AdminPaymentRow = {
    id: 'pay_1',
    request_id: 'req_a1b2c3d4',
    swap: '#a1b2c3d4',
    provider: 'razorpay',
    amount_paise: PRICE_PAISE,
    credit_used_paise: THANK_YOU_PAISE,
    received_paise: PRICE_PAISE - THANK_YOU_PAISE,
    status: 'paid',
    outcome: 'to_credit',
    created_at: '2026-11-12T22:41:00.000Z',
  }

  it('writes the header and the money split', () => {
    const lines = paymentsToCsv([row]).split('\n')
    expect(lines[0]).toBe(
      'id,swap,request_id,provider,amount_paise,credit_used_paise,received_paise,status,outcome,created_at',
    )
    expect(lines[1]).toBe(
      'pay_1,#a1b2c3d4,req_a1b2c3d4,razorpay,9900,5000,4900,paid,to_credit,2026-11-12T22:41:00.000Z',
    )
  })

  /* An export leaves the device, so it must not carry a payer id or a full PNR
     even if a future column tries to add one. */
  it('carries no payer id and no ten-digit run', () => {
    const csv = paymentsToCsv([row])
    expect(csv).not.toContain('payer_id')
    expect(csv).not.toMatch(/\d{10}/)
  })
})

describe('payment labels resolve in every shipped language', () => {
  it('has an outcome label for each outcome', () => {
    const missing: string[] = []
    for (const lang of SHIPPED_LANGS) {
      for (const outcome of PAYMENT_OUTCOMES) {
        const key = PAYMENT_OUTCOME_LABEL[outcome]
        if (!lookupLabel(CATALOGS[lang], key)) missing.push(`${lang}:${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('has a state label for each payment status', () => {
    const statuses: Array<PaymentRow['status']> = ['created', 'pending', 'paid', 'failed']
    const missing: string[] = []
    for (const lang of SHIPPED_LANGS) {
      for (const status of statuses) {
        const key = PAYMENT_STATE_LABEL[status]
        if (!lookupLabel(CATALOGS[lang], key)) missing.push(`${lang}:${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  /* The coarse outcome and the exact state must not collapse onto one key, or
     the tooltip stops saying anything the pill did not already say. `created`
     vs `pending` is the distinction the tooltip exists for. */
  it('keeps the exact state distinct from the coarse outcome', () => {
    expect(PAYMENT_STATE_LABEL.created).not.toBe(PAYMENT_OUTCOME_LABEL.pending)
    expect(PAYMENT_STATE_LABEL.pending).not.toBe(PAYMENT_OUTCOME_LABEL.pending)
  })

  it('uses one wording for Paid across the swaps and payments tables', () => {
    expect(PAYMENT_OUTCOME_LABEL.paid).toBe(SWAP_PHASE_LABEL.paid)
    expect(PAYMENT_OUTCOME_LABEL.to_credit).toBe(SWAP_PHASE_LABEL.to_credit)
  })
})
