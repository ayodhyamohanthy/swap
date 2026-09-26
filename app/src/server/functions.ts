/* SeatSwap swap transitions — createServerFn (docs/03, docs/08 logs).
   Every transition validates the caller, moves exactly one step, and writes
   one activity_log row (action/entity/meta below). Offline-first: the pure
   apply* helpers run the same checks on local rows so the UI keeps working
   until backend keys exist; server functions persist via Supabase when
   configured and otherwise return the payload + activity row for local commit. */

import { createServerFn } from '@tanstack/react-start'
import { getSupabase } from '@/lib/supabase'

export type SwapStatus =
  | 'draft' | 'searching' | 'accepted_awaiting_payment' | 'locked'
  | 'confirmed' | 'voided' | 'disputed' | 'expired' | 'withdrawn'
export type OfferStatus = 'sent' | 'accepted' | 'declined' | 'superseded' | 'expired'

export interface RequestRow { id: string; requester_id: string; booking_id: string; status: SwapStatus }
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
  if (offer.status !== 'sent') throw new SwapError('offer_not_open')
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
  input: { payment_id: string },
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
    const next = applySendRequest(data.request, data.callerId, { booking_id: data.booking_id })
    const { persisted } = await persistTransition('swap_requests', data.request.id, { status: next.status }, next.activity)
    return { status: next.status, activity: next.activity, persisted }
  })

export const acceptOffer = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; offer: OfferRow; callerId: string }) => input)
  .handler(async ({ data }) => {
    const next = applyAcceptOffer(data.request, data.offer, data.callerId)
    const { persisted } = await persistTransition('swap_offers', data.offer.id, { status: next.offerStatus }, next.activity)
    return { requestStatus: next.requestStatus, offerStatus: next.offerStatus, activity: next.activity, persisted }
  })

export const withdrawRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; callerId: string }) => input)
  .handler(async ({ data }) => {
    const next = applyWithdrawRequest(data.request, data.callerId)
    const { persisted } = await persistTransition('swap_requests', data.request.id, { status: next.status }, next.activity)
    return { status: next.status, activity: next.activity, persisted }
  })

export const declineOffer = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; offer: OfferRow; callerId: string }) => input)
  .handler(async ({ data }) => {
    const next = applyDeclineOffer(data.request, data.offer, data.callerId)
    const { persisted } = await persistTransition('swap_offers', data.offer.id, { status: next.offerStatus }, next.activity)
    return { offerStatus: next.offerStatus, requestStatus: next.requestStatus, activity: next.activity, persisted }
  })

export const lockRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: RequestRow; offer: OfferRow; callerId: string; payment_id: string }) => input)
  .handler(async ({ data }) => {
    const next = applyLockRequest(data.request, data.offer, data.callerId, { payment_id: data.payment_id })
    const { persisted } = await persistTransition(
      'swap_requests', data.request.id,
      { status: next.status, locked_offer_id: data.offer.id }, next.activity,
    )
    return { status: next.status, activity: next.activity, persisted }
  })
