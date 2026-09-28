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

import {
  ACTIVITY_CATEGORIES,
  ADMIN_ROUTES,
  activityActions,
  activityCategory,
  activityDetails,
  activityLabelKey,
  activityToCsv,
  buildOverview,
  creditsToCsv,
  filterActivity,
  paymentsToCsv,
  swapsToCsv,
  toCsv,
  uncategorisedActions,
  usersToCsv,
  type AdminOverviewInput,
  type AdminSwapRow,
  type AdminUserRow,
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
} from '@/lib/store'

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

/** buildOverview over the local store's own rows (design 23). */
function overview(overrides: Partial<AdminOverviewInput> = {}, nowMs = Date.now()) {
  return buildOverview(
    {
      activity: activityLog(),
      walletTotalPaise: 0,
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
    const stats = overview({ walletTotalPaise: 5000 })
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

    const stats = overview({ walletTotalPaise: 10000 })
    expect(stats.creditGivenTodayPaise).toBe(14900)
    expect(stats.creditInCirculationPaise).toBe(10000)
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
