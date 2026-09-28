/* SeatSwap requests & offers — local-first mirror of `swap_requests` +
   `swap_offers` (docs/02, docs/03 state machines, build steps 4-5).

   Rules this file protects:
   - Sending is FREE (rule 2): `sendRequest` never touches the wallet.
   - First acceptance flips the request to `accepted_awaiting_payment`; until
     the requester pays, other offers can still accept (rule 2).
   - `lockRequest` runs only after payment; it supersedes every other offer so
     only one locked swap exists per berth (docs/03).
   - Every transition writes an `activity_log` row (coding conventions).
   - Nothing here ever issues credit (rules 3-6 live in outcomes/payments). */

import type { BerthType } from './pnr'
import { rankMatches, type CandidateSpec, type RequesterSpec } from './matching'
import { needsCreditReminder } from './jobs'
import { trackEvent } from './analytics'
import { GROUP_MAX_SWAPS } from './money'
import { getGroup, groupForTrip } from './groups'
import { logActivity, listTrips, getTrip, getSnapshot, isSeen, markSeen, paymentFor, type Trip } from './store'

export type RequestStatus =
  | 'draft'
  | 'searching'
  | 'accepted_awaiting_payment'
  | 'locked'
  | 'confirmed'
  | 'voided'
  | 'disputed'
  | 'expired'
  | 'withdrawn'

export type OfferStatus = 'sent' | 'accepted' | 'declined' | 'superseded' | 'expired'

/** i18n keys of the reason chips (matches /locales/{lang}.json). */
export type ReasonKey =
  | 'request.reasons.family'
  | 'request.reasons.elder'
  | 'request.reasons.medical'
  | 'request.reasons.group'
  | 'request.reasons.window'
  | 'request.reasons.none'

export interface SwapRequest {
  id: string
  trip_id: string
  requester_id: string | null
  /** Family trip this request belongs to (docs/02 `swap_requests.group_id`).
      A paid group covers up to GROUP_MAX_SWAPS locks without per-swap pay. */
  group_id: string | null
  choices: BerthType[]
  same_coach: boolean
  keep_together: boolean
  /** i18n key of the reason chip, e.g. `request.reasons.family`. */
  reason_key: ReasonKey | null
  status: RequestStatus
  paused: boolean
  locked_offer_id: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface SwapOffer {
  id: string
  request_id: string
  acceptor_trip_id: string
  /** First name + initial — the only identity ever shown (rule 13). */
  acceptor_name: string
  acceptor_berth_type: BerthType
  acceptor_coach: string | null
  /** Exact berth number, stored at send time but only SHOWN after payment
      (rule 13) via `revealedBerths()`. Never rendered masked-or-guessed. */
  acceptor_berth_no: string | null
  matched_choice_rank: 1 | 2 | 3
  status: OfferStatus
  created_at: string
  responded_at: string | null
}

/** Acceptor side: how my open trip responded to the last incoming request. */
export type IncomingResponse = 'none' | 'accepted' | 'declined' | 'backed_out' | 'faster'

export interface IncomingRequest {
  id: string
  trip_id: string
  requester_name: string
  give_berth: BerthType
  get_berth: BerthType
  reason_key: ReasonKey | null
  state: IncomingResponse
}

export interface RequestsState {
  requests: SwapRequest[]
  offers: SwapOffer[]
  /** trip id -> response on the acceptor side (docs/04 B3-B4). */
  incoming: Record<string, IncomingResponse>
}

const STORAGE_KEY = 'seatswap.requests.v1'

function emptyState(): RequestsState {
  return { requests: [], offers: [], incoming: {} }
}

function readState(): RequestsState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as Partial<RequestsState>
    const offers = Array.isArray(parsed.offers) ? parsed.offers : []
    const requests = Array.isArray(parsed.requests) ? parsed.requests : []
    return {
      /* Rows stored before `group_id` existed belong to no trip group. */
      requests: requests.map((request) => ({ ...request, group_id: request.group_id ?? null })),
      /* Rows stored before `acceptor_berth_no` existed stay unknown (null) —
         never backfilled or guessed. */
      offers: offers.map((offer) => ({ ...offer, acceptor_berth_no: offer.acceptor_berth_no ?? null })),
      incoming: parsed.incoming && typeof parsed.incoming === 'object' ? parsed.incoming : {},
    }
  } catch {
    return emptyState()
  }
}

let snapshot: RequestsState = emptyState()
let hydrated = false

function ensureLoaded(): RequestsState {
  if (!hydrated) {
    snapshot = readState()
    hydrated = true
  }
  return snapshot
}

const listeners = new Set<() => void>()

function commit(next: RequestsState): RequestsState {
  snapshot = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* private mode — state stays in memory */
    }
  }
  for (const listener of listeners) listener()
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRequestsSnapshot(): RequestsState {
  return ensureLoaded()
}

/* Stable module-level reference: useSyncExternalStore requires the server
   snapshot to be cached, otherwise React re-renders forever (and warns). */
const SERVER_SNAPSHOT: RequestsState = emptyState()

export function getRequestsServerSnapshot(): RequestsState {
  return SERVER_SNAPSHOT
}

export function resetRequests(): void {
  hydrated = true
  commit(emptyState())
}

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${rand}`
}

/* ------------------------------------------------------------------ *
 * Candidate mapping — local open trips act as the match pool          *
 * ------------------------------------------------------------------ */

function candidateFor(trip: Trip): CandidateSpec | null {
  const passenger = trip.passengers[0]
  if (!passenger || passenger.status !== 'CNF') return null
  return {
    id: trip.id,
    user_id: trip.user_id ?? 'local',
    train_no: trip.train_no,
    journey_date: trip.journey_date ?? '',
    class: trip.class,
    from_code: trip.from_code,
    to_code: trip.to_code,
    coach: passenger.coach,
    berth_no: passenger.berth_no,
    berth_type: passenger.berth_type,
    status: passenger.status,
    quota: passenger.quota,
    open_to_swap: trip.open_to_swap,
    rating: 0,
    paused: false,
    women_only: false,
    families_only: false,
    same_coach_only: false,
  }
}

function requesterFor(trip: Trip, request: SwapRequest): RequesterSpec {
  const passenger = trip.passengers[0]
  return {
    train_no: trip.train_no,
    journey_date: trip.journey_date ?? '',
    class: trip.class,
    from_code: trip.from_code,
    to_code: trip.to_code,
    choices: request.choices,
    same_coach: request.same_coach,
    keep_together: request.keep_together,
    coach: passenger?.coach ?? null,
    quota: passenger?.quota ?? 'GN',
  }
}

/* ------------------------------------------------------------------ *
 * Requester side (docs/04 A)                                          *
 * ------------------------------------------------------------------ */

export interface CreateRequestInput {
  trip_id: string
  choices: BerthType[]
  same_coach?: boolean
  keep_together?: boolean
  reason_key?: ReasonKey | null
  /** Override the trip's family trip (rare; defaults to the trip's group). */
  group_id?: string | null
}

export function createRequest(input: CreateRequestInput): SwapRequest {
  ensureLoaded()
  if (!getTrip(input.trip_id)) throw new Error('trip_missing')
  if (input.choices.length === 0) throw new Error('need_choice')
  const stamp = now()
  const request: SwapRequest = {
    id: newId('req'),
    trip_id: input.trip_id,
    requester_id: null,
    /* Family coverage follows the trip (docs/04 C); explicit wins. */
    group_id: input.group_id !== undefined ? input.group_id : (groupForTrip(input.trip_id)?.id ?? null),
    choices: input.choices.slice(0, 3),
    same_coach: input.same_coach ?? false,
    keep_together: input.keep_together ?? false,
    reason_key: input.reason_key ?? null,
    status: 'draft',
    paused: false,
    locked_offer_id: null,
    sent_at: null,
    created_at: stamp,
    updated_at: stamp,
  }
  commit({ ...ensureLoaded(), requests: [...snapshot.requests, request] })
  logActivity('request_drafted', { choices: request.choices }, { type: 'swap_request', id: request.id })
  return request
}

export function getRequest(id: string): SwapRequest | undefined {
  return ensureLoaded().requests.find((request) => request.id === id)
}

export function listRequests(): SwapRequest[] {
  return ensureLoaded().requests
}

export function offersFor(requestId: string): SwapOffer[] {
  return ensureLoaded().offers.filter((offer) => offer.request_id === requestId)
}

function localPool(): CandidateSpec[] {
  return listTrips()
    .map(candidateFor)
    .filter((candidate): candidate is CandidateSpec => candidate !== null)
}

/** Ranked local matches not yet offered, plus every offer made so far. */
export function matchesFor(
  requestId: string,
): Array<{ offer: SwapOffer } | { candidate: CandidateSpec; trip: Trip }> {
  const request = getRequest(requestId)
  if (!request) return []
  const trip = getTrip(request.trip_id)
  if (!trip) return []
  const candidates = localPool().filter((candidate) => candidate.id !== trip.id && candidate.open_to_swap)
  const ranked = rankMatches(requesterFor(trip, request), candidates)
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const rows: Array<{ offer: SwapOffer } | { candidate: CandidateSpec; trip: Trip }> = []
  for (const offer of offersFor(requestId)) rows.push({ offer })
  const offered = new Set(offersFor(requestId).map((offer) => offer.acceptor_trip_id))
  for (const rank of ranked) {
    if (offered.has(rank.id)) continue
    const candidate = byId.get(rank.id)
    const candidateTrip = getTrip(rank.id)
    if (candidate && candidateTrip) rows.push({ candidate, trip: candidateTrip })
  }
  return rows
}

/** Free send: creates `sent` offers to the ranked matches (rule 2).
    Supply `onlyIds` when the user ticked a subset on the matches screen. */
export function sendRequest(requestId: string, onlyIds?: string[]): SwapRequest | undefined {
  const request = getRequest(requestId)
  if (!request) return undefined
  const trip = getTrip(request.trip_id)
  if (!trip) return undefined

  const candidates = localPool().filter((candidate) => candidate.id !== trip.id && candidate.open_to_swap)
  const wanted = onlyIds ? new Set(onlyIds) : null
  const ranked = rankMatches(requesterFor(trip, request), candidates).filter(
    (rank) => !wanted || wanted.has(rank.id),
  )
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const alreadyOffered = new Set(offersFor(requestId).map((offer) => offer.acceptor_trip_id))

  const fresh: SwapOffer[] = []
  for (const rank of ranked) {
    if (alreadyOffered.has(rank.id)) continue
    const candidate = byId.get(rank.id)
    const candidateTrip = getTrip(rank.id)
    if (!candidate || !candidateTrip) continue
    fresh.push({
      id: newId('off'),
      request_id: request.id,
      acceptor_trip_id: candidate.id,
      acceptor_name: 'Traveller',
      acceptor_berth_type: candidate.berth_type,
      acceptor_coach: candidate.coach,
      acceptor_berth_no: candidate.berth_no,
      matched_choice_rank: rank.choice_rank,
      status: 'sent',
      created_at: now(),
      responded_at: null,
    })
  }

  const updated: SwapRequest = { ...request, status: 'searching', sent_at: now(), updated_at: now() }
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => (row.id === requestId ? updated : row)),
    offers: [...snapshot.offers, ...fresh],
  })
  logActivity('request_sent', { matches: fresh.length, free: true }, { type: 'swap_request', id: requestId })
  trackEvent('request_sent', { matches: fresh.length })
  return updated
}

export function setRequestPaused(requestId: string, paused: boolean): SwapRequest | undefined {
  const request = getRequest(requestId)
  if (!request) return undefined
  const updated: SwapRequest = { ...request, paused, updated_at: now() }
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => (row.id === requestId ? updated : row)),
  })
  logActivity(paused ? 'request_paused' : 'request_resumed', {}, { type: 'swap_request', id: requestId })
  return updated
}

export function withdrawRequest(requestId: string): SwapRequest | undefined {
  const request = getRequest(requestId)
  if (!request) return undefined
  /* Taking back is pre-payment only (docs/03); locked+ requests go through
     cancel/confirm, never a silent withdraw. */
  if (request.status !== 'draft' && request.status !== 'searching'
    && request.status !== 'accepted_awaiting_payment') return undefined
  const updated: SwapRequest = { ...request, status: 'withdrawn', updated_at: now() }
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => (row.id === requestId ? updated : row)),
    offers: snapshot.offers.map((offer) =>
      offer.request_id === requestId && offer.status === 'sent'
        ? { ...offer, status: 'expired' as const }
        : offer,
    ),
  })
  logActivity('request_withdrawn', {}, { type: 'swap_request', id: requestId })
  return updated
}

/** An acceptance flips the request; payment has NOT happened yet (rule 2).
    A second acceptance while one is already awaiting payment is recorded as
    another accepted offer (docs/03 Offer: `sent → accepted` is per-offer;
    the paid one wins at lock, the rest are superseded). */
export function acceptOffer(
  offerId: string,
  acceptorName?: string,
): { request?: SwapRequest; offer?: SwapOffer } {
  const offer = ensureLoaded().offers.find((row) => row.id === offerId)
  if (!offer) return {}
  const request = getRequest(offer.request_id)
  if (!request || (request.status !== 'searching' && request.status !== 'accepted_awaiting_payment'))
    return {}
  if (offer.status !== 'sent') return {}

  const updatedOffer: SwapOffer = {
    ...offer,
    status: 'accepted',
    acceptor_name: acceptorName ?? offer.acceptor_name,
    responded_at: now(),
  }
  const updatedRequest: SwapRequest = { ...request, status: 'accepted_awaiting_payment', updated_at: now() }
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => (row.id === request.id ? updatedRequest : row)),
    offers: snapshot.offers.map((row) => (row.id === offerId ? updatedOffer : row)),
  })
  logActivity('offer_accepted', { rank: offer.matched_choice_rank }, { type: 'swap_request', id: request.id })
  trackEvent('offer_accepted', { rank: offer.matched_choice_rank })
  return { request: updatedRequest, offer: updatedOffer }
}

export function declineOffer(offerId: string): SwapOffer | undefined {
  const offer = ensureLoaded().offers.find((row) => row.id === offerId)
  if (!offer) return undefined
  if (offer.status !== 'sent' && offer.status !== 'accepted') return undefined
  const request = getRequest(offer.request_id)
  const updated: SwapOffer = { ...offer, status: 'declined', responded_at: now() }
  /* Backing out before payment returns a waiting request to searching —
     only when no OTHER accepted offer is still waiting to be paid. */
  const othersAccepted = ensureLoaded().offers.some(
    (row) => row.request_id === offer.request_id && row.status === 'accepted' && row.id !== offerId,
  )
  const backToSearching =
    request?.status === 'accepted_awaiting_payment' && offer.status === 'accepted' && !othersAccepted
  commit({
    ...ensureLoaded(),
    requests: backToSearching && request
      ? snapshot.requests.map((row) => (row.id === request.id
        ? { ...row, status: 'searching' as const, locked_offer_id: null, updated_at: now() } : row))
      : snapshot.requests,
    offers: snapshot.offers.map((row) => (row.id === offerId ? updated : row)),
  })
  logActivity('offer_declined', {}, { type: 'swap_request', id: offer.request_id })
  trackEvent('offer_declined', {})
  return updated
}

/** Runs the moment payment succeeds: lock + supersede everyone else (rule 2).
    With concurrent accepts, pass the PAID offer — the first to be paid for
    wins (docs/04 A.9); omitting it falls back to the earliest acceptance. */
export function lockRequest(requestId: string, paidOfferId?: string): SwapRequest | undefined {
  const request = getRequest(requestId)
  if (!request) return undefined
  /* Locking is payment-gated: only an accepted-awaiting-payment request with
     an accepted offer can lock (docs/03). */
  if (request.status !== 'accepted_awaiting_payment') return undefined
  const acceptedOffers = offersFor(requestId).filter((offer) => offer.status === 'accepted')
  const accepted =
    (paidOfferId ? acceptedOffers.find((offer) => offer.id === paidOfferId) : undefined) ??
    acceptedOffers[0]
  if (!accepted) return undefined
  /* Group bundle cap (docs/01): a paid ₹199 trip covers at most
     GROUP_MAX_SWAPS locks; further swaps pay per-request, so a lock backed
     by its own paid payment always goes through. */
  if (request.group_id) {
    const group = getGroup(request.group_id)
    const ownPaid = paymentFor(requestId)?.status === 'paid'
    if (group?.paid && !ownPaid && groupLockedCount(request.group_id) >= GROUP_MAX_SWAPS) {
      throw new Error('group_swap_cap')
    }
  }
  const updated: SwapRequest = {
    ...request,
    status: 'locked',
    locked_offer_id: accepted.id,
    updated_at: now(),
  }
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => (row.id === requestId ? updated : row)),
    offers: snapshot.offers.map((offer) => {
      if (offer.request_id !== requestId) return offer
      if (offer.id === updated.locked_offer_id) return offer
      if (offer.status === 'sent' || offer.status === 'accepted') {
        return { ...offer, status: 'superseded' as const, responded_at: now() }
      }
      return offer
    }),
  })
  logActivity('swap_locked', { offer: updated.locked_offer_id }, { type: 'swap_request', id: requestId })
  trackEvent('swap_locked', {})
  return updated
}

/**
 * Locked + confirmed swaps already covered by a group trip (docs/01: at most
 * GROUP_MAX_SWAPS per paid ₹199 trip).
 */
export function groupLockedCount(groupId: string): number {
  return ensureLoaded().requests.filter(
    (request) =>
      request.group_id === groupId && (request.status === 'locked' || request.status === 'confirmed'),
  ).length
}

/**
 * Move a locked swap to its terminal state (docs/03). Money has already moved,
 * so the only valid sources are `locked` and — after admin review — `disputed`.
 * Credit for the outcome is issued by `lib/settle`, never here.
 */
export function settleRequest(
  requestId: string,
  status: Extract<RequestStatus, 'confirmed' | 'voided' | 'disputed'>,
): SwapRequest | undefined {
  const request = getRequest(requestId)
  if (!request) return undefined
  const fromLocked = request.status === 'locked'
  const fromDisputed = request.status === 'disputed' && status !== 'disputed'
  if (!fromLocked && !fromDisputed) return undefined
  const updated: SwapRequest = { ...request, status, updated_at: now() }
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => (row.id === requestId ? updated : row)),
  })
  logActivity(
    status === 'confirmed' ? 'swap_confirmed' : status === 'voided' ? 'swap_voided' : 'dispute_opened',
    {},
    { type: 'swap_request', id: requestId },
  )
  /* docs/08 fixes the metric names: only the dispute transitions are events
     here; the swap itself already logged a `confirmation` when each side answered. */
  if (status === 'disputed') trackEvent('dispute_opened', {})
  else if (fromDisputed) trackEvent('dispute_resolved', { status })
  return updated
}

/** The accepted offer: who said yes and what they hold (for the pay screen). */
export function acceptedOffer(requestId: string): SwapOffer | undefined {
  return offersFor(requestId).find((offer) => offer.status === 'accepted')
}

export interface RevealedBerths {
  /** Requester's own berth, e.g. "B3 · 27". Null when not on the ticket. */
  mine: string | null
  /** Acceptor's berth, e.g. "B4 · 41". Null when unknown — render masked. */
  theirs: string | null
  /** Coach both berths were matched in, when known. */
  coach: string | null
  /** Berth numbers alone, for the Swap summary ticket's "Berth 34 ↔ 36" line
      (design 9c) which reads better than the "A2 · 34" composite. */
  mineNo: string | null
  theirsNo: string | null
}

/**
 * Exact berths for the Swap summary / chat header / meet screen (rule 13).
 * Returns null until the requester has PAID (locked or later) — before that,
 * both sides see only "Berth ••". Never fabricates: unknown numbers stay
 * null so the UI renders the masked form, never a guessed berth.
 */
export function revealedBerths(requestId: string): RevealedBerths | null {
  const request = getRequest(requestId)
  if (!request) return null
  if (request.status !== 'locked' && request.status !== 'confirmed' && request.status !== 'disputed') {
    return null
  }
  const locked =
    offersFor(requestId).find((offer) => offer.id === request.locked_offer_id) ??
    acceptedOffer(requestId)
  if (!locked) return null
  const mine = getTrip(request.trip_id)?.passengers.find((p) => p.berth_no)?.berth_no ?? null
  const mineCoach = getTrip(request.trip_id)?.passengers.find((p) => p.berth_no)?.coach ?? null
  const theirs = locked.acceptor_berth_no
  if (!theirs) return null
  return {
    mine: mine && mineCoach ? `${mineCoach} · ${mine}` : mine,
    theirs: locked.acceptor_coach ? `${locked.acceptor_coach} · ${theirs}` : theirs,
    coach: locked.acceptor_coach,
    mineNo: mine,
    theirsNo: locked.acceptor_berth_no,
  }
}

export function offersWithStatus(status: OfferStatus): SwapOffer[] {
  return ensureLoaded().offers.filter((offer) => offer.status === status)
}

/* ------------------------------------------------------------------ *
 * Acceptor side (docs/04 B) — my open trips can receive requests      *
 * ------------------------------------------------------------------ */

/**
 * The incoming request shown for an open trip. Without backend peers yet the
 * local device models ONE pending incoming request per open trip (the same
 * shape a Supabase `swap_offers` row takes after step-3 sync). It is a UI
 * fixture only — it grants nothing and never touches money.
 */
const DEMO_INCOMING_NAME = 'Priya'

export function incomingFor(tripId: string): IncomingRequest | undefined {
  const state = ensureLoaded()
  const trip = getTrip(tripId)
  if (!trip || !trip.open_to_swap) return undefined
  const passenger = trip.passengers[0]
  if (!passenger || passenger.status !== 'CNF') return undefined
  return {
    id: `in_${tripId}`,
    trip_id: tripId,
    requester_name: DEMO_INCOMING_NAME,
    give_berth: passenger.berth_type,
    /* What the requester hands over — demo pool picks the opposite. */
    get_berth: passenger.berth_type === 'UB' ? 'LB' : 'UB',
    reason_key: 'request.reasons.family',
    state: state.incoming[tripId] ?? 'none',
  }
}

export function respondToIncoming(tripId: string, response: IncomingResponse): IncomingRequest | undefined {
  const current = incomingFor(tripId)
  if (!current) return undefined
  commit({ ...ensureLoaded(), incoming: { ...snapshot.incoming, [tripId]: response } })
  if (response === 'accepted') {
    logActivity('offer_accepted', { side: 'acceptor', trip: tripId }, { type: 'booking', id: tripId })
    trackEvent('offer_accepted', { side: 'acceptor' })
  } else if (response === 'declined') {
    logActivity('offer_declined', { side: 'acceptor', trip: tripId }, { type: 'booking', id: tripId })
    trackEvent('offer_declined', { side: 'acceptor' })
  } else if (response === 'backed_out') {
    logActivity('acceptor_backed_out', { trip: tripId }, { type: 'booking', id: tripId })
  } else if (response === 'faster') {
    logActivity('someone_faster', { trip: tripId }, { type: 'booking', id: tripId })
  }
  return incomingFor(tripId)
}

/* ------------------------------------------------------------------ *
 * Updates (docs/04 notifications: in-app list + Swaps tab badge)      *
 * ------------------------------------------------------------------ */

export type UpdateKind =
  | 'accepted'
  | 'faster'
  | 'locked'
  | 'incoming_waiting'
  | 'incoming_declined'
  | 'incoming_faster'
  | 'chart_out'
  | 'credit_added'
  | 'credit_expiring'
  | 'request_expired'

export interface UpdateRow {
  id: string
  kind: UpdateKind
  request_id: string | null
  trip_id: string | null
  created_at: string
  /** Credit rows only: original wallet amount, paise. */
  amount_paise?: number | null
  /** Expiring-credit rows only: whole days left, rounded up. */
  days_left?: number | null
}

export function updates(): UpdateRow[] {
  const state = ensureLoaded()
  const rows: UpdateRow[] = []
  for (const offer of state.offers) {
    const request = state.requests.find((row) => row.id === offer.request_id)
    if (!request) continue
    if (offer.status === 'accepted' && request.status === 'accepted_awaiting_payment') {
      rows.push({
        id: `u_${offer.id}`,
        kind: 'accepted',
        request_id: request.id,
        trip_id: request.trip_id,
        created_at: offer.responded_at ?? offer.created_at,
      })
    }
    if (offer.status === 'superseded') {
      rows.push({
        id: `u_${offer.id}`,
        kind: 'faster',
        request_id: request.id,
        trip_id: request.trip_id,
        created_at: offer.responded_at ?? offer.created_at,
      })
    }
    if (request.status === 'locked' && offer.id === request.locked_offer_id) {
      rows.push({
        id: `u_${offer.id}`,
        kind: 'locked',
        request_id: request.id,
        trip_id: request.trip_id,
        created_at: request.updated_at,
      })
    }
  }
  for (const [tripId, response] of Object.entries(state.incoming)) {
    if (response === 'accepted') {
      rows.push({
        id: `u_in_${tripId}`,
        kind: 'incoming_waiting',
        request_id: null,
        trip_id: tripId,
        created_at: now(),
      })
    } else if (response === 'declined') {
      rows.push({
        id: `u_in_${tripId}`,
        kind: 'incoming_declined',
        request_id: null,
        trip_id: tripId,
        created_at: now(),
      })
    } else if (response === 'faster') {
      rows.push({
        id: `u_in_${tripId}`,
        kind: 'incoming_faster',
        request_id: null,
        trip_id: tripId,
        created_at: now(),
      })
    }
  }
  /* Chart is out (docs/04 growth loop): one row per trip whose chart flipped. */
  for (const trip of listTrips()) {
    if (!trip.chart_prepared) continue
    rows.push({
      id: `u_chart_${trip.id}`,
      kind: 'chart_out',
      request_id: null,
      trip_id: trip.id,
      created_at: trip.created_at,
    })
  }
  /* Credit added + expiring (docs/04 notifications, rule 4: 12-month life). */
  const at = Date.now()
  for (const tx of getSnapshot().wallet) {
    if (tx.amount_paise <= 0) continue
    if (tx.kind === 'acceptor_credit' || tx.kind === 'swap_to_credit' || tx.kind === 'admin_adjust') {
      rows.push({
        id: `u_tx_${tx.id}`,
        kind: 'credit_added',
        request_id: tx.ref_request_id,
        trip_id: null,
        created_at: tx.created_at,
        amount_paise: tx.amount_paise,
      })
    }
    if (tx.expires_at) {
      const expiresMs = Date.parse(tx.expires_at)
      if (Number.isFinite(expiresMs) && needsCreditReminder(at, expiresMs)) {
        rows.push({
          id: `u_txexp_${tx.id}`,
          kind: 'credit_expiring',
          request_id: tx.ref_request_id,
          trip_id: null,
          created_at: tx.created_at,
          amount_paise: tx.amount_paise,
          days_left: Math.max(1, Math.ceil((expiresMs - at) / 86_400_000)),
        })
      }
    }
  }
  /* Requests that ended with no swap (docs/03: searching -> expired). */
  for (const request of state.requests) {
    if (request.status !== 'expired') continue
    rows.push({
      id: `u_reqexp_${request.id}`,
      kind: 'request_expired',
      request_id: request.id,
      trip_id: request.trip_id,
      created_at: request.updated_at,
    })
  }
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

/* ---- Updates read-state (docs/05 #20): every row id above is stable across
   calls, so "read" survives reloads in the same `seen` map as onboarding. */

const updateSeenKey = (id: string): string => `update:${id}`

/** True once the traveller opened (or marked) this update. */
export function isUpdateRead(id: string): boolean {
  return isSeen(updateSeenKey(id))
}

/** Mark one update read. */
export function markUpdateRead(id: string): void {
  markSeen(updateSeenKey(id))
}

/** Mark every current update read. Returns how many were unread. */
export function markAllUpdatesRead(): number {
  let newly = 0
  for (const row of updates()) {
    if (!isUpdateRead(row.id)) {
      markUpdateRead(row.id)
      newly += 1
    }
  }
  return newly
}

/** Updates the traveller has not opened yet, newest first. */
export function unreadUpdates(): UpdateRow[] {
  return updates().filter((row) => !isUpdateRead(row.id))
}
