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
