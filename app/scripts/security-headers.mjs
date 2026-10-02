/* The Content-Security-Policy contract behind `app/public/_headers`
   (docs/16-BEST-PRACTICES.md §9.3, docs/17 §W7, docs/15-AUDIT.md gap m1).
 *
 * WHY THIS IS A MODULE AND NOT A STRING IN THE VERIFIER. `_headers` shipped
 * since 2026-09-28 with cache rules only, and `verify-dist.mjs` asserted that
 * the file EXISTED — so the whole of W7 was green: a check that a file is
 * present cannot notice that its contents are empty of the thing the check
 * exists for. The rules therefore live here as data, `verify-dist.mjs` applies
 * them to the file that is about to be deployed, and `tests/security-headers.test.ts`
 * applies them to synthetic inputs too. Pure, and imports nothing — the same
 * shape as `backup-contract.mjs` and `domain-lib.mjs`, which both exist for
 * the same reason: a value copied into a checker is a second copy to drift.
 *
 * WHAT IS ACTUALLY ASSERTED, in the order a real failure would bite:
 *
 *  1. Every block carries the full security set. `_headers` patterns match the
 *     REQUEST path, and Cloudflare's behaviour when two rules match is not
 *     something this repo can measure — so the guarantee is made to hold under
 *     either answer rather than depend on one.
 *  2. The directives exist, and the four that close whole classes of attack are
 *     present with the right value (`object-src`, `base-uri`, `frame-ancestors`,
 *     `form-action`) — a policy missing them is still a policy, and that is the
 *     difference between "we wrote a CSP" and "we wrote the right one".
 *  3. No bare `*` and no `'unsafe-eval'`. Both are how a CSP stops being one.
 *  4. Every origin a shipped code path loads is permitted, in the RIGHT
 *     directive. This is the one that protects the product rather than the
 *     scoreboard: a payment SDK loaded from a host the policy does not name is
 *     blocked in a traveller's browser at the moment they are trying to pay,
 *     which is the failure mode docs/17 W7 warns about ("CSP is where payment
 *     integrations break"). So each entry below names the file that needs it,
 *     and `missingOrigins` reports any origin in the CSP that no code path
 *     explains — a stale entry is dead policy that widens the hole.
 */

/** Header names every block must carry, in the order they are written. */
export const SECURITY_HEADERS = [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
]

/** Values that are a specific requirement, not a presence check: a CSP that
    omits `object-src` falls back to `default-src`, but one that sets it to
    anything but `'none'` allows plugins — and the app has none. */
export const REQUIRED_CSP_VALUES = {
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'frame-ancestors': ["'none'"],
}

/** Directives that must simply be present. `default-src 'self'` is the floor;
    the rest exist because each names a class of resource the app really loads,
    and a directive that falls back to `default-src` is a resource decided by
    accident rather than by a decision. */
export const REQUIRED_CSP_DIRECTIVES = [
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'frame-src',
  'worker-src',
  'manifest-src',
  'form-action',
]

/**
 * External origins the app loads, and WHY. `file` is the shipped source that
 * needs it — asserted present by the test, so a vendor that is uninstalled
 * cannot leave a hole open behind a policy entry nobody reads.
 *
 * Wildcards (`https://*.supabase.co`) are used only where the host is not knowable
 * at build time: a Supabase project ref and a Sentry org id are both runtime
 * values (`VITE_SUPABASE_URL`, `VITE_SENTRY_DSN`), so pinning a literal here
 * would pin today's. `*.posthog.com` covers the EU and US ingest hosts that
 * `VITE_POSTHOG_HOST` selects between. Everything else is exact, and exact is the
 * default — a wildcard in `script-src` is the same as `'unsafe-inline'` with
 * extra steps.
 */
export const REQUIRED_ORIGINS = [
  // Razorpay Standard Checkout, loaded lazily on the pay routes only.
  { origin: 'https://checkout.razorpay.com', directive: 'script-src', file: 'src/lib/pay-sdk.ts' },
  { origin: 'https://checkout.razorpay.com', directive: 'frame-src', file: 'src/lib/pay-sdk.ts' },
  { origin: 'https://api.razorpay.com', directive: 'connect-src', file: 'src/server/razorpay-client.ts' },
  { origin: 'https://api.razorpay.com', directive: 'frame-src', file: 'src/server/razorpay-client.ts' },
  // PayPal JS SDK, the international fallback (agents.md rule 9).
  { origin: 'https://www.paypal.com', directive: 'script-src', file: 'src/lib/pay-sdk.ts' },
  { origin: 'https://www.paypal.com', directive: 'frame-src', file: 'src/lib/pay-sdk.ts' },
  // The SDK does not ship as one file: `pay-sdk.ts` injects
  // `https://www.paypal.com/sdk/js`, which then pulls its own module graph over
  // XHR from the SAME host. So www.paypal.com is needed in connect-src as well
  // as script-src, and dropping that entry breaks the international fallback
  // (agents.md rule 9) on the very first render.
  { origin: 'https://www.paypal.com', directive: 'connect-src', file: 'src/lib/pay-sdk.ts' },
  { origin: 'https://api-m.paypal.com', directive: 'connect-src', file: 'src/server/paypal-client.ts' },
  // Supabase: auth, REST, Realtime and Storage, all from the project ref at runtime.
  { origin: 'https://*.supabase.co', directive: 'connect-src', file: 'src/lib/supabase.ts' },
  { origin: 'wss://*.supabase.co', directive: 'connect-src', file: 'src/lib/supabase.ts' },
  // PostHog capture (the only vendor the client speaks to directly) and Sentry
  // envelopes. Both hostnames come from build-time env vars (docs/17 §Env).
  { origin: 'https://*.posthog.com', directive: 'connect-src', file: 'src/lib/posthog.ts' },
  { origin: 'https://*.ingest.sentry.io', directive: 'connect-src', file: 'src/lib/telemetry.ts' },
  // The share-card QR is a remote image (designs 14b / 6c), not a generated one.
  { origin: 'https://api.qrserver.com', directive: 'img-src', file: 'src/routes/share.$trainDate.tsx' },
]

/**
 * How many `<script>` blocks in the shell carry no `src`. This is the number
 * that decides whether `'unsafe-inline'` is a measured necessity or an
 * unreviewed hole, so it lives next to the rule that depends on it rather than
 * in the verifier as a one-off regex nobody re-reads.
 *
 * Measured on the 2026-10-02 build: 4 — our BOOT_SCRIPT plus three TanStack
 * Start internals (scroll restoration, the serialised `$TSR` router manifest,
 * the stream-boundary marker) whose sha256 changes with the route tree and so
 * cannot be pinned statically. It also catches a script that lost its `src`
 * attribute to a bad transform: that would be an inline body in a file the
 * policy believes is external.
 */
export function inlineScriptCount(html) {
  const tags = String(html ?? '').match(/<script\b[^>]*>/gi) ?? []
  return tags.filter((tag) => !/\bsrc\s*=/i.test(tag)).length
}

/**
 * Split a `_headers` file into its blocks. Comments are stripped BEFORE anything
 * else, because a `#`-commented path line that survived would read as a live
 * route and a `#`-commented header as a present one — the same trap
 * `domain-lib.mjs` hit when a commented wrangler `routes` line was counted as
 * wired. A blank line ends the block, so this parser and the platform agree on
 * what a block is.
 */
export function parseHeaderBlocks(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => !/^\s*#/.test(line))

  const blocks = []
  let current = null
  for (const line of lines) {
    if (!line.trim()) {
      current = null
      continue
    }
    // An indented line continues the block; anything else starts a new one.
    if (/^\s/.test(line) && current) {
      const index = line.indexOf(':')
      if (index > 0) {
        const name = line.slice(0, index).trim()
        const value = line.slice(index + 1).trim()
        current.headers[name.toLowerCase()] = value
      }
      continue
    }
    current = { path: line.trim(), headers: {} }
    blocks.push(current)
  }
  return blocks
}

/** `default-src 'self'; script-src a b` → `{ 'default-src': ["'self'"], … }`. */
export function parseCsp(value) {
  const out = {}
  for (const part of String(value ?? '').split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const name = tokens[0].toLowerCase()
    out[name] = tokens.slice(1)
  }
  return out
}

/** Does `source` (one origin, possibly a wildcard) permit `origin`? */
function originAllowed(source, origin) {
  if (source === origin) return true
  if (!source.includes('*')) return false
  // `https://*.razorpay.com` covers `https://api.razorpay.com` but not
  // `https://evil.razorpay.com.attacker.test`, and not a bare apex the SDK
  // never uses. Comparing per label is what keeps the wildcard a subdomain
  // rule rather than a substring test — the bug class `domain-lib.mjs` guards.
  const pattern = new RegExp(
    `^${source.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[A-Za-z0-9-]*')}$`,
  )
  return pattern.test(origin)
}

/** Origins the policy permits that no shipped code path explains. */
export function missingOrigins(directives) {
  const explained = new Set()
  for (const { origin, directive } of REQUIRED_ORIGINS) {
    const sources = directives[directive] ?? []
    if (sources.some((source) => originAllowed(source, origin))) explained.add(`${directive} ${origin}`)
  }
  const wanted = REQUIRED_ORIGINS.map(({ origin, directive }) => `${directive} ${origin}`)
  return wanted.filter((key) => !explained.has(key))
}

/** Origins in the policy no entry claims — stale policy that widens the hole. */
export function unexplainedOrigins(directives) {
  const stale = []
  for (const [directive, sources] of Object.entries(directives)) {
    for (const source of sources) {
      if (!/^https?:\/\//.test(source)) continue
      const claimed = REQUIRED_ORIGINS.some(
        ({ origin, directive: want }) => want === directive && originAllowed(source, origin),
      )
      if (!claimed) stale.push(`${directive} ${source}`)
    }
  }
  return stale
}

/**
 * Everything wrong with a parsed `_headers` file, as human-readable strings.
 * Empty array = shippable.
 */
export function headerBlockProblems(blocks) {
  const problems = []

  if (blocks.length === 0) {
    problems.push('_headers has no rules at all — every path is served with no headers')
    return problems
  }

  const wildcard = blocks.find((block) => block.path === '/*')
  if (!wildcard) {
    problems.push(
      '_headers has no /* rule, so a deep link answered by the SPA fallback (e.g. /trips/abc) matches no rule and gets no headers',
    )
  }

  for (const block of blocks) {
    for (const name of SECURITY_HEADERS) {
      if (!(name.toLowerCase() in block.headers)) {
        problems.push(`${block.path}: missing ${name}`)
      }
    }
    const value = block.headers['content-security-policy'] ?? ''
    if (!value) continue
    const directives = parseCsp(value)

    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      if (!(directive in directives)) problems.push(`${block.path}: CSP has no ${directive} directive`)
    }
    for (const [directive, required] of Object.entries(REQUIRED_CSP_VALUES)) {
      const actual = directives[directive]
      if (!actual) continue
      for (const token of required) {
        if (!actual.includes(token)) {
          problems.push(`${block.path}: CSP ${directive} must include ${token} (found ${actual.join(' ')})`)
        }
      }
    }
    // A `*` with no scheme is a hole; `*` inside a host (see above) is not.
    for (const [directive, sources] of Object.entries(directives)) {
      if (sources.includes('*')) problems.push(`${block.path}: CSP ${directive} allows * — allowlist the origins instead`)
      if (sources.includes("'unsafe-eval'")) {
        problems.push(`${block.path}: CSP ${directive} allows 'unsafe-eval'`)
      }
    }
    if (/\*(\s|;|$)/.test(value.replace(/\*\./g, ''))) {
      problems.push(`${block.path}: CSP contains a bare * outside a host wildcard`)
    }

    for (const key of missingOrigins(directives)) {
      problems.push(`${block.path}: CSP does not permit ${key} — a shipped code path loads it`)
    }
    for (const key of unexplainedOrigins(directives)) {
      problems.push(`${block.path}: CSP permits ${key}, which no code path in REQUIRED_ORIGINS explains`)
    }
  }

  return problems
}
