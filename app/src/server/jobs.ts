/* SeatSwap scheduled-job server wrappers (docs/08). Pure date cores live in
   `@/lib/jobs` (unit-tested); these wrappers apply the effects server-side and
   write one activity_log row per effect. Without a backend they return the
   computed plan unpersisted. SERVER-ONLY. */

import { createServerFn } from '@tanstack/react-start'
import { getSupabase } from '@/lib/supabase'
import {
  persistInserts,
  persistMulti,
  type SupaClient,
} from './functions'
import {
  isCreditExpired,
  isRequestExpired,
  isUnusedGroupCover,
  needsCreditReminder,
  shouldAutoConfirm,
  shouldNotifyChartTime,
} from '@/lib/jobs'
import { GROUP_PRICE_PAISE } from '@/lib/money'

async function logEffect(
  client: SupaClient | null,
  action: string,
  entity: string,
  entityId: string,
): Promise<boolean> {
  if (!client) return false
  const done = await persistInserts(client, [], {
    actor_id: 'system', actor_role: 'support', action, entity, entity_id: entityId, meta: {},
  })
  return done.persisted
}

export const expireRequestsAfterJourneyEnd = createServerFn({ method: 'POST' })
  .validator((input: { nowMs: number; journeys: Array<{ id: string; journeyEndMs: number }> }) => input)
  .handler(async ({ data }) => {
    const expired = data.journeys.filter((j) => isRequestExpired(data.nowMs, j.journeyEndMs)).map((j) => j.id)
    const client = await getSupabase()
    let persisted = 0
    if (client) {
      const done = await persistMulti(
        client,
        expired.map((id) => ({ table: 'swap_requests', id, patch: { status: 'expired' } })),
        { actor_id: 'system', actor_role: 'support', action: 'request_expired', entity: 'job', entity_id: 'expire-requests', meta: { count: expired.length } },
      )
      void done
      for (const id of expired) {
        if (await logEffect(client, 'request_expired', 'swap_request', id)) persisted += 1
      }
    }
    return { expired, persisted, activity: 'request_expired' as const }
  })

export const autoConfirm12hAfterArrival = createServerFn({ method: 'POST' })
  .validator((input: { nowMs: number; swaps: Array<{ id: string; arrivalMs: number; answered: 0 | 1 | 2; acceptorId?: string }> }) => input)
  .handler(async ({ data }) => {
    const confirmed = data.swaps.filter((s) => shouldAutoConfirm(data.nowMs, s.arrivalMs, s.answered))
    const client = await getSupabase()
    let persisted = 0
    if (client) {
      for (const swap of confirmed) {
        const done = await persistMulti(
          client,
          [{ table: 'swap_requests', id: swap.id, patch: { status: 'confirmed' } }],
          { actor_id: 'system', actor_role: 'support', action: 'confirmation', entity: 'swap_request', entity_id: swap.id, meta: { auto: true } },
        )
        void done
        if (await logEffect(client, 'confirmation', 'swap_request', swap.id)) persisted += 1
      }
    }
    return { confirmed: confirmed.map((s) => s.id), persisted, activity: 'confirmation' as const }
  })

export const expireCreditDaily = createServerFn({ method: 'POST' })
  .validator((input: { nowMs: number; grants: Array<{ id: string; earnedMs: number; expiresAtMs: number }> }) => input)
  .handler(async ({ data }) => {
    const expired = data.grants.filter((g) => isCreditExpired(data.nowMs, g.earnedMs)).map((g) => g.id)
    const remind = data.grants.filter((g) => needsCreditReminder(data.nowMs, g.expiresAtMs)).map((g) => g.id)
    const client = await getSupabase()
    let persisted = 0
    if (client) {
      for (const id of expired) {
        if (await logEffect(client, 'credit_expired', 'wallet_tx', id)) persisted += 1
      }
    }
    return { expired, remind, persisted, activity: 'credit_expired' as const }
  })

export const chartTimeNotify = createServerFn({ method: 'POST' })
  .validator((input: { trips: Array<{ id: string; userId: string; prevChart: boolean; nextChart: boolean }> }) => input)
  .handler(async ({ data }) => {
    const notify = data.trips.filter((t) => shouldNotifyChartTime(t.prevChart, t.nextChart))
    const client = await getSupabase()
    let persisted = 0
    if (client) {
      for (const trip of notify) {
        const done = await persistInserts(
          client,
          [{ table: 'notifications', row: { user_id: trip.userId, kind: 'chart_out', title: 'chart', body: trip.id, link: `/trips/${trip.id}` } }],
          { actor_id: 'system', actor_role: 'support', action: 'chart_prepared', entity: 'booking', entity_id: trip.id, meta: {} },
        )
        if (done.persisted) persisted += 1
      }
    }
    return { notify: notify.map((t) => t.id), persisted, activity: 'chart_prepared' as const }
  })

/* Unused group cover → organiser credit (docs/01, pay.groupUnder, rule 6):
   a paid ₹199 trip whose journey ended with zero covered swaps becomes
   swap_to_credit, never a bank refund. Partially used bundles are spent.
   wallet_tx.ref_request_id stays NULL (FK to swap_requests); the group id
   rides in the activity meta. */
export const expireUnusedGroupCover = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      nowMs: number
      groups: Array<{ id: string; organiserId: string; journeyEndMs: number; lockedCount: number; paid: boolean }>
    }) => input,
  )
  .handler(async ({ data }) => {
    const convertible = data.groups.filter(
      (g) => g.paid && isUnusedGroupCover(data.nowMs, g.journeyEndMs, g.lockedCount),
    )
    const client = await getSupabase()
    let persisted = 0
    if (client) {
      const exp = new Date(data.nowMs)
      exp.setMonth(exp.getMonth() + 12)
      for (const group of convertible) {
        const done = await persistInserts(
          client,
          [{
            table: 'wallet_tx',
            row: {
              user_id: group.organiserId, amount_paise: GROUP_PRICE_PAISE, kind: 'swap_to_credit',
              ref_request_id: null, expires_at: exp.toISOString(),
            },
          }],
          { actor_id: 'system', actor_role: 'support', action: 'credit_added', entity: 'group', entity_id: group.id, meta: { amount_paise: GROUP_PRICE_PAISE, kind: 'swap_to_credit' } },
        )
        if (done.persisted) persisted += 1
      }
    }
    return { converted: convertible.map((g) => g.id), persisted, activity: 'credit_added' as const }
  })
