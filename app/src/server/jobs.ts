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

/**
 * These are cron effects, not user actions, and the database knows the
 * difference: `wallet_tx` deliberately has **no** INSERT policy for
 * `authenticated` (a client must never mint credit, and `tests/schema.test.ts`
 * pins that), and `notifications` grants `SELECT, UPDATE` only. So a job
 * running with the caller's token — which is what `getSupabase()` gives it —
 * has every one of its writes rejected by RLS.
 *
 * That means the function did its arithmetic correctly, issued the writes, and
 * reported `persisted: 0` for a job that can never persist anything: a silent
 * no-op wearing the costume of a success. Worse, it accepted caller-supplied
 * `userId` / `organiserId` values and would have written to them if the grants
 * ever loosened.
 *
 * So a job that has real work to do requires a service-role client, and says
 * so instead of pretending. `SERVICE_ROLE_KEY` is the same env var the admin
 * console already needs, so this adds no new secret and no new dependency.
 * Without it the jobs stay local-only (docs/08: the device is the system of
 * record until a backend exists), which is what they effectively were anyway.
 */
function requireServiceRole(client: SupaClient | null): SupaClient | null {
  if (!client) return null
  if (!process.env.SERVICE_ROLE_KEY) return null
  return client
}

/**
 * Payload validation for the job wrappers.
 *
 * These took identity validators, so `data.journeys` and friends were whatever
 * the caller sent: a `journeys` entry without `id` produced `.map(j => j.id)`
 * over `undefined`, and a non-array `journeys` threw inside the filter rather
 * than at the boundary. The date cores are pure and well tested, so this is
 * about the envelope, not the logic.
 *
 * It matters more than usual for these functions: they are the ones that would
 * carry a service-role client, so a payload that reached a query builder
 * unexamined would be running with privileges the caller does not have.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Bounded so a crafted payload cannot be a memory or round-trip cost. */
const MAX_ROWS = 500

function uuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(code)
  return value
}

function epochMs(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(code)
  return value
}

function rows<T>(value: unknown, code: string, check: (row: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error(code)
  return value.map(check)
}

function journey(input: unknown): { id: string; journeyEndMs: number } {
  const row = input as { id?: unknown; journeyEndMs?: unknown }
  return { id: uuid(row?.id, 'invalid_id'), journeyEndMs: epochMs(row?.journeyEndMs, 'invalid_time') }
}

function swap(input: unknown): { id: string; arrivalMs: number; answered: 0 | 1 | 2; acceptorId?: string } {
  const row = input as { id?: unknown; arrivalMs?: unknown; answered?: unknown; acceptorId?: unknown }
  const answered = row?.answered
  if (answered !== 0 && answered !== 1 && answered !== 2) throw new Error('invalid_answered')
  const out: { id: string; arrivalMs: number; answered: 0 | 1 | 2; acceptorId?: string } = {
    id: uuid(row?.id, 'invalid_id'),
    arrivalMs: epochMs(row?.arrivalMs, 'invalid_time'),
    answered,
  }
  if (row?.acceptorId !== undefined && row?.acceptorId !== null) {
    out.acceptorId = uuid(row.acceptorId, 'invalid_acceptor_id')
  }
  return out
}

function grant(input: unknown): { id: string; earnedMs: number; expiresAtMs: number } {
  const row = input as { id?: unknown; earnedMs?: unknown; expiresAtMs?: unknown }
  return {
    id: uuid(row?.id, 'invalid_id'),
    earnedMs: epochMs(row?.earnedMs, 'invalid_time'),
    expiresAtMs: epochMs(row?.expiresAtMs, 'invalid_time'),
  }
}

function chartRow(input: unknown): { id: string; userId: string; prevChart: boolean; nextChart: boolean } {
  const row = input as { id?: unknown; userId?: unknown; prevChart?: unknown; nextChart?: unknown }
  if (typeof row?.prevChart !== 'boolean' || typeof row?.nextChart !== 'boolean') {
    throw new Error('invalid_flags')
  }
  return {
    id: uuid(row?.id, 'invalid_id'),
    userId: uuid(row?.userId, 'invalid_user_id'),
    prevChart: row.prevChart,
    nextChart: row.nextChart,
  }
}

function groupRow(input: unknown): { id: string; organiserId: string; journeyEndMs: number; lockedCount: number; paid: boolean } {
  const row = input as {
    id?: unknown; organiserId?: unknown; journeyEndMs?: unknown
    lockedCount?: unknown; paid?: unknown
  }
  const locked = row?.lockedCount
  if (typeof locked !== 'number' || !Number.isInteger(locked) || locked < 0) {
    throw new Error('invalid_locked_count')
  }
  if (typeof row?.paid !== 'boolean') throw new Error('invalid_paid_flag')
  return {
    id: uuid(row?.id, 'invalid_group_id'),
    organiserId: uuid(row?.organiserId, 'invalid_user_id'),
    journeyEndMs: epochMs(row?.journeyEndMs, 'invalid_time'),
    lockedCount: locked,
    paid: row.paid,
  }
}

export const expireRequestsAfterJourneyEnd = createServerFn({ method: 'POST' })
  .validator((input: { nowMs: number; journeys: Array<{ id: string; journeyEndMs: number }> }) => ({
    nowMs: epochMs(input?.nowMs, 'invalid_time'),
    journeys: rows(input?.journeys, 'invalid_journeys', journey),
  }))
  .handler(async ({ data }) => {
    const expired = data.journeys.filter((j) => isRequestExpired(data.nowMs, j.journeyEndMs)).map((j) => j.id)
    const client = requireServiceRole(await getSupabase())
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
  .validator((input: { nowMs: number; swaps: Array<{ id: string; arrivalMs: number; answered: 0 | 1 | 2; acceptorId?: string }> }) => ({
    nowMs: epochMs(input?.nowMs, 'invalid_time'),
    swaps: rows(input?.swaps, 'invalid_swaps', swap),
  }))
  .handler(async ({ data }) => {
    const confirmed = data.swaps.filter((s) => shouldAutoConfirm(data.nowMs, s.arrivalMs, s.answered))
    const client = requireServiceRole(await getSupabase())
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
  .validator((input: { nowMs: number; grants: Array<{ id: string; earnedMs: number; expiresAtMs: number }> }) => ({
    nowMs: epochMs(input?.nowMs, 'invalid_time'),
    grants: rows(input?.grants, 'invalid_grants', grant),
  }))
  .handler(async ({ data }) => {
    const expired = data.grants.filter((g) => isCreditExpired(data.nowMs, g.earnedMs)).map((g) => g.id)
    const remind = data.grants.filter((g) => needsCreditReminder(data.nowMs, g.expiresAtMs)).map((g) => g.id)
    const client = requireServiceRole(await getSupabase())
    let persisted = 0
    if (client) {
      for (const id of expired) {
        if (await logEffect(client, 'credit_expired', 'wallet_tx', id)) persisted += 1
      }
    }
    return { expired, remind, persisted, activity: 'credit_expired' as const }
  })

export const chartTimeNotify = createServerFn({ method: 'POST' })
  .validator((input: { trips: Array<{ id: string; userId: string; prevChart: boolean; nextChart: boolean }> }) => ({
    trips: rows(input?.trips, 'invalid_trips', chartRow),
  }))
  .handler(async ({ data }) => {
    const notify = data.trips.filter((t) => shouldNotifyChartTime(t.prevChart, t.nextChart))
    const client = requireServiceRole(await getSupabase())
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
    }) => ({
      nowMs: epochMs(input?.nowMs, 'invalid_time'),
      groups: rows(input?.groups, 'invalid_groups', groupRow),
    }),
  )
  .handler(async ({ data }) => {
    const convertible = data.groups.filter(
      (g) => g.paid && isUnusedGroupCover(data.nowMs, g.journeyEndMs, g.lockedCount),
    )
    const client = requireServiceRole(await getSupabase())
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
