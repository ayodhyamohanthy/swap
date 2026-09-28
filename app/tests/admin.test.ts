/* Admin helpers + scheduled-job date cores (docs/04-D, docs/08).
   The job comment in lib/jobs.ts claims these are "tested in admin.test.ts" —
   this is that file. Guards: paise integers, CSV escaping, masked PNRs only. */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ADMIN_ROUTES,
  activityActions,
  activityToCsv,
  buildOverview,
  creditsToCsv,
  filterActivity,
  paymentsToCsv,
  swapsToCsv,
  toCsv,
  usersToCsv,
  type AdminSwapRow,
} from '@/lib/admin'
import {
  isCreditExpired,
  isRequestExpired,
  needsCreditReminder,
  shouldAutoConfirm,
  shouldNotifyChartTime,
} from '@/lib/jobs'
import { FEE_PAISE, GROUP_PRICE_PAISE, PRICE_PAISE, THANK_YOU_PAISE } from '@/lib/money'
import { activityLog, logActivity, resetStore } from '@/lib/store'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-11-12T10:00:00.000Z')

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

describe('buildOverview', () => {
  beforeEach(() => resetStore())

  it('counts only today and ranks the busiest trains', () => {
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('pnr_added', { train_no: '12219' })
    logActivity('request_sent', { train_no: '12951' })

    /* logActivity stamps real wall-clock time, so "today" is the real today. */
    const stats = buildOverview(
      { activity: activityLog(), walletTotalPaise: 5000 },
      Date.now(),
    )
    expect(stats.pnrsToday).toBe(3)
    expect(stats.requestsToday).toBe(1)
    expect(stats.creditIssuedPaise).toBe(5000)
    expect(stats.busiestTrains[0]).toEqual({ train_no: '12951', count: 3 })
    expect(stats.busiestTrains).toHaveLength(2)
  })

  it('excludes rows from a previous day', () => {
    const yesterday = new Date(Date.now() - 2 * DAY).toISOString()
    const stats = buildOverview(
      { activity: [{ ...logActivity('pnr_added'), created_at: yesterday }], walletTotalPaise: 0 },
      Date.now(),
    )
    expect(stats.pnrsToday).toBe(0)
  })
})

describe('filterActivity', () => {
  beforeEach(() => resetStore())

  it('filters by action and matches the query across fields', () => {
    logActivity('pnr_added', { train_no: '12951' })
    logActivity('request_sent', { train_no: '12951' })

    expect(filterActivity(activityLog(), { action: 'pnr_added', query: '' })).toHaveLength(1)
    expect(filterActivity(activityLog(), { action: null, query: '12951' })).toHaveLength(2)
    expect(filterActivity(activityLog(), { action: null, query: 'nomatch' })).toHaveLength(0)
  })

  it('lists distinct actions for the dropdown', () => {
    logActivity('pnr_added', {})
    logActivity('request_sent', {})
    expect(activityActions(activityLog())).toEqual(['pnr_added', 'request_sent'])
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

    expect(buildOverview({ activity: [rowAt(justAfter)], walletTotalPaise: 0 }, justAfter.getTime()).pnrsToday).toBe(1)
    expect(buildOverview({ activity: [rowAt(justBefore)], walletTotalPaise: 0 }, justAfter.getTime()).pnrsToday).toBe(0)
  })
})
