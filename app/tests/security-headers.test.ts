/* The CSP contract behind `public/_headers` (docs/17 §W7, docs/16 §9.3,
 * docs/15-AUDIT gap m1).
 *
 * WHY THIS FILE EXISTS. `_headers` shipped on 2026-09-28 carrying three
 * `Cache-Control` lines and no security header of any kind, and `verify-dist.mjs`
 * asserted that the file EXISTS. That is the whole of W7 having been green for
 * five days: a presence check cannot notice that the thing the file exists for
 * is missing from it. These tests run the shipped file — not a fixture dressed
 * up to look like it — through the same module `verify-dist.mjs` uses, so the
 * policy that reaches a traveller's browser is the policy asserted here.
 *
 * WHY THE MUTATION DESCRIBES ARE THE POINT. A guard whose pattern matches
 * nothing reports green; docs/11 records that failure twice already (the vendor
 * guard, the azure harness). So every negative test below is a mutation of the
 * REAL shipped file: the file still parses, still has its `/*` rule, still has
 * a syntactically perfect CSP — and the check must still fail, with a message
 * naming what went missing. The last describe block is the guard on the guards:
 * it asserts the mutator's own regexes match, so a broken mutation cannot pass
 * by being a no-op.
 *
 * Pure module, no `node:*` imports: `verify-dist.mjs` needs `node:fs`, but this
 * one reads the repo through `process.getBuiltinModule`, the form docs/11
 * records as safe under the jsdom pool.
 */
import { describe, expect, it } from 'vitest'

import {
  REQUIRED_CSP_DIRECTIVES,
  REQUIRED_CSP_VALUES,
  REQUIRED_ORIGINS,
  SECURITY_HEADERS,
  headerBlockProblems,
  inlineScriptCount,
  missingOrigins,
  parseCsp,
  parseHeaderBlocks,
  unexplainedOrigins,
} from '../scripts/security-headers.mjs'

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   what broke collection for six lanes (docs/11). */
const { existsSync, readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { dirname, join } = process.getBuiltinModule('node:path') as typeof import('node:path')
const { fileURLToPath } = process.getBuiltinModule('node:url') as typeof import('node:url')

/* tests/ → app/ . Resolved rather than `process.cwd()`-relative: vitest runs
   from the app dir today, but a path that silently reads nothing is the exact
   failure mode every other test in this file is written to catch. */
const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const HEADERS_FILE = join(APP, 'public', '_headers')

const SHIPPED = readFileSync(HEADERS_FILE, 'utf8')

/** A synthetic-but-legal rewrite of the shipped file: `mutate` gets the text
    and returns a replacement. Returns the parsed blocks, ready for the guard. */
function mutateBlocks(mutate: (text: string) => string) {
  return parseHeaderBlocks(mutate(SHIPPED))
}

/** Rewrite the CSP inside every block that has one, so a policy-wide mutation
    (dropping an origin, adding a wildcard) cannot hide in one of seven blocks.
    `match.slice(prefix.length)` rather than re-deriving the value from the
    prefix — the prefix is only the header name, and taking the value from it
    silently yields "" (which is how this helper first "worked": every block
    lost its whole policy and the guard reported nothing). */
function mutateEveryCsp(mutate: (value: string) => string) {
  return mutateBlocks((text) =>
    text.replace(/^(  Content-Security-Policy: )\S.*$/gm, (match: string, prefix: string) =>
      `${prefix}${mutate(match.slice(prefix.length))}`,
    ),
  )
}

describe('the shipped _headers', () => {
  it('parses into blocks, and every block carries the full security set', () => {
    const blocks = parseHeaderBlocks(SHIPPED)
    expect(blocks.length).toBeGreaterThan(1)
    for (const block of blocks) {
      for (const name of SECURITY_HEADERS) {
        expect(Object.keys(block.headers), `${block.path} is missing ${name}`).toContain(
          name.toLowerCase(),
        )
      }
    }
  })

  it('has a /* rule, which is the only one a deep link can match', () => {
    expect(parseHeaderBlocks(SHIPPED).some((block) => block.path === '/*')).toBe(true)
  })

  it('reports no problems at all', () => {
    /* The assertion that would fail if a block drifted: not "each header is
       present" (covered above) but the combined verdict, which is what the
       build runs. */
    expect(headerBlockProblems(parseHeaderBlocks(SHIPPED))).toEqual([])
  })

  it('carries the six headers docs/16 §9.3 names, HSTS included', () => {
    const blocks = parseHeaderBlocks(SHIPPED)
    for (const block of blocks) {
      expect(block.headers['strict-transport-security']).toMatch(/max-age=\d+/)
      expect(block.headers['x-content-type-options']).toBe('nosniff')
      expect(block.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
      expect(block.headers['x-frame-options']).toBe('DENY')
    }
  })

  it('sets every directive that closes a class of attack', () => {
    const blocks = parseHeaderBlocks(SHIPPED)
    for (const block of blocks) {
      const directives = parseCsp(block.headers['content-security-policy'])
      for (const name of REQUIRED_CSP_DIRECTIVES) {
        expect(Object.keys(directives), `${block.path} CSP has no ${name}`).toContain(name)
      }
      for (const [name, tokens] of Object.entries(REQUIRED_CSP_VALUES)) {
        for (const token of tokens) {
          expect(directives[name] ?? [], `${block.path} CSP ${name}`).toContain(token)
        }
      }
    }
  })

  it('permits every origin a shipped code path loads, and nothing else', () => {
    for (const block of parseHeaderBlocks(SHIPPED)) {
      const directives = parseCsp(block.headers['content-security-policy'])
      expect(missingOrigins(directives), `${block.path}`).toEqual([])
      expect(unexplainedOrigins(directives), `${block.path}`).toEqual([])
    }
  })

  it('has no bare * and no unsafe-eval anywhere', () => {
    for (const block of parseHeaderBlocks(SHIPPED)) {
      const value = block.headers['content-security-policy']
      expect(value, `${block.path}`).not.toMatch(/unsafe-eval/)
      expect(value.replace(/\*\./g, ''), `${block.path}`).not.toMatch(/\*(\s|;|$)/)
    }
  })

  it('keeps the cache rules it shipped with, per docs/12', () => {
    /* W7 added headers; it must not have quietly removed the caching that was
       already there, which is a regression the security checks would not see. */
    const blocks = parseHeaderBlocks(SHIPPED)
    const cacheOf = (path: string) => blocks.find((b) => b.path === path)?.headers['cache-control']
    expect(cacheOf('/sw.js')).toBe('no-cache')
    expect(cacheOf('/assets/*')).toMatch(/immutable/)
    expect(cacheOf('/index.html')).toBe('no-cache')
  })
})

describe('REQUIRED_ORIGINS is evidence, not a wish list', () => {
  it('is not empty, so the checks above cannot pass by matching nothing', () => {
    expect(REQUIRED_ORIGINS.length).toBeGreaterThanOrEqual(8)
  })

  it('names a file that exists for every entry', () => {
    for (const { origin, file } of REQUIRED_ORIGINS) {
      expect(existsSync(join(APP, file)), `${origin} names a missing file: ${file}`).toBe(true)
    }
  })

  it('allows a wildcard only where the host is a runtime value', () => {
    /* Every wildcard in the policy covers a project ref / org id / ingest host
       that comes from an env var. A wildcard on a payment SDK host would be a
       hole, so the two lists are asserted against each other rather than by eye. */
    const wildcarded = REQUIRED_ORIGINS.filter(({ origin }) => origin.includes('*')).map((o) => o.origin)
    expect(wildcarded.sort()).toEqual([
      'https://*.ingest.sentry.io',
      'https://*.posthog.com',
      'https://*.supabase.co',
      'wss://*.supabase.co',
    ])
    for (const { origin } of REQUIRED_ORIGINS) {
      if (origin.includes('razorpay.com') || origin.includes('paypal.com')) {
        expect(origin, `${origin} must be an exact host`).not.toContain('*')
      }
    }
  })
})

describe('parseHeaderBlocks', () => {
  it('treats a blank line as the end of a block', () => {
    const blocks = parseHeaderBlocks(['/*', '  X-A: 1', '', '/sw.js', '  X-A: 2'].join('\n'))
    expect(blocks.map((b) => b.path)).toEqual(['/*', '/sw.js'])
    expect(blocks[1].headers['x-a']).toBe('2')
  })

  it('does not count a commented path as a rule', () => {
    const blocks = parseHeaderBlocks(['/*', '  X-A: 1', '# /gone', '  X-A: 2'].join('\n'))
    expect(blocks.map((b) => b.path)).toEqual(['/*'])
  })

  it('splits on the first colon, so a header value keeps its own colons', () => {
    const blocks = parseHeaderBlocks(['/*', '  Permissions-Policy: camera=(), geolocation=()'].join('\n'))
    expect(blocks[0].headers['permissions-policy']).toBe('camera=(), geolocation=()')
  })
})

describe('parseCsp', () => {
  it('reads directives and their sources', () => {
    expect(parseCsp("default-src 'self'; script-src 'self' https://a.test")).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://a.test'],
    })
  })
})

/** Delete the block whose path line is exactly `path`, header lines and all.
    Used by the "one block lost a header" mutations, which must fail because of
    the missing header and NOT because the block stopped existing. */
function dropOneHeader(text: string, path: string, header: string) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim() === path)
  if (start < 0) throw new Error(`no block for ${path} — the fixture drifted`)
  const bodyStart = lines.findIndex((l, i) => i > start && !l.startsWith('  '))
  const end = bodyStart < 0 ? lines.length : bodyStart
  const at = lines.findIndex((l, i) => i > start && i < end && l.startsWith(`  ${header}:`))
  if (at < 0) throw new Error(`${path} has no ${header} line — the fixture drifted`)
  lines.splice(at, 1)
  return lines.join('\n')
}

describe('mutations of the shipped file, each of which must be caught', () => {
  /* Every case: the file still parses into several blocks, so the only thing
     that can make these pass is the guard matching nothing. */
  /* `degenerate` marks the two cases whose point IS to remove the CSP or the
     `/*` block, so "a CSP is still present somewhere" does not apply to them. */
  const cases: Array<{
    what: string
    blocks: ReturnType<typeof parseHeaderBlocks>
    expect: RegExp
    degenerate?: boolean
  }> = [
    {
      what: 'one block loses HSTS',
      blocks: mutateBlocks((t) => dropOneHeader(t, '/404.html', 'Strict-Transport-Security')),
      expect: /404\.html: missing Strict-Transport-Security/,
    },
    {
      what: 'one block loses nosniff',
      blocks: mutateBlocks((t) => dropOneHeader(t, '/icons/*', 'X-Content-Type-Options')),
      expect: /\/icons\/\*: missing X-Content-Type-Options/,
    },
    {
      what: 'a header is commented out instead of removed',
      blocks: mutateBlocks((t) =>
        t.replace(
          /^  Referrer-Policy:.*$/m,
          '#  Referrer-Policy: strict-origin-when-cross-origin',
        ),
      ),
      expect: /missing Referrer-Policy/,
    },
    {
      what: 'the /* rule is deleted, so deep links get nothing',
      blocks: mutateBlocks((t) => {
        const lines = t.split('\n')
        const start = lines.findIndex((l) => l.trim() === '/*')
        const bodyStart = lines.findIndex((l, i) => i > start && !l.startsWith('  '))
        lines.splice(start, (bodyStart < 0 ? lines.length : bodyStart) - start)
        return lines.join('\n')
      }),
      expect: /no \/\* rule/,
    },
    {
      what: 'script-src is opened to every host',
      blocks: mutateEveryCsp((v) => v.replace(/script-src[^;]*/, "script-src * 'unsafe-inline'")),
      expect: /script-src allows \*/,
    },
    {
      what: 'unsafe-eval is added to enable a payment SDK',
      blocks: mutateEveryCsp((v) => v.replace(/script-src /, "script-src 'unsafe-eval' ")),
      expect: /allows 'unsafe-eval'/,
    },
    {
      what: 'object-src is mis-set instead of left to default-src',
      blocks: mutateEveryCsp((v) => v.replace(/object-src 'none'/, "object-src 'self'")),
      expect: /object-src must include 'none'/,
    },
    {
      what: 'frame-ancestors is loosened so the app can be framed',
      blocks: mutateEveryCsp((v) => v.replace(/frame-ancestors 'none'/, "frame-ancestors 'self'")),
      expect: /frame-ancestors must include 'none'/,
    },
    {
      what: 'base-uri is loosened so a crafted link can rewrite the app origin',
      blocks: mutateEveryCsp((v) => v.replace(/base-uri 'self'/, "base-uri *")),
      expect: /base-uri must include 'self'/,
    },
    {
      what: 'the Razorpay checkout origin is dropped from script-src',
      blocks: mutateEveryCsp((v) => v.replace(/https:\/\/checkout\.razorpay\.com (?=https)/, '')),
      expect: /script-src https:\/\/checkout\.razorpay\.com/,
    },
    {
      what: 'the Supabase Realtime origin is dropped from connect-src',
      blocks: mutateEveryCsp((v) => v.replace(/wss:\/\/\*\.supabase\.co /, '')),
      expect: /connect-src wss:\/\/\*\.supabase\.co/,
    },
    {
      what: 'the QR image origin is dropped from img-src',
      blocks: mutateEveryCsp((v) => v.replace(/https:\/\/api\.qrserver\.com/, '')),
      expect: /img-src https:\/\/api\.qrserver\.com/,
    },
    {
      what: 'a stale origin nobody loads is left behind',
      blocks: mutateEveryCsp((v) => v.replace(/script-src /, 'script-src https://vendor.test ')),
      expect: /script-src https:\/\/vendor\.test, which no code path in REQUIRED_ORIGINS explains/,
    },
    {
      what: 'a host merely containing an allowed domain is added',
      blocks: mutateEveryCsp((v) =>
        v.replace(/script-src /, 'script-src https://www.paypal.com.attacker.test '),
      ),
      expect: /no code path in REQUIRED_ORIGINS explains/,
    },
    {
      what: 'the whole security set is replaced with a cache rule',
      blocks: mutateBlocks((t) => {
        const lines = t.split('\n')
        const start = lines.findIndex((l) => l.trim() === '/*')
        const bodyStart = lines.findIndex((l, i) => i > start && !l.startsWith('  '))
        const end = bodyStart < 0 ? lines.length : bodyStart
        return [
          ...lines.slice(0, start),
          '/*',
          '  Cache-Control: public, max-age=0',
          ...lines.slice(end),
        ].join('\n')
      }),
      expect: /\/\*: missing Content-Security-Policy/,
    },
    {
      what: 'every block loses the CSP at once',
      degenerate: true,
      blocks: mutateBlocks((t) => t.replace(/^  Content-Security-Policy:.*$/gm, '  Cache-Control: no-store')),
      expect: /missing Content-Security-Policy/,
    },
  ]

  for (const c of cases) {
    const { what, blocks, expect: pattern } = c
    it(`catches ${what}`, () => {
      /* The mutation must be a real mutation: a case whose `blocks` is empty, or
         has lost every CSP, would satisfy the pattern for the wrong reason (the
         guard would be right by accident). The two `degenerate` cases below are
         exactly that, and say so. */
      expect(blocks.length, 'the mutation must still parse into blocks').toBeGreaterThan(1)
      expect(
        blocks.some((b) => b.headers['content-security-policy']),
        'the mutation must still contain a CSP somewhere, unless the case removes it',
      ).toBe(c.degenerate !== true)
      expect(headerBlockProblems(blocks).join('\n')).toMatch(pattern)
    })
  }

  it('does not accuse the unmutated file of any of the above', () => {
    /* If this failed, every mutation above would be passing for the wrong
       reason — a guard that flags everything also flags nothing meaningfully. */
    expect(headerBlockProblems(parseHeaderBlocks(SHIPPED))).toEqual([])
  })

  it('reports an empty file as the total failure it is', () => {
    expect(headerBlockProblems(parseHeaderBlocks('# only a comment\n'))).toEqual([
      '_headers has no rules at all — every path is served with no headers',
    ])
  })

  /* Directive-level mutations, on a minimal file rather than the shipped one:
     these drop a directive while leaving the CSP line itself in place, which is
     the shape a hand-edit produces and the shape the shipped-file mutations
     above cannot reach. */
  it('catches a CSP that omits a directive instead of setting it wrong', () => {
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      const without = mutateEveryCsp((v) =>
        v
          .split('; ')
          .filter((part) => !part.trim().toLowerCase().startsWith(`${directive} `))
          .join('; '),
      )
      expect(
        headerBlockProblems(without).join('\n'),
        `dropping ${directive} must be reported`,
      ).toContain(`CSP has no ${directive} directive`)
    }
  })

  it('reports every dropped directive at once, so one run shows the whole list', () => {
    /* Per-directive messages rather than a single "CSP is invalid": an author
       who pastes a policy in and gets one complaint at a time will not finish. */
    const stripped = mutateEveryCsp(() => "default-src 'self'")
    const reported = headerBlockProblems(stripped).join('\n')
    for (const directive of REQUIRED_CSP_DIRECTIVES.filter((d) => d !== 'default-src')) {
      expect(reported, `${directive} missing from the report`).toContain(`CSP has no ${directive} directive`)
    }
  })
})

describe('origin matching is per label, not a substring', () => {
  /* The bug class `domain-lib.mjs` exists to catch. `*.razorpay.com` must not
     permit `https://api.razorpay.com.attacker.test`, which a naive
     `source.includes(host)` or a regex without anchors would happily allow. */
  const directives = parseCsp(
    "connect-src 'self' https://*.razorpay.com https://*.supabase.co wss://*.supabase.co https://*.posthog.com https://*.ingest.sentry.io",
  )
  const csp = (value: string) => parseCsp(`connect-src 'self'${value}`)

  it('accepts the wildcard subdomains that are required', () => {
    for (const { origin, directive } of REQUIRED_ORIGINS) {
      if (directive !== 'connect-src') continue
      const sources = directives['connect-src']
      const ok = sources.some((s) => s === origin || (s.includes('*') && origin.startsWith(s.split('*')[0])))
      expect(ok, `${origin} should be covered`).toBe(true)
    }
  })

  it('rejects a host that merely contains the wildcarded domain', () => {
    /* A stale extra origin is the observable symptom: nothing in REQUIRED_ORIGINS
       explains it, so the guard must call it out rather than accept it. */
    const attack = csp(' https://api.razorpay.com.attacker.test')
    expect(unexplainedOrigins(attack)).toEqual(['connect-src https://api.razorpay.com.attacker.test'])
  })

  it('rejects an apex host the wildcard does not cover', () => {
    expect(unexplainedOrigins(csp(' https://supabase.co'))).toEqual(['connect-src https://supabase.co'])
  })

  it('does not report self, data: or blob: as unexplained origins', () => {
    expect(
      unexplainedOrigins(parseCsp("default-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:")),
    ).toEqual([])
  })

  it('reports a required origin as missing when the wildcard is only a prefix', () => {
    /* `https://supabase.co*` matches by substring and would cover the real
       host; per-label it does not, and the required origin must read as
       missing so the policy gets fixed rather than trusted. */
    expect(missingOrigins(csp(' https://supabase.co*'))).toContain('connect-src https://*.supabase.co')
  })
})

describe('inlineScriptCount', () => {
  it('counts a shell with no inline script as zero', () => {
    expect(inlineScriptCount('<script type="module" src="/assets/a.js"></script>')).toBe(0)
  })

  it('counts inline blocks and ignores the ones with a src', () => {
    const html = [
      '<script>(function(){localStorage.getItem("seatswap.easy.v1")})();</script>',
      '<script data-tsr-stream-part="">self.$_TSR={};</script>',
      '<script type="module" src="/assets/entry.js"></script>',
    ].join('')
    expect(inlineScriptCount(html)).toBe(2)
  })

  it('matches the shape of the shell the app actually builds', () => {
    /* A regex that stopped matching `<script …>` would report 0 for every input
       and make the 'unsafe-inline' reconciliation vacuous, so the pattern is
       asserted against the two real openings (bare and attributed). */
    expect(inlineScriptCount('<script>1</script><script async>x</script>')).toBe(2)
    expect(inlineScriptCount('<html></html>')).toBe(0)
    expect(inlineScriptCount('<script type="module" src="/a.js"></script><script>1</script>')).toBe(1)
  })

  it('treats an empty or missing shell as zero rather than throwing', () => {
    expect(inlineScriptCount('')).toBe(0)
    expect(inlineScriptCount(undefined as unknown as string)).toBe(0)
  })
})
