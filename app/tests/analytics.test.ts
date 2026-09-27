/* On-device metrics log: append, cap, count, reset (docs/08 day-1 metrics). */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  countEvents,
  isAnalyticsEvent,
  readEvents,
  resetAnalyticsForTests,
  trackEvent,
} from '@/lib/analytics'

describe('analytics log', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetAnalyticsForTests()
  })

  it('appends funnel events oldest-first with timestamps', () => {
    trackEvent('pnr_added', { train_no: '12951' })
    trackEvent('request_sent', { matches: 3 })
    const rows = readEvents()
    expect(rows.map((r) => r.event)).toEqual(['pnr_added', 'request_sent'])
    expect(rows[0].meta).toMatchObject({ train_no: '12951' })
    expect(rows[1].ts).toBeGreaterThanOrEqual(rows[0].ts)
  })

  it('counts events since a timestamp', () => {
    trackEvent('share_clicked', { platform: 'copy' })
    trackEvent('share_clicked', { platform: 'whatsapp' })
    expect(countEvents('share_clicked')).toBe(2)
    expect(countEvents('share_clicked', Date.now() + 1000)).toBe(0)
    expect(countEvents('pnr_added')).toBe(0)
  })

  it('caps the buffer so the log cannot grow forever', () => {
    for (let i = 0; i < 600; i += 1) trackEvent('first_screen_viewed', {})
    const rows = readEvents()
    expect(rows.length).toBeLessThanOrEqual(500)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('ignores corrupt storage and resets cleanly', () => {
    window.localStorage.setItem('seatswap.analytics.v1', 'broken{')
    expect(readEvents()).toEqual([])
    trackEvent('sign_in', {})
    expect(readEvents()).toHaveLength(1)
    resetAnalyticsForTests()
    expect(readEvents()).toEqual([])
  })

  it('only accepts known event names', () => {
    expect(isAnalyticsEvent('request_sent')).toBe(true)
    expect(isAnalyticsEvent('refund_to_bank')).toBe(false)
    expect(isAnalyticsEvent(null)).toBe(false)
  })
})
