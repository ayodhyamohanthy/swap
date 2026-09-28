/* SeatSwap matching — pure rankMatches() (docs/08 Matching, docs/04-A step 6).
   Candidates = same train_no + journey_date + class, overlapping from/to
   segments, status CNF, not blocked, acceptor not paused and inside their
   daily limit, filters (women only / families only / same coach) respected,
   berth type in the requester's choices. Score = choice rank (1st 50 / 2nd 35
   / 3rd 20) + same coach 10 + keep-together fit 10 + acceptor rating 0-10.
   Quota berths (SS/LD/HP) show only to people who qualify. Pure: no I/O. */

import { RESTRICTED_QUOTAS, type BerthType, type Quota } from './pnr'

export type RequesterSpec = {
  train_no: string
  journey_date: string
  class: string
  from_code: string
  to_code: string
  /** Ranked 1st/2nd/3rd berth wishes (1-3 entries). */
  choices: BerthType[]
  same_coach: boolean
  keep_together: boolean
  /** Requester's own coach (for the same-coach bonus). */
  coach: string | null
  /** Requester's quota (quota-restricted offers need a matching quota). */
  quota: Quota
  /** Flags the acceptor women-only / families-only filters check. */
  requester_is_woman?: boolean
  requester_is_family?: boolean
  /** Group size when keep_together is on (default 1). */
  group_size?: number
  /** Outgoing requests already sent today (docs/03: max 10/day). */
  sent_today?: number
}

export type CandidateSpec = {
  id: string
  user_id: string
  train_no: string
  journey_date: string
  class: string
  from_code: string
  to_code: string
  coach: string | null
  berth_no: string | null
  berth_type: BerthType
  status: 'CNF' | 'RAC' | 'WL' | 'CAN'
  quota: Quota
  /** "I'm open to swap" must be on (docs/04-B step 1). */
  open_to_swap: boolean
  rating: number
  paused: boolean
  /** Inbound requests received today vs acceptor cap (default 3). */
  received_today?: number
  max_requests_per_day?: number
  women_only: boolean
  families_only: boolean
  same_coach_only: boolean
  /** Requester attribute flags the acceptor filters check. */
  requester_is_woman?: boolean
  requester_is_family?: boolean
  /** Seats the acceptor can move together (keep-together fit). */
  together_seats?: number
  blocked?: boolean
  /** Backed out 3x in 30 days: hidden from matches for 30 days (docs/03). */
  hidden_for_abuse?: boolean
}

export type RankedMatch = { id: string; score: number; choice_rank: 1 | 2 | 3 }

export const MAX_OUTGOING_PER_DAY = 10 as const
export const DEFAULT_MAX_INBOUND_PER_DAY = 3 as const

const RANK_POINTS = [50, 35, 20] as const
const SAME_COACH_POINTS = 10 as const
const KEEP_TOGETHER_POINTS = 10 as const

function normCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase()
}

function normTrain(train: string | null | undefined): string {
  return String(train ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

/**
 * Journey segments overlap when the two travellers ride a leg together.
 *
 * Two codes are enough to prove an overlap when they share a *boarding* point
 * or an *alighting* point: both are then on the train between that code and
 * their own other end. A single shared code is NOT enough when one journey
 * ends exactly where the other begins (my `to` = your `from`, or the reverse)
 * — they share a platform, never a leg. Offering a swap to someone who gets
 * off as you get on is the false positive this guards (docs/04 A6 asks for an
 * "overlapping journey", not a connecting one).
 *
 * Known limit: with no station-order table we cannot see two interior
 * segments that overlap without sharing a code (BRC→ST inside MMCT→NDLS), so
 * those stay unmatched rather than guessed.
 */
export function segmentsOverlap(
  req: { from_code: string; to_code: string },
  cand: { from_code: string; to_code: string },
): boolean {
  const reqFrom = normCode(req.from_code)
  const reqTo = normCode(req.to_code)
  const candFrom = normCode(cand.from_code)
  const candTo = normCode(cand.to_code)
  const mine = new Set([reqFrom, reqTo].filter(Boolean))
  const theirs = new Set([candFrom, candTo].filter(Boolean))
  if (mine.size === 0 || theirs.size === 0) return true
  const shared = [...mine].filter((code) => theirs.has(code))
  if (shared.length === 0) return false
  const touchOnly =
    shared.length === 1 &&
    ((reqFrom === shared[0] && candTo === shared[0]) || (reqTo === shared[0] && candFrom === shared[0]))
  return !touchOnly
}

function clampRating(rating: unknown): number {
  const n = typeof rating === 'number' && Number.isFinite(rating) ? rating : 0
  return Math.min(10, Math.max(0, n))
}

/** Coach codes compare case- and space-insensitively ("b3" == "B3"). */
export function normalizeCoach(value: string | null | undefined): string {
  return normCode(value)
}

/** Pure rankMatches(): filter hard rules, then score highest first. */
export function rankMatches(request: RequesterSpec, candidates: CandidateSpec[]): RankedMatch[] {
  if (request.choices.length === 0) return []
  if ((request.sent_today ?? 0) >= MAX_OUTGOING_PER_DAY) return []
  const train = normTrain(request.train_no)
  const reqDate = request.journey_date.trim()
  const reqClass = normCode(request.class)
  const out: RankedMatch[] = []

  for (const cand of candidates) {
    if (normTrain(cand.train_no) !== train) continue
    if (cand.journey_date.trim() !== reqDate) continue
    if (normCode(cand.class) !== reqClass) continue
    if (!segmentsOverlap(request, cand)) continue
    if (cand.status !== 'CNF') continue
    if (!cand.open_to_swap) continue
    if (cand.blocked || cand.hidden_for_abuse || cand.paused) continue
    const inboundCap = cand.max_requests_per_day ?? DEFAULT_MAX_INBOUND_PER_DAY
    if ((cand.received_today ?? 0) >= inboundCap) continue
    if (cand.women_only && !request.requester_is_woman) continue
    if (cand.families_only && !request.requester_is_family) continue
    if (request.same_coach && normalizeCoach(cand.coach) !== normalizeCoach(request.coach)) continue
    if (cand.same_coach_only && normalizeCoach(cand.coach) !== normalizeCoach(request.coach)) continue
    // Restricted quotas (SS/LD/HP) only go to travellers who qualify.
    if ((RESTRICTED_QUOTAS as readonly string[]).includes(cand.quota) && cand.quota !== request.quota) continue

    const rank = request.choices.indexOf(cand.berth_type)
    if (rank < 0) continue

    let score = RANK_POINTS[rank] ?? 0
    if (normalizeCoach(cand.coach) && normalizeCoach(cand.coach) === normalizeCoach(request.coach)) score += SAME_COACH_POINTS
    if (request.keep_together && (cand.together_seats ?? 1) >= (request.group_size ?? 1)) score += KEEP_TOGETHER_POINTS
    score += clampRating(cand.rating)
    out.push({ id: cand.id, score, choice_rank: (rank + 1) as 1 | 2 | 3 })
  }

  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
  return out
}
