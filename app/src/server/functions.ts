/* SeatSwap swap transitions — createServerFn (docs/03, docs/08 logs).
   Every transition validates the caller, moves exactly one step, and writes
   one activity_log row (action/entity/meta below). Offline-first: the pure
   apply* helpers run the same checks on local rows so the UI keeps working
   until backend keys exist; server functions persist via Supabase when
   configured and otherwise return the payload + activity row for local commit. */

import { createServerFn } from '@tanstack/react-start'
import { getSupabase } from '@/lib/supabase'
import { GROUP_MAX_SWAPS } from '@/lib/money'

export type SwapStatus =
  | 'draft' | 'searching' | 'accepted_awaiting_payment' | 'locked'
  | 'confirmed' | 'voided' | 'disputed' | 'expired' | 'withdrawn'
export type OfferStatus = 'sent' | 'accepted' | 'declined' | 'superseded' | 'expired'

export interface RequestRow { id: string; requester_id: string; booking_id: string; status: SwapStatus; passenger_ids?: string[]; group_id?: string | null }
export interface OfferRow {
  id: string; request_id: string; acceptor_id: string
  acceptor_booking_id: string; acceptor_passenger_id: string
  matched_choice_rank: number; status: OfferStatus
}

export interface ActivityWrite {
  actor_id: string; actor_role: 'user' | 'admin' | 'support'
  action: string; entity: string; entity_id: string; meta: Record<string, string | number | boolean | null>
}

export class SwapError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'SwapError'
    this.code = code
  }
}

export function applySendRequest(
  request: RequestRow, callerId: string,
  input: { booking_id: string },
): { status: SwapStatus; activity: ActivityWrite } {
  if (request.requester_id !== callerId) throw new SwapError('not_requester')
  if (request.status !== 'draft') throw new SwapError('not_draft')
  if (request.booking_id !== input.booking_id) throw new SwapError('wrong_booking')
  return {
    status: 'searching',
    activity: {
      actor_id: callerId, actor_role: 'user', action: 'request_sent',
      entity: 'swap_request', entity_id: request.id,
      meta: { booking_id: request.booking_id },
    },
  }
}

export function applyAcceptOffer(
  request: RequestRow, offer: OfferRow, callerId: string,
): { requestStatus: SwapStatus; offerStatus: OfferStatus; activity: ActivityWrite } {
  if (offer.acceptor_id !== callerId) throw new SwapError('not_acceptor')
  if (offer.request_id !== request.id) throw new SwapError('wrong_request')
  if (request.status !== 'searching') throw new SwapError('not_searching')
  if (offer.status !== 'sent') throw new SwapError('offer_not_open')
  if (offer.matched_choice_rank < 1 || offer.matched_choice_rank > 3) throw new SwapError('bad_rank')
  return {
    requestStatus: 'accepted_awaiting_payment',
    offerStatus: 'accepted',
    activity: {
      actor_id: callerId, actor_role: 'user', action: 'offer_accepted',
      entity: 'swap_offer', entity_id: offer.id,
      meta: { request_id: request.id, choice_rank: offer.matched_choice_rank },
    },
  }
}

export function applyWithdrawRequest(
  request: RequestRow, callerId: string,
): { status: SwapStatus; activity: ActivityWrite } {
  if (request.requester_id !== callerId) throw new SwapError('not_requester')
  if (request.status !== 'searching') throw new SwapError('not_searching')
  return {
    status: 'withdrawn',
    activity: {
      actor_id: callerId, actor_role: 'user', action: 'request_withdrawn',
      entity: 'swap_request', entity_id: request.id, meta: {},
    },
  }
}

export function applyDeclineOffer(
  request: RequestRow, offer: OfferRow, callerId: string,
): { offerStatus: OfferStatus; requestStatus: SwapStatus; activity: ActivityWrite } {
  if (offer.acceptor_id !== callerId) throw new SwapError('not_acceptor')
  if (offer.request_id !== request.id) throw new SwapError('wrong_request')
  if (offer.status !== 'sent' && offer.status !== 'accepted') throw new SwapError('offer_not_open')
  // Acceptor backs out before payment: request returns to searching
  // unless it already moved on (docs/03).
  const backToSearching = request.status === 'accepted_awaiting_payment'
  return {
    offerStatus: 'declined',
    requestStatus: backToSearching ? 'searching' : request.status,
    activity: {
      actor_id: callerId, actor_role: 'user', action: 'offer_declined',
      entity: 'swap_offer', entity_id: offer.id,
      meta: { request_id: request.id, back_to_searching: backToSearching },
    },
  }
}

export function applyLockRequest(
  request: RequestRow, offer: OfferRow, callerId: string,
  input: { payment_id: string | null },
): { status: SwapStatus; activity: ActivityWrite } {
  if (request.requester_id !== callerId) throw new SwapError('not_requester')
  if (request.status !== 'accepted_awaiting_payment') throw new SwapError('not_awaiting_payment')
  if (offer.request_id !== request.id) throw new SwapError('wrong_request')
  if (offer.status !== 'accepted') throw new SwapError('offer_not_accepted')
  return {
    status: 'locked',
    activity: {
      actor_id: callerId, actor_role: 'user', action: 'swap_locked',
      entity: 'swap_request', entity_id: request.id,
      meta: { offer_id: offer.id, payment_id: input.payment_id },
    },
  }
}

export interface RowPatch { table: string; id: string; patch: Record<string, unknown>; key?: string }

/** Accept: flip BOTH the offer and the request (rule 2 — first acceptance
    moves searching -> accepted_awaiting_payment; rivals stay open until paid). */
export function planAcceptOffer(
  request: RequestRow, offer: OfferRow, callerId: string,
): { patches: RowPatch[]; requestStatus: SwapStatus; offerStatus: OfferStatus; activity: ActivityWrite } {
  const next = applyAcceptOffer(request, offer, callerId)
  return {
    patches: [
      { table: 'swap_offers', id: offer.id, patch: { status: next.offerStatus, responded_at: new Date().toISOString() } },
      { table: 'swap_requests', id: request.id, patch: { status: next.requestStatus } },
    ],
    requestStatus: next.requestStatus,
    offerStatus: next.offerStatus,
    activity: next.activity,
  }
}

/** Decline/back-out: flip the offer and, when the request was waiting on this
    acceptor's payment, return it to searching (docs/03). */
export function planDeclineOffer(
  request: RequestRow, offer: OfferRow, callerId: string,
): { patches: RowPatch[]; requestStatus: SwapStatus; offerStatus: OfferStatus; activity: ActivityWrite } {
  const next = applyDeclineOffer(request, offer, callerId)
  const patches: RowPatch[] = [
    { table: 'swap_offers', id: offer.id, patch: { status: next.offerStatus, responded_at: new Date().toISOString() } },
  ]
  if (next.requestStatus !== request.status) {
    patches.push({ table: 'swap_requests', id: request.id, patch: { status: next.requestStatus, locked_offer_id: null } })
  }
  return { patches, requestStatus: next.requestStatus, offerStatus: next.offerStatus, activity: next.activity }
}

/** Lock (after a paid payment): the request locks onto the paid offer and
    every rival open/accepted offer on the same request is superseded, so the
    losers see "Someone else was faster" (docs/03). One berth can sit in only
    one locked swap: pass the passenger sets of other locked requests and the
    planner refuses the double-lock. */
export function planLockRequest(
  request: RequestRow, offer: OfferRow, siblings: OfferRow[], callerId: string,
  input: { payment_id?: string | null; lockedPassengerSets?: string[][]; group?: { paid: boolean; lockedCount: number } | null },
): { patches: RowPatch[]; status: SwapStatus; activity: ActivityWrite } {
  const next = applyLockRequest(request, offer, callerId, { payment_id: input.payment_id ?? null })
  /* Group bundle cap (docs/01): a paid ₹199 trip covers at most
     GROUP_MAX_SWAPS locks. A lock backed by its own paid payment (the 4th+
     swap paying per-request) always goes through — only covered locks count. */
  if (request.group_id) {
    if (!input.group?.paid) throw new SwapError('group_unpaid')
    if (!input.payment_id && (input.group.lockedCount ?? 0) >= GROUP_MAX_SWAPS) {
      throw new SwapError('group_swap_cap')
    }
  }
  const mine = new Set(request.passenger_ids ?? [])
  for (const set of input.lockedPassengerSets ?? []) {
    if (set.some((id) => mine.has(id))) throw new SwapError('berth_already_locked')
  }
  const patches: RowPatch[] = [
    { table: 'swap_requests', id: request.id, patch: { status: next.status, locked_offer_id: offer.id } },
  ]
  for (const sib of siblings) {
    if (sib.id === offer.id) continue
    if (sib.status === 'sent' || sib.status === 'accepted') {
      patches.push({ table: 'swap_offers', id: sib.id, patch: { status: 'superseded' } })
    }
  }
  return { patches, status: next.status, activity: next.activity }
}

export type SupaClient = NonNullable<Awaited<ReturnType<typeof getSupabase>>>

export interface RowInsert { table: string; row: Record<string, unknown> }

/** Insert rows (wallet awards, notifications, disputes) then the activity row. */
export async function persistInserts(
  client: SupaClient, inserts: RowInsert[], activity: ActivityWrite,
): Promise<{ persisted: boolean; failed: string[] }> {
  const failed: string[] = []
  for (const ins of inserts) {
    try {
      const writer = (client.from(ins.table).insert(ins.row) as unknown as Promise<{ error: unknown }>)
      const { error } = await writer
      if (error) failed.push(ins.table)
    } catch { failed.push(ins.table) }
  }
  try {
    const logger = (client.from('activity_log').insert({
      actor_id: activity.actor_id, actor_role: activity.actor_role,
      action: activity.action, entity: activity.entity,
      entity_id: activity.entity_id, meta: activity.meta,
    }) as unknown as Promise<{ error: unknown }>)
    const { error: logError } = await logger
    if (logError) failed.push('activity_log')
  } catch { failed.push('activity_log') }
  return { persisted: failed.length === 0, failed }
}

/** Write every row patch, then the single activity_log row (best-effort;
    returns per-patch results so the UI can commit locally on failure).
    Status moves on swap_requests/swap_offers go through the SECURITY DEFINER
    transition RPCs — authenticated clients hold no UPDATE grant there, so a
    forged direct write cannot jump states (docs/03). */
export async function persistMulti(
  client: SupaClient, patches: RowPatch[], activity: ActivityWrite,
): Promise<{ persisted: boolean; failed: string[] }> {
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    args: Record<string, string | null>,
  ) => Promise<{ error: unknown }>
  const failed: string[] = []
  for (const write of patches) {
    try {
      const status = (write.patch as Record<string, unknown>).status
      if ((write.table === 'swap_requests' || write.table === 'swap_offers') && typeof status === 'string') {
        const fn = write.table === 'swap_requests' ? 'apply_request_transition' : 'apply_offer_transition'
        const args: Record<string, string | null> = write.table === 'swap_requests'
          ? {
              p_req: write.id, p_status: status,
              p_locked_offer: typeof (write.patch as Record<string, unknown>).locked_offer_id === 'string'
                ? (write.patch as Record<string, unknown>).locked_offer_id as string : null,
            }
          : {
              p_offer: write.id, p_status: status,
              p_responded: typeof (write.patch as Record<string, unknown>).responded_at === 'string'
                ? (write.patch as Record<string, unknown>).responded_at as string : null,
            }
        const { error } = await rpc(fn, args)
        if (error) failed.push(write.id)
        continue
      }
      const updater = (client.from(write.table).update(write.patch).eq(write.key ?? 'id', write.id) as unknown as Promise<{ error: unknown }>)
      const { error } = await updater
      if (error) failed.push(write.id)
    } catch { failed.push(write.id) }
  }
  try {
    const logger = (client.from('activity_log').insert({
      actor_id: activity.actor_id, actor_role: activity.actor_role,
      action: activity.action, entity: activity.entity,
      entity_id: activity.entity_id, meta: activity.meta,
    }) as unknown as Promise<{ error: unknown }>)
    const { error: logError } = await logger
    if (logError) failed.push('activity_log')
  } catch { failed.push('activity_log') }
  return { persisted: failed.length === 0, failed }
}

/** Caller id comes from the session when the backend is configured; the
    client-supplied id is only the offline-first fallback (docs/08).

    The two cases are deliberately different, and conflating them was a hole.
    `!client` means no backend is configured at all: this device is the whole
    world (docs/08 local-first), and the supplied id is the best available. But
    a client that EXISTS and then fails to identify its caller is an
    **authentication failure** — an expired or revoked token, a network blip, an
    aborted request — and falling through to a string the caller chose makes
    "who are you" answerable by the caller. `resolveCaller`'s result is used as
    the authenticated identity by `createRazorpayOrder` and `createPaypalOrder`,
    so that is impersonation with money attached.

    So: no client → offline fallback (deliberate, unchanged). Client present but
    no verified user → refuse. Fail closed. */
export async function resolveCaller(client: SupaClient | null, fallbackId: string): Promise<string> {
  if (!client) return fallbackId
  const { data, error } = await client.auth.getUser()
  if (error || !data?.user?.id) {
    throw new SwapError('not_signed_in')
  }
  return data.user.id
}

/** Re-read a row server-side so forged client copies cannot move states.

    Same fail-closed reasoning as `resolveCaller`, and the stakes are higher:
    every state-machine authorisation check downstream (`applySendRequest`
    comparing `requester_id`, `applyAcceptOffer`, `planLockRequest`) runs against
    whatever this returns. Falling back to the client's own copy on a read
    failure means the check validates a row the attacker wrote — which is
    precisely what the function exists to prevent. A caller that genuinely wants
    the offline path passes `client: null` and gets the fallback, so nothing is
    lost by refusing here.

    Two failures, and only the second throws:

      - **the row is not there** (`data: null`, no error). That is an answer,
        not a fault: the callers already handle it and report
        `request_not_found`, so raising an error here would both duplicate that
        message and turn an ordinary "no such request" into a scary one.
      - **the row could not be read** (a real error). There is nothing safe to
        return, and the fallback is exactly the forged input this exists to
        reject, so this refuses.

    Note the asymmetry: `!client` still returns the fallback, because no backend
    means this device is the whole world (docs/08). Only a configured backend
    that cannot answer gets a refusal. */
export async function refetchRow<T>(
  client: SupaClient | null, table: string, id: string, fallback: T,
): Promise<T> {
  if (!client) return fallback
  const query = (client.from(table).select('*').eq('id', id).single() as unknown as Promise<{ data: T | null; error: unknown }>)
  const { data, error } = await query
  if (data) return data
  if (!error) return fallback
  throw new SwapError('state_unreadable')
}

async function persistTransition(
  table: string, id: string, patch: Record<string, unknown>, activity: ActivityWrite,
): Promise<{ persisted: boolean }> {
  try {
    const client = await getSupabase()
    if (!client) return { persisted: false }
    const updater = (client.from(table).update(patch).eq('id', id) as unknown as Promise<{ error: unknown }>)
    const { error } = await updater
    if (error) return { persisted: false }
    const logger = (client.from('activity_log').insert({
      actor_id: activity.actor_id, actor_role: activity.actor_role,
      action: activity.action, entity: activity.entity,
      entity_id: activity.entity_id, meta: activity.meta,
    }) as unknown as Promise<{ error: unknown }>)
    const { error: logError } = await logger
    if (logError) return { persisted: false }
    return { persisted: true }
  } catch { return { persisted: false } }
}

export const sendRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; callerId: string; booking_id: string }) => input)
  .handler(async ({ data }) => {
    const client = await getSupabase()
    const callerId = await resolveCaller(client, data.callerId)
    const request = await refetchRow(client, 'swap_requests', data.request.id, data.request)
    const next = applySendRequest(request, callerId, { booking_id: data.booking_id })
    const { persisted } = await persistTransition('swap_requests', data.request.id, { status: next.status }, next.activity)
    return { status: next.status, activity: next.activity, persisted }
  })

export const acceptOffer = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; offer: OfferRow; callerId: string }) => input)
  .handler(async ({ data }) => {
    const client = await getSupabase()
    const callerId = await resolveCaller(client, data.callerId)
    const request = await refetchRow(client, 'swap_requests', data.request.id, data.request)
    const offer = await refetchRow(client, 'swap_offers', data.offer.id, data.offer)
    const next = planAcceptOffer(request, offer, callerId)
    if (!client) return { requestStatus: next.requestStatus, offerStatus: next.offerStatus, activity: next.activity, persisted: false as const, failed: [] as string[] }
    const { persisted, failed } = await persistMulti(client, next.patches, next.activity)
    return { requestStatus: next.requestStatus, offerStatus: next.offerStatus, activity: next.activity, persisted, failed }
  })

export const withdrawRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; callerId: string }) => input)
  .handler(async ({ data }) => {
    const client = await getSupabase()
    const callerId = await resolveCaller(client, data.callerId)
    const request = await refetchRow(client, 'swap_requests', data.request.id, data.request)
    const next = applyWithdrawRequest(request, callerId)
    const { persisted } = await persistTransition('swap_requests', data.request.id, { status: next.status }, next.activity)
    return { status: next.status, activity: next.activity, persisted }
  })

export const declineOffer = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; offer: OfferRow; callerId: string }) => input)
  .handler(async ({ data }) => {
    const client = await getSupabase()
    const callerId = await resolveCaller(client, data.callerId)
    const request = await refetchRow(client, 'swap_requests', data.request.id, data.request)
    const offer = await refetchRow(client, 'swap_offers', data.offer.id, data.offer)
    const next = planDeclineOffer(request, offer, callerId)
    if (!client) return { offerStatus: next.offerStatus, requestStatus: next.requestStatus, activity: next.activity, persisted: false as const, failed: [] as string[] }
    const { persisted, failed } = await persistMulti(client, next.patches, next.activity)
    return { offerStatus: next.offerStatus, requestStatus: next.requestStatus, activity: next.activity, persisted, failed }
  })

export const lockRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; offer: OfferRow; siblings?: OfferRow[]; callerId: string; payment_id?: string | null; group?: { paid: boolean; lockedCount: number } | null }) => input)
  .handler(async ({ data }) => {
    const client = await getSupabase()
    const callerId = await resolveCaller(client, data.callerId)
    const request = await refetchRow(client, 'swap_requests', data.request.id, data.request)
    const offer = await refetchRow(client, 'swap_offers', data.offer.id, data.offer)
    const group = await groupCoverage(client, request.group_id ?? null, data.group ?? null)
    const next = planLockRequest(request, offer, data.siblings ?? [], callerId, { payment_id: data.payment_id ?? null, group })
    if (!client) return { status: next.status, activity: next.activity, persisted: false as const, failed: [] as string[] }
    const { persisted, failed } = await persistMulti(client, next.patches, next.activity)
    return { status: next.status, activity: next.activity, persisted, failed }
  })

/** Group bundle state for the lock cap (docs/01): paid = a paid group payment
    exists; lockedCount = locked + confirmed member swaps. Offline (no client)
    falls back to the caller-supplied snapshot. */
export async function groupCoverage(
  client: SupaClient | null,
  groupId: string | null,
  fallback: { paid: boolean; lockedCount: number } | null,
): Promise<{ paid: boolean; lockedCount: number } | null> {
  if (!groupId) return null
  if (!client) return fallback
  try {
    const gq = await (client.from('group_trips').select('id').eq('id', groupId).single() as unknown as Promise<{ data: { id: string } | null; error: unknown }>)
    if (gq.error || !gq.data) return fallback
    const pq = await (client.from('payments').select('id').eq('group_id', groupId).eq('status', 'paid').limit(1) as unknown as Promise<{ data: Array<{ id: string }> | null; error: unknown }>)
    const lq = await (client.from('swap_requests').select('id').eq('group_id', groupId).or('status.eq.locked,status.eq.confirmed') as unknown as Promise<{ data: Array<{ id: string }> | null; error: unknown }>)
    if (pq.error || lq.error) return fallback
    return { paid: (pq.data?.length ?? 0) > 0, lockedCount: lq.data?.length ?? 0 }
  } catch {
    return fallback
  }
}
