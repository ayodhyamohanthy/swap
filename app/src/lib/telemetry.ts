/* SeatSwap telemetry env plumbing — docs/12 §7 + §8, backlog 5 (L9).
 *
 * One analytics backend (PostHog: events, flags, experiments) and one error
 * backend (Sentry: errors only). Neither is adopted through an SDK here:
 * this module reads env and shapes one request, so while no key is set the
 * app behaves exactly as it did before — on-device log, no network call, no
 * new localStorage key, no bundle growth. Cline's note on the lane board
 * asked for precisely this ("a typed env accessor … no SDK import at all
 * until a key exists"); the keyed side is now unblocked because the orgs
 * exist (`skipwait`), which is what that note was waiting for.
 *
 * Both values are PUBLIC by design, which decides where they live. A PostHog
 * project key is embedded in every posthog-js bundle, and a Sentry DSN is a
 * write-only ingest address that likewise ships to the browser — so they are
 * build-time `VITE_*` variables, NOT `wrangler secret put` entries: a
 * Cloudflare secret is a Worker runtime binding and can never reach a client
 * bundle that Vite already inlined. Anything genuinely secret (a PostHog
 * personal query key, a Sentry release-upload token) stays server-side and
 * does not appear in this file.
 *
 * Guardrail (docs/12 §7): analytics meta is ids + amounts. PNR, berth
 * `last4`, names, phone and email never leave the device, and `scrubMeta`
 * enforces that instead of trusting the caller.
 */

/** Env names the app expects. docs/12 §8 is the human-readable key map. */
export const TELEMETRY_ENV_VARS = ['VITE_POSTHOG_KEY', 'VITE_POSTHOG_HOST', 'VITE_SENTRY_DSN'] as const
export type TelemetryEnvVar = (typeof TELEMETRY_ENV_VARS)[number]
export type TelemetryEnv = Partial<Record<TelemetryEnvVar, string>>

/** PostHog Cloud US. EU projects must set `VITE_POSTHOG_HOST`. */
export const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com'

export interface TelemetryConfig {
  /** '' when unset, so a caller must check `posthogEnabled` rather than guess. */
  posthogKey: string
  posthogHost: string
  posthogEnabled: boolean
  sentryDsn: string
  sentryEnabled: boolean
}

export type TelemetryMeta = Record<string, string | number | boolean | null | undefined>

/** Meta values are ids, amounts and enums — nothing else is forwarded. */
const BLOCKED_META_KEY = /(^|_)(pnr|last4|name|full_name|phone|mobile|email|contact|address|ticket|dob|aadhaar|pan)(_|$)/i

const BLOCKED_META_VALUE = [
  /^\+?\d{10}$/, // PNR or phone number
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/, // email
]

/** Free text is a support artefact, not a metric (and could be anything). */
const MAX_VALUE_LENGTH = 120

/** A 10-digit integer is a PNR or a phone; our amounts are 3-4 digits. */
function looksLikeAnIdentifier(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1e9 && value < 1e10
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url
  } catch {
    return null
  }
}

/** A DSN is `https://<public key>@<org>.ingest.sentry.io/<project id>`: an
 *  http URL carrying credentials and a numeric project path. Anything else is
 *  a key in the wrong variable, and error reporting must not half-work — a
 *  DSN that cannot be parsed would swallow every error silently. */
function isDsn(value: string): boolean {
  const url = httpUrl(value)
  if (url === null || url.username === '') return false
  return /^\/\d+/.test(url.pathname)
}

/** Vite inlines `import.meta.env` at build time; read it defensively and fall
 *  back to `process.env` so the same module also answers under bare node
 *  (scripts, tests) instead of loading with keys silently absent. */
export function readTelemetryEnv(): TelemetryEnv {
  const out: TelemetryEnv = {}
  const sources: Array<Record<string, unknown> | undefined> = []
  try {
    sources.push((import.meta as unknown as { env?: Record<string, unknown> }).env)
  } catch {
    /* non-Vite transform: import.meta.env does not exist here */
  }
  sources.push((globalThis as unknown as { process?: { env?: Record<string, unknown> } }).process?.env)
  for (const source of sources) {
    if (!source) continue
    for (const name of TELEMETRY_ENV_VARS) {
      if (out[name] !== undefined) continue // build-time value wins
      const value = source[name]
      if (typeof value === 'string' && value.trim() !== '') out[name] = value.trim()
    }
  }
  return out
}

export function telemetryConfig(raw: TelemetryEnv = readTelemetryEnv()): TelemetryConfig {
  const posthogKey = (raw.VITE_POSTHOG_KEY ?? '').trim()
  // Only the origin survives: the capture path is appended, so a host var
  // carrying a path or trailing slash cannot double up the URL.
  const host = httpUrl((raw.VITE_POSTHOG_HOST ?? '').trim())?.origin ?? POSTHOG_DEFAULT_HOST
  const sentryDsn = (raw.VITE_SENTRY_DSN ?? '').trim()
  return {
    posthogKey,
    posthogHost: host,
    posthogEnabled: posthogKey !== '',
    sentryDsn,
    sentryEnabled: isDsn(sentryDsn),
  }
}

/** Drop everything that must not reach a third party. Allow-by-default within
 *  ids/amounts/enums, deny on PII-shaped keys and values, and deny free text —
 *  a denylist would have to predict every future caller, and this list is the
 *  one thing that cannot be caught later. */
export function scrubMeta(meta: TelemetryMeta = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || value === undefined) continue
    if (BLOCKED_META_KEY.test(key)) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '' || trimmed.length > MAX_VALUE_LENGTH) continue
      if (BLOCKED_META_VALUE.some((re) => re.test(trimmed))) continue
      out[key] = trimmed
      continue
    }
    if (looksLikeAnIdentifier(value)) continue
    out[key] = value
  }
  return out
}

const ANON_KEY = 'seatswap.anon.v1'
let memoryAnonId = ''

/** Anonymous device id: no user id, no email, no cross-site identity — it only
 *  lets repeated events from one device group, and it is created lazily so a
 *  keyless app writes nothing at all. */
function anonymousId(): string {
  try {
    const existing = window.localStorage.getItem(ANON_KEY)
    if (existing) return existing
    const id = `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    window.localStorage.setItem(ANON_KEY, id)
    return id
  } catch {
    /* private mode: keep one id for this page life rather than dropping events */
    if (memoryAnonId === '') memoryAnonId = `anon_${Math.random().toString(36).slice(2)}`
    return memoryAnonId
  }
}

/** The exact PostHog `/capture/` payload, as a pure function so the wire shape
 *  is testable without a key and without the network. */
export function posthogCaptureBody(
  config: TelemetryConfig,
  event: string,
  meta: TelemetryMeta,
  distinctId: string,
  ts: number,
): Record<string, unknown> {
  return {
    api_key: config.posthogKey,
    event,
    distinct_id: distinctId,
    timestamp: new Date(ts).toISOString(),
    properties: { ...scrubMeta(meta), $lib: 'seatswap-pwa' },
  }
}

/** Fire one event. No key configured ⇒ no request, no storage write. Failure
 *  is swallowed by design: telemetry must never break a user action (the
 *  on-device log in `analytics.ts` remains the record either way). */
export async function forwardEvent(event: string, meta: TelemetryMeta = {}): Promise<void> {
  const config = telemetryConfig()
  if (!config.posthogEnabled) return
  try {
    await fetch(`${config.posthogHost}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posthogCaptureBody(config, event, meta, anonymousId(), Date.now())),
      keepalive: true,
    })
  } catch {
    /* offline, blocked, 5xx — none of them are the user's problem */
  }
}

/** Test hook: forget the remembered device id (never persisted in tests). */
export function resetTelemetryForTests(): void {
  memoryAnonId = ''
  try {
    window.localStorage.removeItem(ANON_KEY)
  } catch {
    /* ignore */
  }
}

/** Test hook: the storage key, so a test can prove a keyless app writes none. */
export const TELEMETRY_ANON_STORAGE_KEY = ANON_KEY
