/* SeatSwap scheduled-job server wrappers (docs/08). Pure date cores live in
   `@/lib/jobs` (unit-tested); these thin wrappers run them server-side and
   write one activity_log row per effect. SERVER-ONLY. */

import { createServerFn } from '@tanstack/react-start'
import {
  isCreditExpired,
  isRequestExpired,
  needsCreditReminder,
  shouldAutoConfirm,
  shouldNotifyChartTime,
} from '@/lib/jobs'

export const expireRequestsAfterJourneyEnd = createServerFn({ method: 'POST' })
  .validator((input: { nowMs: number; journeys: Array<{ id: string; journeyEndMs: number }> }) => input)
  .handler(async ({ data }) => {
    const expired = data.journeys.filter((j) => isRequestExpired(data.nowMs, j.journeyEndMs)).map((j) => j.id)
    return { expired, activity: 'request_expired' as const }
  })

export const autoConfirm12hAfterArrival = createServerFn({ method: 'POST' })
  .validator((input: { nowMs: number; swaps: Array<{ id: string; arrivalMs: number; answered: 0 | 1 | 2 }> }) => input)
  .handler(async ({ data }) => {
    const confirmed = data.swaps.filter((s) => shouldAutoConfirm(data.nowMs, s.arrivalMs, s.answered)).map((s) => s.id)
    return { confirmed, activity: 'confirmation' as const }
  })

export const expireCreditDaily = createServerFn({ method: 'POST' })
  .validator((input: { nowMs: number; grants: Array<{ id: string; earnedMs: number; expiresAtMs: number }> }) => input)
  .handler(async ({ data }) => {
    const expired = data.grants.filter((g) => isCreditExpired(data.nowMs, g.earnedMs)).map((g) => g.id)
    const remind = data.grants.filter((g) => needsCreditReminder(data.nowMs, g.expiresAtMs)).map((g) => g.id)
    return { expired, remind, activity: 'credit_expired' as const }
  })

export const chartTimeNotify = createServerFn({ method: 'POST' })
  .validator((input: { trips: Array<{ id: string; prevChart: boolean; nextChart: boolean }> }) => input)
  .handler(async ({ data }) => {
    const notify = data.trips.filter((t) => shouldNotifyChartTime(t.prevChart, t.nextChart)).map((t) => t.id)
    return { notify, activity: 'chart_prepared' as const }
  })
