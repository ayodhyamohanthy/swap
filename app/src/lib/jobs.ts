/* SeatSwap scheduled-job date cores — pure, no I/O (docs/08).
   Thin server wrappers live in `@/server/jobs`. Tested in admin.test.ts. */

export const AUTO_CONFIRM_SILENT_HOURS = 12 as const
export const CREDIT_VALIDITY_MONTHS = 12 as const
export const CREDIT_REMINDER_DAYS = 30 as const
const DAY_MS = 24 * 60 * 60 * 1000

/** Expire requests whose journey ended (journey end-of-day < now). */
export function isRequestExpired(nowMs: number, journeyEndMs: number): boolean {
  return nowMs > journeyEndMs
}

/** Auto-confirm a locked swap 12h after arrival when a side is silent. */
export function shouldAutoConfirm(nowMs: number, arrivalMs: number, answeredCount: 0 | 1 | 2): boolean {
  if (answeredCount === 2) return false
  return nowMs - arrivalMs >= AUTO_CONFIRM_SILENT_HOURS * 60 * 60 * 1000
}

/** Credit expires 12 months after it is earned (rule 4). */
export function isCreditExpired(nowMs: number, earnedMs: number): boolean {
  const earned = new Date(earnedMs)
  const expiry = new Date(earned)
  expiry.setMonth(expiry.getMonth() + CREDIT_VALIDITY_MONTHS)
  return nowMs >= expiry.getTime()
}

/** 30-day expiry reminder window: within 30 days before expiry, not yet expired. */
export function needsCreditReminder(nowMs: number, expiresAtMs: number): boolean {
  const left = expiresAtMs - nowMs
  return left > 0 && left <= CREDIT_REMINDER_DAYS * DAY_MS
}

/** Chart-time notify: fire once when chart flips false -> true. */
export function shouldNotifyChartTime(prevChart: boolean, nextChart: boolean): boolean {
  return prevChart === false && nextChart === true
}

/** Unused group cover (docs/01, pay.groupUnder): a paid ₹199 trip whose journey
    ended with zero locked/confirmed swaps converts to organiser credit. Only
    the fully-unused case converts — a bundle that covered 1-2 swaps is spent. */
export function isUnusedGroupCover(nowMs: number, journeyEndMs: number, lockedCount: number): boolean {
  return lockedCount === 0 && nowMs > journeyEndMs
}
