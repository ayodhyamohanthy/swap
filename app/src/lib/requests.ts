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
import { MAX_OUTGOING_PER_DAY, normalizeCoach, rankMatches, type CandidateSpec, type RequesterSpec } from './matching'
import { needsCreditReminder } from './jobs'
import { trackEvent } from './analytics'
import { GROUP_MAX_SWAPS } from './money'
import { getGroup, groupForTrip } from './groups'
import { logActivity, listTrips, getTrip, getSnapshot, isSeen, markSeen, paymentFor, settings, tripRating, activityLog, type AppState, type Trip } from './store'

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
  /** Attributes the acceptor's own filters are checked against (docs/04 B2). */
  requester_is_woman: boolean
  requester_is_family: boolean
  requester_coach: string | null
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
 * Daily limits (docs/03 abuse limits)                                 *
 * ------------------------------------------------------------------ */

/** The traveller's local calendar day, as YYYY-MM-DD. */
function dayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

function isToday(iso: string | null, key: string): boolean {
  if (!iso) return false
  const at = new Date(iso)
  return Number.isFinite(at.getTime()) && dayKey(at) === key
}

/**
 * Requests this device has already sent today. docs/03 caps outgoing requests
 * at 10 per traveller per day; `rankMatches` enforces the cap, so this is the
 * number it has to be fed — without it the limit silently never fires.
 */
export function sentToday(): number {
  const key = dayKey(new Date())
  return ensureLoaded().requests.filter((request) => isToday(request.sent_at, key)).length
}

/** Offers this trip has already received today — the per-booking measure the
    match query scores candidates with (docs/03's inbound cap). */
export function receivedToday(tripId: string): number {
  const key = dayKey(new Date())
  return ensureLoaded().offers.filter(
    (offer) => offer.acceptor_trip_id === tripId && isToday(offer.created_at, key),
  ).length
}

/** Offers this traveller has received today across all their bookings.
    `max_requests_per_day` is an account setting (docs/02 `settings`), so the
    acceptor's own board is gated on the account, not on one ticket. */
export function receivedTodayForUser(): number {
  const key = dayKey(new Date())
  return ensureLoaded().offers.filter((offer) => isToday(offer.created_at, key)).length
}

/** docs/03: "backed out 3 times in 30 days → hidden from matches for 30 days".
    Counted from the `acceptor_backed_out` rows this device wrote for that
    booking. Unlike the acceptor *filters*, which are a stranger's preferences
    and stay neutral in `candidateFor()`, a back-out is behaviour this device
    observed, so reading it here invents nothing. */
export const BACKOUT_LIMIT = 3 as const
export const BACKOUT_WINDOW_DAYS = 30 as const

export function hiddenForAbuse(tripId: string, atMs: number = Date.now()): boolean {
  const windowStart = atMs - BACKOUT_WINDOW_DAYS * 86_400_000
  const backouts = activityLog()
    .filter(
      (row) =>
        row.action === 'acceptor_backed_out' &&
        row.entity === 'booking' &&
        row.entity_id === tripId,
    )
    .map((row) => Date.parse(row.created_at))
    .filter((ms) => Number.isFinite(ms) && ms >= windowStart)
  return backouts.length >= BACKOUT_LIMIT
}

/** True when today's outgoing budget is spent, so sending is closed. */
export function sendCapped(): boolean {
  return sentToday() >= MAX_OUTGOING_PER_DAY
}

/* ------------------------------------------------------------------ *
 * Candidate mapping — local open trips act as the match pool          *
 * ------------------------------------------------------------------ */

function candidateFor(trip: Trip): CandidateSpec | null {
  const passenger = trip.passengers[0]
  if (!passenger || passenger.status !== 'CNF') return null
  /* Keep-together fit (docs/08): how many confirmed berths this candidate can
     move as a unit — CNF passengers minus children without berths. This is a
     count of swappable seats, not a promise they are adjacent; the bonus only
     ever nudges ranking, never guarantees seating together. */
  const togetherSeats = trip.passengers.filter((row) => row.status === 'CNF' && !row.is_child_no_berth).length
  /* Ratings given on this device nudge future matches (docs/08 scores
     acceptor rating 0–10; local averages are 1–5 like profiles.rating). */
  const avg = tripRating(trip.id)
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
    rating: avg === null ? 0 : Math.min(10, Math.max(0, avg * 2)),
    together_seats: togetherSeats,
    /* The inbound cap, filled from rows this device wrote plus the account's own
       setting (docs/03 default 3, docs/02 `settings.max_requests_per_day`) —
       the Settings screen's "More requests per day" switch had no reader until
       here. `rankMatches` drops a candidate at the cap, so an over-requested
       berth stops appearing in the match list. */
    received_today: receivedToday(trip.id),
    max_requests_per_day: settings().max_requests_per_day,
    hidden_for_abuse: hiddenForAbuse(trip.id),
    paused: false,
    /* Neutral on purpose. These are the *other* traveller's acceptor filters
       (docs/04 B2) and this device has no idea what they are — the local pool
       only stands in for other travellers. Filling them from `settings()`
       would fabricate a stranger's preferences out of the user's own and
       silently shrink the pool (it broke the ₹199 group flow, which legitimately
       sends several requests to one open trip). The local user's own filters
       are applied in `incomingFor()` below, where the user really is the
       acceptor. */
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
    /* Keep-together fit needs both sides: how many confirmed berths the
       requester's own party holds (children without berths don't count). */
    group_size: Math.max(
      1,
      trip.passengers.filter((row) => row.status === 'CNF' && !row.is_child_no_berth).length,
    ),
    /* docs/03: max 10 outgoing requests per traveller per day. */
    sent_today: sentToday(),
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
    Supply `onlyIds` when the user ticked a subset on the matches screen.
    Refuses outright once today's 10-request budget is spent (docs/03), before
    stamping `sent_at` — a refused attempt must not inflate the count it was
    refused by. */
export function sendRequest(requestId: string, onlyIds?: string[]): SwapRequest | undefined {
  const request = getRequest(requestId)
  if (!request) return undefined
  const trip = getTrip(request.trip_id)
  if (!trip) return undefined

  if (sendCapped()) {
    /* activity_log only: the analytics event list is fixed by docs/08, and a
       refused send is an abuse-limit outcome, not a funnel step. */
    logActivity('request_capped', { limit: MAX_OUTGOING_PER_DAY }, { type: 'swap_request', id: requestId })
    return request
  }

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
     by its own paid payment always goes through.

     Returning `undefined` rather than throwing, and that is load-bearing.
     `confirmCaptured` calls this AFTER marking the payment paid, so a throw
     here propagates out of a payment that has already been captured: the caller
     catches it, the request is still `accepted_awaiting_payment`, the ₹99 is
     neither locked nor credited, and the outcome path that would refund it
     under rule 6 needs `locked`/`disputed` — which is never reached. The money
     is simply unaccounted for. The other "cannot lock" case below returns
     `undefined` for exactly this reason; this one did not, so it was the odd
     case out. `lockCoveredRequest` is where the cap is surfaced to a user as
     an error, which is the place that can afford to refuse. */
  if (request.group_id) {
    const group = getGroup(request.group_id)
    const ownPaid = paymentFor(requestId)?.status === 'paid'
    if (group?.paid && !ownPaid && groupLockedCount(request.group_id) >= GROUP_MAX_SWAPS) {
      return undefined
    }
  }
  const updated: SwapRequest = {
    ...request,
    status: 'locked',
    locked_offer_id: accepted.id,
    updated_at: now(),
  }
  /* Cross-request supersede (L5 → L3, 2026-09-28): the acceptor trip that just
     locked can never swap twice (docs/03: one locked swap per berth), so the
     death of a rival offer is not scoped to THIS request — every other
     request's `sent`/`accepted` offer to the same trip dies with this lock
     too. A loser request that was awaiting payment on that acceptance falls
     back to `searching` unless another acceptance is still waiting — the state
     that finally lets screen 29 / design 20a ("Someone else was faster") key
     on something real. */
  const lostToLock = snapshot.offers.filter(
    (offer) =>
      offer.request_id !== requestId &&
      offer.acceptor_trip_id === accepted.acceptor_trip_id &&
      (offer.status === 'sent' || offer.status === 'accepted'),
  )
  const loserIds = new Set(lostToLock.map((offer) => offer.request_id))
  /* A loser with a second acceptance still open stays payable (docs/04 A.9:
     the first to be paid wins, others keep their options until then). */
  const loserStillAccepted = new Set(
    snapshot.offers
      .filter(
        (offer) =>
          loserIds.has(offer.request_id) &&
          offer.status === 'accepted' &&
          !lostToLock.some((lost) => lost.id === offer.id),
      )
      .map((offer) => offer.request_id),
  )
  const revertedLosers = snapshot.requests
    .filter(
      (row) =>
        loserIds.has(row.id) &&
        !loserStillAccepted.has(row.id) &&
        row.status === 'accepted_awaiting_payment',
    )
    .map((row) => row.id)
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => {
      if (row.id === requestId) return updated
      if (revertedLosers.includes(row.id) && row.status === 'accepted_awaiting_payment') {
        return { ...row, status: 'searching' as const, updated_at: now() }
      }
      return row
    }),
    offers: snapshot.offers.map((offer) => {
      if (offer.request_id === requestId) {
        if (offer.id === updated.locked_offer_id) return offer
        if (offer.status === 'sent' || offer.status === 'accepted') {
          return { ...offer, status: 'superseded' as const, responded_at: now() }
        }
        return offer
      }
      if (
        offer.acceptor_trip_id === accepted.acceptor_trip_id &&
        (offer.status === 'sent' || offer.status === 'accepted')
      ) {
        return { ...offer, status: 'superseded' as const, responded_at: now() }
      }
      return offer
    }),
  })
  logActivity('swap_locked', { offer: updated.locked_offer_id }, { type: 'swap_request', id: requestId })
  trackEvent('swap_locked', {})
  /* A request losing its awaiting-payment acceptance is a transition of its
     own (docs/11: every transition writes an activity_log row). Reuses the
     existing `someone_faster` action + meta shape — a new action would need
     chip/label/details keys in both catalogs (L10, single writer). */
  for (const loserId of revertedLosers) {
    logActivity(
      'someone_faster',
      { trip: accepted.acceptor_trip_id },
      { type: 'swap_request', id: loserId },
    )
  }
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

/** The journey ended with nobody swapping: `searching ──> expired` (docs/03),
    and nothing was ever charged (rule 2). A request still waiting for payment
    expires on the same edge — paying after the train has left would lock a
    swap nobody can physically make. Offers go with it so the acceptor's screen
    stops promising a journey that is over. */
export function expireRequest(requestId: string): SwapRequest | undefined {
  const request = getRequest(requestId)
  if (!request) return undefined
  if (request.status !== 'searching' && request.status !== 'accepted_awaiting_payment') {
    return undefined
  }
  const updated: SwapRequest = { ...request, status: 'expired', updated_at: now() }
  commit({
    ...ensureLoaded(),
    requests: snapshot.requests.map((row) => (row.id === requestId ? updated : row)),
    offers: snapshot.offers.map((offer) => {
      if (offer.request_id !== requestId) return offer
      if (offer.status === 'sent' || offer.status === 'accepted') {
        return { ...offer, status: 'expired' as const }
      }
      return offer
    }),
  })
  logActivity('request_expired', {}, { type: 'swap_request', id: requestId })
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

/** Fixture attributes for the stand-in requester, so the acceptor filters have
    something real to test against. The coach is deliberately NOT the local
    trip's, which is what makes "Same coach only" visibly do something. */
const DEMO_INCOMING = {
  is_woman: true,
  is_family: true,
  coach: 'B1',
} as const

export function incomingFor(tripId: string): IncomingRequest | undefined {
  const state = ensureLoaded()
  const trip = getTrip(tripId)
  if (!trip || !trip.open_to_swap) return undefined
  const passenger = trip.passengers[0]
  if (!passenger || passenger.status !== 'CNF') return undefined

  /* The acceptor's own filters (docs/04 B2), applied here because this is the
     one place the traveller really IS the acceptor. Until this existed, all
     five toggles on the Settings screen were written and never read — a safety
     filter that filtered nothing. They gate NEW requests only: a request
     already answered stays on screen even if the filter is switched on
     afterwards ("You will not get new requests while paused" — settings.pauseBody). */
  const response = state.incoming[tripId] ?? 'none'
  if (response === 'none') {
    const prefs = settings()
    if (prefs.paused) return undefined
    /* docs/03 abuse limits on the acceptor's own board: a traveller who backed
       out 3 times in 30 days is hidden from matches, so no new request arrives
       for them to answer; and the account stops at its own daily inbound cap
       (the Settings switch's other half). Both gate NEW rows only, like the
       filters above. */
    if (hiddenForAbuse(tripId)) return undefined
    if (receivedTodayForUser() >= prefs.max_requests_per_day) return undefined
    if (prefs.women_only && !DEMO_INCOMING.is_woman) return undefined
    if (prefs.families_only && !DEMO_INCOMING.is_family) return undefined
    if (prefs.same_coach_only && normalizeCoach(DEMO_INCOMING.coach) !== normalizeCoach(passenger.coach)) {
      return undefined
    }
  }

  return {
    id: `in_${tripId}`,
    trip_id: tripId,
    requester_name: DEMO_INCOMING_NAME,
    requester_is_woman: DEMO_INCOMING.is_woman,
    requester_is_family: DEMO_INCOMING.is_family,
    requester_coach: DEMO_INCOMING.coach,
    give_berth: passenger.berth_type,
    /* What the requester hands over — demo pool picks the opposite. */
    get_berth: passenger.berth_type === 'UB' ? 'LB' : 'UB',
    reason_key: 'request.reasons.family',
    state: response,
  }
}

export function respondToIncoming(tripId: string, response: IncomingResponse): IncomingRequest | undefined {
  const current = incomingFor(tripId)
  if (!current) return undefined
  commit({ ...ensureLoaded(), incoming: { ...snapshot.incoming, [tripId]: response } })
  /* Idempotent: a second tap on the same answer is not a second event, so it
     must not re-log or re-drive (the buttons are hidden after the first, but
     the function is also called by tests and any future caller). */
  if (current.state === response) return incomingFor(tripId)
  /* docs/03: the FIRST acceptance is what moves `searching` to
     `accepted_awaiting_payment`, and docs/04 A.9's "Someone says yes → Pay ₹99"
     reads the request from there. This function used to write only the
     incoming map — while logging `offer_accepted` — so the log claimed an
     acceptance the state machine had never seen: the offer stayed `sent`, the
     request stayed `searching`, and no real tap could ever reach the pay
     screen. The board answers for one trip; offers are per (request, trip),
     so drive this trip's open offer too. A trip with no offer behind it (the
     stand-in board, filters, demo data) behaves exactly as before. */
  const offer =
    response === 'backed_out'
      ? openOfferForTrip(tripId, ['accepted'])
      : openOfferForTrip(tripId, ['sent'])
  if (response === 'accepted') {
    const accepted = offer ? acceptOffer(offer.id) : undefined
    if (!accepted?.offer) {
      logActivity('offer_accepted', { side: 'acceptor', trip: tripId }, { type: 'booking', id: tripId })
      trackEvent('offer_accepted', { side: 'acceptor' })
    }
  } else if (response === 'declined' || response === 'backed_out') {
    /* Declining a sent offer closes it; backing out of an accepted one also
       returns the request to `searching` when nothing else is awaiting
       payment (docs/04 B.4 — "can back out until paid"). */
    if (offer) declineOffer(offer.id)
    if (response === 'declined' && !offer) {
      logActivity('offer_declined', { side: 'acceptor', trip: tripId }, { type: 'booking', id: tripId })
      trackEvent('offer_declined', { side: 'acceptor' })
    }
    if (response === 'backed_out') {
      logActivity('acceptor_backed_out', { trip: tripId }, { type: 'booking', id: tripId })
    }
  } else if (response === 'faster') {
    logActivity('someone_faster', { trip: tripId }, { type: 'booking', id: tripId })
  }
  return incomingFor(tripId)
}

/** This trip's oldest offer in one of `statuses` — the board answers for the
    trip, and when several requests have asked, the one waiting longest is the
    one a person standing in the aisle would be looking at first. Offers carry
    no requester identity beyond their request, so nothing finer is knowable
    here. `undefined` means the stand-in board: nothing to move, nothing to
    close. */
function openOfferForTrip(tripId: string, statuses: readonly SwapOffer['status'][]): SwapOffer | undefined {
  return ensureLoaded().offers
    .filter((offer) => offer.acceptor_trip_id === tripId && statuses.includes(offer.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
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
  | 'waitlist_chart'
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

/* Pure: `updates` is a function of exactly three inputs — the requests state,
   the app state (trips + wallet) and the clock. It reads no module state of its
   own, which is the property that lets a component derive it from the snapshots
   its subscription returns (see `unreadUpdatesFor`) rather than from the live
   store. `at` is a parameter rather than an internal `Date.now()` so the same
   inputs always give the same rows. */
function updatesFrom(
  state: RequestsState,
  app: Pick<AppState, 'trips' | 'wallet'>,
  at: number,
): UpdateRow[] {
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
        created_at: new Date(at).toISOString(),
      })
    } else if (response === 'declined') {
      rows.push({
        id: `u_in_${tripId}`,
        kind: 'incoming_declined',
        request_id: null,
        trip_id: tripId,
        created_at: new Date(at).toISOString(),
      })
    } else if (response === 'faster') {
      rows.push({
        id: `u_in_${tripId}`,
        kind: 'incoming_faster',
        request_id: null,
        trip_id: tripId,
        created_at: new Date(at).toISOString(),
      })
    }
  }
  /* Chart is out (docs/04 growth loop): one row per trip whose chart flipped. */
  for (const trip of app.trips) {
    if (!trip.chart_prepared) continue
    /* The reader for "tell me when my berth is confirmed" (docs/04 A4). The
       chart flip is the only confirmation-ish moment a device gets — automatic
       PNR lookup is out of scope (docs/01), so a waitlisted ticket is still
       waitlisted when the chart is drawn. The row then says what the ticket
       actually says, instead of inviting a swap the traveller cannot make. */
    if (trip.reminder_on && trip.passengers[0]?.status !== 'CNF') {
      rows.push({
        id: `u_wl_${trip.id}`,
        kind: 'waitlist_chart',
        request_id: null,
        trip_id: trip.id,
        created_at: trip.created_at,
      })
      continue
    }
    rows.push({
      id: `u_chart_${trip.id}`,
      kind: 'chart_out',
      request_id: null,
      trip_id: trip.id,
      created_at: trip.created_at,
    })
  }
  /* Credit added + expiring (docs/04 notifications, rule 4: 12-month life). */
  for (const tx of app.wallet) {
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

/** Every update, read from the live stores. For imperative callers. */
export function updates(): UpdateRow[] {
  return updatesFrom(ensureLoaded(), getSnapshot(), Date.now())
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
  return unreadUpdatesFor(getSnapshot(), ensureLoaded(), Date.now())
}

/**
 * The same rows, but derived from snapshots the caller already holds.
 *
 * This exists because the render path must not read the live stores. The store
 * hydrates from `localStorage` at module load, so by the time React hydrates a
 * component the live state is already populated — while `getServerSnapshot()`
 * deliberately returns an empty state so the first client render matches the
 * server's HTML. A render that calls `unreadUpdates()` therefore renders real
 * data where the server rendered none, and React throws the whole tree away:
 *
 *   Error: Hydration failed because the server rendered HTML didn't match the
 *   client.  + aria-label="Swaps, 2 new"  - aria-label="Swaps"
 *
 * Passing the snapshots in keeps the two sides equal by construction, and the
 * subscription's post-hydration re-render then swaps in the real count — which
 * is the designed behaviour, not a workaround.
 */
export function unreadUpdatesFor(
  app: Pick<AppState, 'trips' | 'wallet' | 'seen'>,
  requests: RequestsState,
  at: number,
): UpdateRow[] {
  return updatesFrom(requests, app, at).filter(
    (row) => app.seen[updateSeenKey(row.id)] !== true,
  )
}
