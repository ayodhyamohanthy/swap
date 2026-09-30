/* SeatSwap → PostHog event forwarding (docs/12 §7).
 *
 * WHY THIS FILE EXISTS. `lib/analytics.ts` records 23 event names and 29 call
 * sites, all of them on-device, and has never touched the network. docs/12 §7
 * picked PostHog Cloud as the single analytics backend and the team confirmed a
 * $50k startup credit, so the events were being paid for and not collected.
 *
 * FOUR PROPERTIES, IN ORDER OF IMPORTANCE.
 *
 * 1. **Off until the traveller says otherwise.** `consentGranted()` is the only
 *    thing that gates a send, and it defaults to false. There is no
 *    configuration that turns this on for everyone: a credit is not a mandate,
 *    and "we have $50k of analytics credit" is not consent to send a railway
 *    passenger's behavioural data to a third party.
 *
 * 2. **Nothing leaves that rule 13 forbids.** PNR, name, phone, email and
 *    ticket photo never appear, and `scrub()` enforces that rather than
 *    trusting callers: today's 29 call sites all send ids, amounts and enums,
 *    but the allow-list is a property of the module, not of today's callers.
 *    A future call site that adds `pnr_last4` gets dropped, not forwarded.
 *
 * 3. **No SDK, no bundle growth, no key needed to build.** The app must keep
 *    building and serving with zero keys (wrangler.toml), so the token is read
 *    from `VITE_POSTHOG_KEY` and everything returns early when it is unset.
 *    PostHog's browser capture is a public project token (`phc_…`) against a
 *    write-only ingest endpoint, so shipping it in the bundle exposes nothing
 *    secret — which is why this is direct-to-PostHog and not a proxy.
 *
 * 4. **Batched, never blocking, never on the render path.** `trackEvent` stays
 *    synchronous and cannot await a network call; a flush is a side effect that
 *    can fail silently. Events stay in the existing localStorage ring buffer
 *    whatever happens, so turning this on can never lose a funnel metric.
 *
 * NO SESSION RECOVERY OR REPLAY. Both cost credits that docs/12 §7 says are
 * not eligible, and replay records the content of chat messages.
 */

import type { AnalyticsEvent, LoggedEvent } from './analytics'

/* ---- configuration ---- */

/* The two env reads below are STATIC member expressions on purpose.
 *
 * A first version had a shared `readEnv('VITE_POSTHOG_KEY')` — a dynamic
 * lookup — which Vite cannot replace, because it only substitutes literal
 * `import.meta.env.X` member expressions. The build inlined the string
 * `VITE_POSTHOG_KEY` into the bundle and the read returned undefined forever:
 * the key could have been configured correctly and the forwarder would still
 * never have sent anything. The symptom is invisible in a keyless build, which
 * is exactly the case this repo ships, so only reading the built asset caught
 * it. `tests/posthog-forward.test.ts` now pins the static form, because the
 * dynamic one typechecks, tests, and builds — and silently does nothing.
 *
 * Testability comes from `setConfigForTests` overriding the resolved value,
 * not from an indirection the bundler has to see through. */
let testKey: string | null = null
let testHost: string | null = null

/** Test hook: override the resolved key/host. `null` restores the real env. */
export function setConfigForTests(key: string | null, host: string | null = null): void {
  testKey = key
  testHost = host
}

export function posthogKey(): string {
  if (testKey !== null) return testKey.trim()
  const value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_POSTHOG_KEY
  return typeof value === 'string' ? value.trim() : ''
}

/** Ingest host. PostHog Cloud is US by default; a self-hosted or EU project
 *  needs this changed, which is why it is a build var and not a constant. */
export function posthogHost(): string {
  if (testHost !== null) return testHost.trim()
  const host = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_POSTHOG_HOST
  const trimmed = typeof host === 'string' ? host.trim() : ''
  return trimmed || 'https://us.i.posthog.com'
}

const CONSENT_KEY = 'seatswap.analytics.consent.v1'
const INSTALL_ID_KEY = 'seatswap.analytics.install.v1'
const QUEUE_KEY = 'seatswap.analytics.queue.v1'
/** The service worker's pages rule is NetworkFirst with a 500-event cap here;
 *    100 keeps a weekend offline from filling the quota with one backlog. */
const QUEUE_CAP = 100
const FLUSH_INTERVAL_MS = 15_000
const BATCH_CAP = 50

/* ---- consent ---- */

/** Whether the traveller opted in. **Absent means no** — that is the whole
 * point, and it is why this is not `!== 'false'`. */
export function consentGranted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(CONSENT_KEY) === 'true'
  } catch {
    /* Private mode, or storage blocked. Fail closed: a switch we cannot read is
       not a switch that is on. */
    return false
  }
}

export function setConsent(granted: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (granted) window.localStorage.setItem(CONSENT_KEY, 'true')
    else window.localStorage.removeItem(CONSENT_KEY)
  } catch {
    /* ignore: forwarding stays off, which is the safe direction */
  }
  /* Turning it off must take effect now, not at the next interval, and must
   * discard anything already queued for sending. */
  if (!granted) clearQueue()
}

/* ---- identity ---- */

/** A random per-install id.
 *
 * NOT the Supabase auth uuid, on purpose: this is behavioural data, and tying
 * it to an account means clearing site data does not separate the two, or
 * re-signing-in on a shared device does. `crypto.randomUUID` where available,
 * with a non-crypto fallback that is still unique enough for a de-duplication
 * key — and a uuid-shaped value, because PostHog's `distinct_id` is
 * best-effort validated as one.
 */
export function installId(): string {
  if (typeof window === 'undefined') return ''
  try {
    const existing = window.localStorage.getItem(INSTALL_ID_KEY)
    if (existing) return existing
    const c = globalThis.crypto
    const id = c && 'randomUUID' in c
      ? c.randomUUID()
      : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`
    window.localStorage.setItem(INSTALL_ID_KEY, id)
    return id
  } catch {
    return ''
  }
}

/* ---- scrubbing (rule 13, docs/12 §7) ---- */

/** Meta keys that may leave the device. Everything is an id, an amount, a
 *  count or a fixed enum — never a value a person typed or was issued. */
const ALLOWED_META_KEYS = new Set([
  'train_no',
  'class',
  'kind',
  'amount_paise',
  'credit_used_paise',
  'state',
  'status',
  'platform',
  'context',
  'matches',
  'capped',
  'rank',
  'side',
  'outcome',
  'action',
  'persisted',
  'reasons',
  'count',
  'free',
  'auto',
])

/**
 * A value check, on top of the key allow-list.
 *
 * The allow-list already drops every rule-13 key name today, so a *second* key
 * check would be pure overlap: a mutation deleting it passes every test in the
 * file, which is how untested "defence in depth" becomes a false claim of
 * safety. It was written, mutation-checked, found untestable, and removed —
 * the allow-list is the key defence and `tests/posthog-forward.test.ts` proves
 * it by naming each rule-13 key.
 *
 * What the allow-list does NOT cover is a legitimate key holding something
 * unsafe: `context: 'my upi is riy@ybl'` has a perfectly allow-listed key and
 * still must not leave the device. That is this line, and it is the one a
 * deletion mutation actually fails.
 */
const FORBIDDEN_VALUE = /@[a-z0-9-]+\.[a-z]{2,}|(?:\+?91[\s-]?)?[6-9]\d{9}/i

export type MetaValue = string | number | boolean | null

/** Keep only allow-listed, non-PII, primitive meta. Exported for tests. */
export function scrub(meta: Record<string, unknown> | undefined): Record<string, MetaValue> {
  const out: Record<string, MetaValue> = {}
  if (!meta) return out
  for (const [key, value] of Object.entries(meta)) {
    if (!ALLOWED_META_KEYS.has(key)) continue
    if (value === null) { out[key] = null; continue }
    if (typeof value === 'string') {
      /* Bounded, and value-checked: a reason or a transcript that slipped into
       * an allow-listed key must not become a data channel by accident. */
      if (value.length > 64) continue
      if (FORBIDDEN_VALUE.test(value)) continue
      out[key] = value
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue
      out[key] = value
    } else if (typeof value === 'boolean') {
      out[key] = value
    }
  }
  return out
}

/** True when this event carries nothing worth sending. Cheap funnel events with
 *  an empty meta are still sent (the count is the metric); this is for events
 *  that are *about* the operator, not the product. */
function isOperatorOnly(event: AnalyticsEvent): boolean {
  return event === 'admin_action' || event === 'user_blocked'
}

/* ---- queue ---- */

function readQueue(): LoggedEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is LoggedEvent =>
        typeof row === 'object' && row !== null && typeof (row as LoggedEvent).event === 'string',
    )
  } catch {
    return []
  }
}

function writeQueue(rows: LoggedEvent[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-QUEUE_CAP)))
  } catch {
    /* Storage full: the events still count locally via the analytics ring. */
  }
}

function clearQueue(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* ignore */
  }
}

/** Queue one event. No-op unless consent, a key, and a sendable event. */
export function enqueue(event: LoggedEvent): void {
  if (!consentGranted()) return
  if (!posthogKey()) return
  if (isOperatorOnly(event.event)) return
  writeQueue([...readQueue(), event])
}

export function queuedCount(): number {
  return readQueue().length
}

/* ---- sending ---- */

type FetchLike = typeof fetch

/** Injectable for tests; defaults to the platform `fetch`. */
let sendImpl: (url: string, body: string, f: FetchLike) => Promise<boolean> = async (
  url,
  body,
  f,
) => {
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    /* Analytics is a nice-to-have; a hung request must not hold a socket. */
    keepalive: true,
  })
  return res.ok
}

/** Test hook. */
export function setSenderForTests(impl: typeof sendImpl): void {
  sendImpl = impl
}

function batch(): { event: string; properties: Record<string, MetaValue>; timestamp: string }[] {
  return readQueue().slice(0, BATCH_CAP).map((row) => ({
    event: row.event,
    properties: scrub(row.meta),
    timestamp: new Date(row.ts).toISOString(),
  }))
}

/**
 * Send up to one batch. Returns how many were accepted, so a caller can loop.
 *
 * Rows are removed from the queue ONLY on success. A failed send keeps them,
 * which means an offline device accumulates rather than loses — the opposite of
 * the outbox's flush-once-and-forget, which is right for a user's own chat
 * message and wrong here.
 */
export async function flush(f: FetchLike = fetch): Promise<number> {
  if (!consentGranted() || !posthogKey()) return 0
  const rows = readQueue()
  if (rows.length === 0) return 0
  const take = rows.slice(0, BATCH_CAP)
  const distinct = installId()
  if (!distinct) return 0
  const url = `${posthogHost().replace(/\/$/, '')}/batch/`
  const body = JSON.stringify({
    api_key: posthogKey(),
    batch: batch(),
    /* Historical-events endpoint: these are events that already happened, so
     * PostHog must not attribute them to "now". */
    historical_migration: false,
    distinct_id: distinct,
    event: '$batch',
  })
  try {
    const ok = await sendImpl(url, body, f)
    if (!ok) return 0
    writeQueue(rows.slice(take.length))
    return take.length
  } catch {
    /* Offline, blocked, quota. Keep the rows; the next flush retries. */
    return 0
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Start the periodic flush. Idempotent, and a no-op unless there is a key and
 *  consent — so the default build never opens a timer. */
export function startForwarding(): void {
  if (typeof window === 'undefined') return
  if (timer !== null) return
  if (!posthogKey() || !consentGranted()) return
  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
  /* Draining on hide/visibilitychange is what makes the data usable: a PWA is
   * backgrounded most of the time, and a 15s interval will not fire there. */
  const drain = () => {
    if (document.visibilityState === 'hidden') return
    void flush()
  }
  window.addEventListener('online', drain)
  document.addEventListener('visibilitychange', drain)
}

/** Stop the periodic flush and detach the listeners. Test hook + teardown. */
export function stopForwarding(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', () => undefined)
    document.removeEventListener('visibilitychange', () => undefined)
  }
}

/** Test hook: reset every piece of forwarding state. */
export function resetForwardingForTests(): void {
  stopForwarding()
  clearQueue()
  if (typeof window === 'undefined') return
  for (const key of [CONSENT_KEY, INSTALL_ID_KEY]) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}
