/* Telemetry env plumbing (docs/12 §7 + §8, backlog 5): PostHog capture and
 * Sentry config, the PII scrub that guards them, and the promise that a
 * keyless app makes no request and writes no storage at all. */
/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readEvents, trackEvent } from '@/lib/analytics'
import {
  POSTHOG_DEFAULT_HOST,
  TELEMETRY_ANON_STORAGE_KEY,
  TELEMETRY_ENV_VARS,
  forwardEvent,
  posthogCaptureBody,
  resetTelemetryForTests,
  scrubMeta,
  telemetryConfig,
} from '@/lib/telemetry'

const SRC = join(import.meta.dirname, '..', 'src')

afterEach(() => {
  resetTelemetryForTests()
  vi.unstubAllEnvs()
})

describe('telemetry env config', () => {
  it('is fully disabled, and harmless, with no env at all', () => {
    const config = telemetryConfig({})
    expect(config).toMatchObject({
      posthogKey: '',
      posthogHost: POSTHOG_DEFAULT_HOST,
      posthogEnabled: false,
      sentryDsn: '',
      sentryEnabled: false,
    })
  })

  it('treats whitespace-only values as unset, not as a key', () => {
    const config = telemetryConfig({
      VITE_POSTHOG_KEY: '   ',
      VITE_POSTHOG_HOST: '\t',
      VITE_SENTRY_DSN: ' \n ',
    })
    expect(config.posthogEnabled).toBe(false)
    expect(config.sentryEnabled).toBe(false)
    expect(config.posthogHost).toBe(POSTHOG_DEFAULT_HOST)
  })

  it('takes the host override, but only its origin', () => {
    expect(telemetryConfig({ VITE_POSTHOG_KEY: 'phc_x', VITE_POSTHOG_HOST: 'https://eu.i.posthog.com/' }).posthogHost).toBe(
      'https://eu.i.posthog.com',
    )
    // A path or trailing slash cannot double up against the /capture/ path.
    expect(telemetryConfig({ VITE_POSTHOG_KEY: 'phc_x', VITE_POSTHOG_HOST: 'https://eu.i.posthog.com/ingest' }).posthogHost).toBe(
      'https://eu.i.posthog.com',
    )
    // A host that is not a URL is no host at all, so the US default stands.
    expect(telemetryConfig({ VITE_POSTHOG_KEY: 'phc_x', VITE_POSTHOG_HOST: 'eu.i.posthog.com' }).posthogHost).toBe(
      POSTHOG_DEFAULT_HOST,
    )
  })

  it('only enables a DSN that could actually receive an event', () => {
    const enabled = (dsn: string) => telemetryConfig({ VITE_SENTRY_DSN: dsn }).sentryEnabled
    expect(enabled('https://abc123@o4507.ingest.sentry.io/4506123')).toBe(true)
    expect(enabled('https://abc123@o4507.ingest.us.sentry.io/4506123456789012')).toBe(true)
    // Wrong variable, a bare host, a non-numeric project, or not a URL:
    expect(enabled('phc_notadsn')).toBe(false)
    expect(enabled('https://sentry.io')).toBe(false)
    expect(enabled('https://abc123@o4507.ingest.sentry.io/project')).toBe(false)
    expect(enabled('ftp://abc123@host/1')).toBe(false)
  })

  it('expects exactly the three documented variable names', () => {
    expect([...TELEMETRY_ENV_VARS]).toEqual(['VITE_POSTHOG_KEY', 'VITE_POSTHOG_HOST', 'VITE_SENTRY_DSN'])
  })

  it('never gives a credential a VITE_ prefix, which would publish it', () => {
    // Vite inlines every VITE_* var into the client bundle, so one of these
    // names would ship a real secret to every visitor.
    const SECRETISH = /VITE_[A-Z0-9_]*(SECRET|PRIVATE|TOKEN|PASSWORD|WEBHOOK)[A-Z0-9_]*/g
    const found: string[] = []
    const seen: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) {
          const src = readFileSync(full, 'utf8')
          seen.push(...(src.match(/VITE_[A-Z0-9_]+/g) ?? []))
          found.push(...(src.match(SECRETISH) ?? []))
        }
      }
    }
    walk(SRC)
    // The scan must be looking at something, and the pattern must fire:
    expect(seen.length).toBeGreaterThan(3)
    expect('VITE_RAZORPAY_KEY_SECRET'.match(SECRETISH)).not.toBeNull()
    expect(found).toEqual([])
  })

  it('imports no SDK, and adds no dependency that could', () => {
    const src = readFileSync(join(SRC, 'lib', 'telemetry.ts'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/\brequire\s*\(/)
    // A missing key must stay a missing key: no analytics/error SDK anywhere.
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
    expect(names.filter((name) => /posthog|@sentry\//.test(name))).toEqual([])
  })
})

describe('scrubMeta: what may leave the device', () => {
  it('drops PII-shaped keys', () => {
    const scrubbed = scrubMeta({
      pnr: '2415438901',
      pnr_last4: '8901',
      last4: '8901',
      name: 'Asha R',
      full_name: 'Asha Rao',
      phone: '+919900000000',
      email: 'a@b.com',
      ticket_url: 'https://x/y.jpg',
      amount_paise: 9900,
    })
    expect(Object.keys(scrubbed)).toEqual(['amount_paise'])
    expect(scrubbed.amount_paise).toBe(9900)
  })

  it('drops PII-shaped values even under a harmless key', () => {
    const scrubbed = scrubMeta({
      train_no: '12951',
      rank: 2,
      search: '2415438901', // a PNR smuggled into a string
      contact: '9900000000',
      note: 'a@b.com',
      text: 'x'.repeat(200), // free text is not a metric
      blank: '   ',
    })
    expect(scrubbed).toEqual({ train_no: '12951', rank: 2 })
  })

  it('drops a 10-digit number, which is a PNR or a phone either way', () => {
    expect(scrubMeta({ id: 2415438901, amount_paise: 9900 }).id).toBeUndefined()
    expect(scrubMeta({ amount_paise: 9900 }).amount_paise).toBe(9900)
  })

  it('keeps real zero and false, which a truthiness check would eat', () => {
    const scrubbed = scrubMeta({ matches: 0, capped: false, side: 'acceptor', nothing: null, missing: undefined })
    expect(scrubbed).toEqual({ matches: 0, capped: false, side: 'acceptor' })
  })

  it('cannot silently eat a metric a real caller sends', () => {
    const keys = new Set<string>()
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) for (const key of metaKeysOf(readFileSync(full, 'utf8'))) keys.add(key)
      }
    }
    walk(SRC)
    // The scanner itself must be working: these come from real call sites.
    expect(keys.size).toBeGreaterThan(10)
    expect([...keys]).toContain('amount_paise')
    expect([...keys]).toContain('train_no')
    for (const key of keys) expect(scrubMeta({ [key]: 'ok' })[key], `${key} would be dropped`).toBe('ok')
  })
})

describe('posthog capture body', () => {
  it('is the documented /capture/ shape, with scrubbed properties', () => {
    const config = telemetryConfig({ VITE_POSTHOG_KEY: 'phc_test' })
    const body = posthogCaptureBody(
      config,
      'payment_paid',
      { amount_paise: 9900, pnr: '2415438901' },
      'anon_1',
      1_700_000_000_000,
    )
    expect(body).toEqual({
      api_key: 'phc_test',
      event: 'payment_paid',
      distinct_id: 'anon_1',
      timestamp: new Date(1_700_000_000_000).toISOString(),
      properties: { amount_paise: 9900, $lib: 'seatswap-pwa' },
    })
  })
})

function stubFetch() {
  const mock = vi.fn(async () => ({ ok: true }) as unknown as Response)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('forwarding', () => {
  it('keyless: no request and no storage write at all', async () => {
    const fetchMock = stubFetch()
    await forwardEvent('request_sent', { matches: 2 })
    trackEvent('request_sent', { matches: 2 })
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    // Zero footprint: an unconfigured app must not mint a device id either.
    expect(window.localStorage.getItem(TELEMETRY_ANON_STORAGE_KEY)).toBeNull()
  })

  it('configured: one POST to /capture/ carrying the event, and a reused device id', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_live')
    const fetchMock = stubFetch()
    trackEvent('pnr_added', { train_no: '12951' })
    trackEvent('offer_accepted', { rank: 1 })
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${POSTHOG_DEFAULT_HOST}/capture/`)
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(String(init.body))).toMatchObject({ api_key: 'phc_live', event: 'pnr_added' })

    const first = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(first.distinct_id).toBe(second.distinct_id)
    expect(first.distinct_id).toMatch(/^anon_/)
    expect(window.localStorage.getItem(TELEMETRY_ANON_STORAGE_KEY)).toBe(first.distinct_id)
  })

  it('a failing network never breaks the user action or the local log', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_live')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(() => trackEvent('swap_locked', {})).not.toThrow()
    await Promise.resolve()
    expect(readEvents().map((row) => row.event)).toContain('swap_locked')
  })
})

/** Every meta key passed to a real `trackEvent(...)` call in `src/`. Walks each
 *  call to its closing paren so a multi-line object literal is read whole. */
function metaKeysOf(source: string): string[] {
  const keys: string[] = []
  const marker = 'trackEvent('
  let index = source.indexOf(marker)
  while (index !== -1) {
    let cursor = index + marker.length
    let depth = 1
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '(') depth += 1
      else if (source[cursor] === ')') depth -= 1
      cursor += 1
    }
    const call = source.slice(index, cursor)
    const open = call.lastIndexOf('{')
    const close = call.lastIndexOf('}')
    if (open !== -1 && close > open) {
      for (const part of call.slice(open + 1, close).split(',')) {
        const token = part.trim()
        const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(token) ?? /^([A-Za-z_$][\w$]*)$/.exec(token)
        if (match) keys.push(match[1])
      }
    }
    index = source.indexOf(marker, Math.max(cursor, index + marker.length))
  }
  return keys
}
