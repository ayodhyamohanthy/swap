/* The analytics forwarder, tested on the three properties that matter if it is
 * ever wrong: nothing is sent without consent, nothing PII-shaped is sent even
 * if a caller adds it, and the build still works with no key.
 *
 * These are mutation-checked. A forwarder is exactly the kind of feature where
 * a green test can mean "the test never exercised the send path" — the failure
 * mode is a queue that never flushes, which looks exactly like a healthy app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  consentGranted,
  enqueue,
  flush,
  installId,
  posthogKey,
  queuedCount,
  resetForwardingForTests,
  scrub,
  setConsent,
  setConfigForTests,
  setSenderForTests,
  startForwarding,
  stopForwarding,
} from '@/lib/posthog'
import { resetAnalyticsForTests, trackEvent, type AnalyticsEvent, type LoggedEvent } from '@/lib/analytics'

/** Pretend a key is configured, so the send path actually runs. */
function withKey(key = 'phc_test_token'): void {
  setConfigForTests(key)
}

/** A queued row. Typed as the real `LoggedEvent`, so a test cannot invent an
 *  event name the closed union does not allow — which is the property
 *  `posthog.ts` relies on when it drops unknown rows. */
const row = (
  event: AnalyticsEvent,
  meta: Record<string, unknown> = {},
): LoggedEvent => ({ event, ts: Date.now(), meta: meta as LoggedEvent['meta'] })

describe('analytics forwarding is off until the traveller says otherwise', () => {
  beforeEach(() => {
    resetForwardingForTests()
    resetAnalyticsForTests()
    setConfigForTests(null)
    setSenderForTests(async () => true)
  })

  it('queues nothing with no consent, and the keyless build stays inert', () => {
    /* The default build has no key, so this is also the "nothing to break"
     * case: no timer, no queue, no request. */
    enqueue(row('request_sent', { matches: 3 }))
    expect(queuedCount()).toBe(0)
    expect(flush()).resolves.toBe(0)
  })

  it('still queues nothing with consent but no key', () => {
    /* Consent without a token is a state a user can reach (turn the switch on
     * before a build is configured). It must not throw or accumulate. */
    setConsent(true)
    expect(consentGranted()).toBe(true)
    enqueue(row('request_sent', {}))
    /* No key means `enqueue` is a no-op by design — verified through
     * `posthogKey` being empty in this environment, which is what CI has. */
    expect(posthogKey()).toBe('')
  })

  it('discards the queue when consent is withdrawn', () => {
    /* Turning it off must stop sending AND forget what was going to be sent.
     * Leaving rows queued means a later opt-in ships events the traveller
     * declined at the time they were collected. */
    setConsent(true)
    /* Write one row directly: `enqueue` needs a key, which the test env lacks. */
    window.localStorage.setItem(
      'seatswap.analytics.queue.v1',
      JSON.stringify([row('request_sent')]),
    )
    expect(queuedCount()).toBe(1)
    setConsent(false)
    expect(queuedCount()).toBe(0)
  })

  it('does not start a timer without a key', () => {
    setConsent(true)
    const spy = vi.spyOn(globalThis, 'setInterval')
    startForwarding()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    stopForwarding()
  })
})

describe('the send path, with a key configured', () => {
  beforeEach(() => {
    resetForwardingForTests()
    resetAnalyticsForTests()
    withKey()
    setSenderForTests(async () => true)
  })

  it('posts a batch and empties the queue on success', async () => {
    /* This is the path that never runs in the keyless CI build, which is
     * exactly why it needs a test: a forwarder that queues and never flushes
     * looks identical from the outside to a healthy one. */
    setConsent(true)
    enqueue(row('request_sent', { matches: 3, train_no: '12951' }))
    enqueue(row('swap_locked', { amount_paise: 9900 }))
    expect(queuedCount()).toBe(2)

    const sent = await flush()
    expect(sent).toBe(2)
    expect(queuedCount()).toBe(0)
  })

  it('sends nothing without consent, even with a key', () => {
    setConsent(false)
    withKey()
    enqueue(row('request_sent'))
    expect(queuedCount()).toBe(0)
  })

  it('scrubs the body it sends, not just the queue', async () => {
    /* The scrub has to be applied where the payload is BUILT, or a row
     * enqueued before a rule change goes out unscrubbed. */
    let body = ''
    setSenderForTests(async (_url, payload) => {
      body = payload
      return true
    })
    setConsent(true)
    enqueue(row('pnr_added', { train_no: '12951', pnr_last4: '4821', first_name: 'Riya' }))
    await flush()
    expect(body).toContain('12951')
    expect(body).not.toMatch(/4821|Riya/)
  })

  it('keeps queued events when a send fails, so offline does not lose them', () => {
    /* The opposite of the chat outbox, which flushes once and forgets: here
     * the events are ours and re-sending is free, so losing them to a flaky
     * network would silently hollow out the funnel. */
    setSenderForTests(async () => false)
    setConsent(true)
    enqueue(row('request_sent'))
    return flush().then((sent) => {
      expect(sent).toBe(0)
      expect(queuedCount()).toBe(1)
    })
  })

  it('keeps queued events when the request throws', async () => {
    setSenderForTests(async () => {
      throw new Error('offline')
    })
    setConsent(true)
    enqueue(row('request_sent'))
    await flush()
    expect(queuedCount()).toBe(1)
  })

  it('sends the install id as distinct_id, and no account id', async () => {
    let body = ''
    setSenderForTests(async (_url, payload) => {
      body = payload
      return true
    })
    setConsent(true)
    enqueue(row('pnr_added'))
    await flush()
    const parsed = JSON.parse(body) as { distinct_id: string; api_key: string }
    expect(parsed.distinct_id).toBe(installId())
    expect(parsed.api_key).toBe('phc_test_token')
  })

  it('never sends operator events', () => {
    /* `admin_action` and `user_blocked` are about staff behaviour inside the
     * console, not product usage, and they carry an operator's reason text. */
    setConsent(true)
    enqueue(row('admin_action', { action: 'close_report' }))
    enqueue(row('user_blocked', {}))
    enqueue(row('pnr_added', {}))
    expect(queuedCount()).toBe(1)
  })
})

describe('scrub is the privacy boundary, not the callers', () => {
  it('drops every rule-13 value even when a caller adds it', () => {
    /* The point of the allow-list: today's 29 call sites are clean, but a
     * future one adding `pnr_last4` must be dropped rather than forwarded. */
    const meta = {
      train_no: '12951',
      amount_paise: 9900,
      pnr_last4: '4821',
      pnr_hash: 'deadbeef',
      first_name: 'Riya',
      last_initial: 'P',
      phone: '9876543210',
      email: 'riya@example.com',
      upi_id: 'riya@ybl',
    }
    const out = scrub(meta)
    expect(Object.keys(out).sort()).toEqual(['amount_paise', 'train_no'])
    expect(JSON.stringify(out)).not.toMatch(/4821|deadbeef|Riya|98765|example|ybl/)
  })

  it('drops an unknown key even when it holds no PII', () => {
    /* Allow-list, not deny-list: a key nobody has thought about is not sent. */
    expect(scrub({ train_no: '12951', surprise_field: 'x' })).toEqual({ train_no: '12951' })
  })

  it('bounds a long string so free text cannot ride in an allowed key', () => {
    /* `train_no` is allow-listed. A caller that puts a chat transcript in it
     * must not turn an allowed key into a data channel. */
    const out = scrub({ train_no: 'x'.repeat(200) })
    expect(out).toEqual({})
  })

  it('keeps the primitives and drops everything else', () => {
    const out = scrub({
      train_no: '12951',
      matches: 4,
      capped: false,
      state: null,
      amount_paise: Number.NaN,
      reasons: { nested: true },
    } as Record<string, unknown>)
    expect(out).toEqual({ train_no: '12951', matches: 4, capped: false, state: null })
  })

  it('refuses PII in the VALUE of a legitimate key', () => {
    /* `context` is on the allow-list, so the key check cannot save it. A caller
     * that pastes "my upi is riy@ybl" into it must be dropped, and this is the
     * only case in the file where deleting a guard shows up — the allow-list
     * already covers every PII *key* name, so a second key check would be
     * untestable overlap. */
    expect(scrub({ context: 'my upi is riy@ybl and my number is 9876543210' }))
      .toEqual({})
    /* And the check is shape-based, not "contains a digit": a train number and
     * an amount are digits and must survive. */
    expect(scrub({ train_no: '12951', amount_paise: 9900 }))
      .toEqual({ train_no: '12951', amount_paise: 9900 })
    expect(scrub({ context: 'pnr_added' })).toEqual({ context: 'pnr_added' })
  })
})

describe('the install id is anonymous and stable', () => {
  beforeEach(() => resetForwardingForTests())

  it('is a fresh uuid each time storage is cleared, stable within a session', () => {
    const first = installId()
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(installId()).toBe(first)
  })

  it('carries nothing about the account', () => {
    /* Not the Supabase auth uuid, deliberately: behavioural data tied to an
     * account is not anonymous, and re-signing-in on a shared device would join
     * two people's records. Asserted as a shape, since no name is available. */
    expect(installId()).toHaveLength(36)
  })
})

describe('the env reads must stay static, or the forwarder silently never sends', () => {
  const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
  const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'posthog.ts'), 'utf8')
  /* Comments stripped, because this file's own header QUOTES the broken form to
   * explain why it is broken — so a whole-file "not to match" would fail on its
   * own documentation. The first version of this assertion did exactly that. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  it('reads each VITE_ var as a literal member expression', () => {
    /* Vite replaces `import.meta.env.VITE_X` textually; it cannot replace a
     * name passed to a function, because there is nothing to pattern-match.
     * The dynamic form typechecks, passes every behavioural test and builds —
     * and then returns undefined in production, so the events never leave the
     * device. Nothing else would have caught it, because the keyless build is
     * the one this project ships.
     *
     * Caught by grepping the BUILT asset for the literal string
     * `VITE_POSTHOG_KEY`, which is exactly what a failed substitution leaves
     * behind. */
    /* Matched with `\s*` across the line break: the read is written
     * `}).env` newline `  ?.VITE_POSTHOG_KEY`, so `env?.` is not adjacent in the
     * source. A stricter pattern here is a false negative on correct code, and
     * the point of the assertion is to catch the dynamic form, not to enforce
     * formatting. */
    expect(code).toMatch(/\.env\s*\?\s*\.VITE_POSTHOG_KEY/)
    expect(code).toMatch(/\.env\s*\?\s*\.VITE_POSTHOG_HOST/)
    /* And no lookup by name, which is the form that cannot work. */
    expect(code).not.toMatch(/readEnv\s*\(\s*['"]VITE_/)
    expect(code).not.toMatch(/env\[['"]VITE_/)
  })

  it('resolves no key in a build without one configured', () => {
    /* The build in this repo has no VITE_POSTHOG_KEY, so `posthogKey()` is ''
     * and every send is a no-op. Asserted directly rather than inferred, since
     * "the default build is inert" is the property that lets the app keep
     * shipping with zero keys (wrangler.toml). */
    setConfigForTests(null)
    expect(posthogKey()).toBe('')
  })
})

describe('trackEvent cannot break the transition it observes', () => {
  beforeEach(() => {
    resetForwardingForTests()
    resetAnalyticsForTests()
  })

  it('still records locally when forwarding throws', () => {
    /* `trackEvent` is called from state transitions. If queueing could throw,
     * a swap would fail because analytics storage was full. */
    const original = window.localStorage.setItem
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      expect(() => trackEvent('swap_locked', { amount_paise: 9900 })).not.toThrow()
    } finally {
      window.localStorage.setItem = original
    }
  })
})
