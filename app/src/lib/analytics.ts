/* SeatSwap analytics events (docs/08). Names match activity_log actions
   plus share_clicked(platform), install_prompt_accepted, first_screen_viewed,
   swap_done_viewed. Dev: console.debug only. Prod: events stay on-device unless
   the traveller opts in, in which case `lib/posthog.ts` forwards them to
   PostHog (docs/12 §7). Either way the local ring buffer is written first, so
   turning forwarding on can never lose a metric. */

import { enqueue } from './posthog'

export const ANALYTICS_EVENTS = [
  'sign_in', 'pnr_added', 'request_sent', 'offer_accepted', 'offer_declined',
  'payment_created', 'payment_paid', 'payment_failed', 'swap_locked',
  'swap_done_viewed',
  'message_flagged', 'confirmation', 'dispute_opened', 'dispute_resolved',
  'credit_added', 'credit_used', 'credit_expired', 'report_created',
  'user_blocked', 'admin_action', 'share_clicked', 'install_prompt_accepted',
  'first_screen_viewed',
] as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number]

export interface AnalyticsPayload {
  event: AnalyticsEvent
  meta?: Record<string, string | number | boolean | null>
}

function isDev(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env
    if (typeof env?.DEV === 'boolean') return env.DEV
  } catch { /* non-vite runtime */ }
  try {
    return (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.NODE_ENV !== 'production'
  } catch {
    /* Fail CLOSED. This switch gates `console.debug` of caller-supplied event
       meta — ids, amounts, ranks — so an unreadable environment must not be
       read as permission to log. The old `return true` meant the one runtime
       where NEITHER env source could be read was the one that logged, which is
       the opposite of the safe default for a privacy-adjacent switch. */
    return false
  }
}

/** Debug in dev, silent no-network no-op in prod unless the traveller opts in
 *  (docs/08 low cost, docs/12 §7). The forwarder is best-effort and must never
 *  be able to break the call it is observing, so it is wrapped: `trackEvent` is
 *  called from state transitions, and a throw here would roll back a swap. */
export function trackEvent(event: AnalyticsEvent, meta: AnalyticsPayload['meta'] = {}): void {
  if (isDev()) console.debug(`[analytics] ${event}`, meta)
  const row: LoggedEvent = { event, ts: Date.now(), meta }
  appendEvent(row)
  try {
    enqueue(row)
  } catch {
    /* Queueing is analytics, not product: swallow and carry on. */
  }
}

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(value)
}

/* ---- on-device event log (docs/08 "track from day 1") ----
   The funnel metrics (PNRs added, requests sent, acceptances, paid swaps,
   confirmed swaps, shares per swap, repeat trips, credit redeemed) are
   recorded here until a server log endpoint exists. Capped ring buffer in
   localStorage; Admin overview aggregates from it. No network, no PII beyond
   what the caller puts in meta (keep it to ids and amounts). */

export interface LoggedEvent {
  event: AnalyticsEvent
  ts: number
  meta: Record<string, string | number | boolean | null>
}

const LOG_KEY = 'seatswap.analytics.v1'
const LOG_CAP = 500

function readLog(): LoggedEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is LoggedEvent =>
        typeof row === 'object' && row !== null && isAnalyticsEvent((row as { event: unknown }).event),
    )
  } catch {
    return []
  }
}

function appendEvent(row: LoggedEvent): void {
  if (typeof window === 'undefined') return
  try {
    const next = [...readLog(), row].slice(-LOG_CAP)
    window.localStorage.setItem(LOG_KEY, JSON.stringify(next))
  } catch {
    /* private mode: metrics stay in memory-less dev debug */
  }
}

/** All logged events, oldest first. */
export function readEvents(): LoggedEvent[] {
  return readLog()
}

/** Count one event since a timestamp (for funnel rates). */
export function countEvents(event: AnalyticsEvent, sinceMs = 0): number {
  return readLog().filter((row) => row.event === event && row.ts >= sinceMs).length
}

/** Test hook: clear the on-device log between cases. */
export function resetAnalyticsForTests(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LOG_KEY)
  } catch {
    /* ignore */
  }
}
