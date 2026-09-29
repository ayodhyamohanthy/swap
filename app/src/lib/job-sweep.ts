/* SeatSwap device-side cron (docs/08). The server wrappers in `@/server/jobs`
   need a service-role key — `wallet_tx` has no INSERT policy for `authenticated`
   and `notifications` only SELECT/UPDATE, so a job running on a traveller's
   token cannot write anything. Until a backend exists the device runs its own
   due jobs, and each effect goes through the SAME transition the traveller-facing
   flows use, so a job can never create a state a user could not reach.

   What is deliberately NOT here:
   - Credit expiry. `store.creditPaise()` and `payments.spendableCreditPaise()`
     already drop rows past `expires_at` at read time, so a lapsed grant is
     worth nothing without a ledger write — and minting a compensating negative
     row would subtract it twice. The 30-day reminder is the Updates list's
     `needsCreditReminder` rows (requests.ts), which read the same expiry.
   - The unused ₹199 group cover (server/jobs.ts). `store.credit()` accepts only
     the fixed ₹50/₹99 values, so the device cannot mint a 19900 credit; that
     conversion needs a ledger kind first, and it belongs to the server job.

   Timing anchors: a PNR carries a journey *date*, never an arrival timestamp, so
   "the journey ended" and "12 h after arrival" are both measured from the end of
   that local calendar day. A trip with no date is never guessed into either. */

import { isRequestExpired, shouldAutoConfirm, shouldNotifyChartTime } from './jobs'
import { resolveConfirmations } from './outcomes'
import { expireRequest, listRequests } from './requests'
import { applyResolution } from './settle'
import { confirmationsFor, listTrips, localDateKey, setChartPrepared } from './store'

export interface SweepReport {
  /** Requests the journey overtook with no swap (docs/03: nothing charged). */
  expired: string[]
  /** Locked swaps settled as confirmed because a side stayed silent (docs/03). */
  autoConfirmed: string[]
  /** Trips whose chart flipped false -> true (docs/08 growth loop 4). */
  chartsOut: string[]
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Start of the day AFTER the journey date, local time — the end of the
    journey day. Null for a missing or malformed date (never guessed). */
export function journeyEndMs(journeyDate: string | null): number | null {
  if (!journeyDate || !DATE_KEY.test(journeyDate)) return null
  const [year, month, day] = journeyDate.split('-').map(Number)
  const end = new Date(year, month - 1, day + 1)
  return end.getTime()
}

/** One pass of the due jobs. Idempotent: every effect moves state out of the
    predicate that selected it, so a second sweep in the same minute is a no-op. */
export function runDueJobs(nowMs: number = Date.now()): SweepReport {
  const report: SweepReport = { expired: [], autoConfirmed: [], chartsOut: [] }

  const journeyEndFor = (tripId: string): number | null =>
    journeyEndMs(listTrips().find((trip) => trip.id === tripId)?.journey_date ?? null)

  /* `searching ── journey ends ──> expired`. An accepted request nobody paid
     expires on the same edge: rule 2 means nothing was charged, and paying for
     a train that has already arrived would lock an impossible swap. */
  for (const request of listRequests()) {
    if (request.status !== 'searching' && request.status !== 'accepted_awaiting_payment') continue
    const end = journeyEndFor(request.trip_id)
    if (end === null || !isRequestExpired(nowMs, end)) continue
    if (expireRequest(request.id)) report.expired.push(request.id)
  }

  /* `locked`, one side silent 12 h after arrival → treated as confirmed.
     Settled through `applyResolution`, so the acceptor's ₹50 (rule 3) is
     written by the same code path as a manual "we swapped". */
  for (const request of listRequests()) {
    if (request.status !== 'locked') continue
    const answered = confirmationsFor(request.id).length
    if (answered === 2) continue
    const end = journeyEndFor(request.trip_id)
    if (end === null || !shouldAutoConfirm(nowMs, end, answered as 0 | 1)) continue
    const result = applyResolution(request.id, resolveConfirmations('swapped', 'swapped'))
    if (result.request?.status === 'confirmed') report.autoConfirmed.push(request.id)
  }

  /* Chart-is-out flip: the device has no chart feed, so the honest local rule
     is "the journey day has begun". `setChartPrepared` writes the activity row
     and the Updates list renders design 7c from it. */
  const today = localDateKey(new Date(nowMs))
  for (const trip of listTrips()) {
    if (trip.chart_prepared) continue
    if (!trip.journey_date || trip.journey_date > today) continue
    if (!shouldNotifyChartTime(trip.chart_prepared, true)) continue
    if (setChartPrepared(trip.id, true)) report.chartsOut.push(trip.id)
  }

  return report
}
