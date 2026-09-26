/* SeatSwap analytics events (docs/08). Names match activity_log actions
   plus share_clicked(platform), install_prompt_accepted, first_screen_viewed.
   Dev: console.debug only. Prod: no network — caller forwards to the server
   log endpoint when it exists; by default events stay on-device. */

export const ANALYTICS_EVENTS = [
  'sign_in', 'pnr_added', 'request_sent', 'offer_accepted', 'offer_declined',
  'payment_created', 'payment_paid', 'payment_failed', 'swap_locked',
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
  } catch { return true }
}

/** Debug in dev, silent no-network no-op in prod (docs/08 low cost). */
export function trackEvent(event: AnalyticsEvent, meta: AnalyticsPayload['meta'] = {}): void {
  if (isDev()) console.debug(`[analytics] ${event}`, meta)
}

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(value)
}
