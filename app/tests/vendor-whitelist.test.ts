/* vendor-whitelist: docs/12 §2 enforced rather than merely stated.
 *
 * WHY THESE EXIST. docs/12 §2 says "only vendors marked WIRED in docs/12 §2 may
 * appear in code, package.json, or config" — and until now nothing checked it,
 * so it held only until the first agent who had not read it. The ledger also
 * records six tools deliberately NOT adopted, which is exactly the list a
 * future agent would be tempted to wire up because the account already exists.
 *
 * The functions are imported from `scripts/vendor-whitelist.mjs`, which imports
 * NOTHING. `collab-check.mjs` cannot be imported from a test: it pulls in
 * `node:child_process`, and docs/11 records what that did when
 * `translator-lib.mjs` did the same — it broke collection for six lanes under
 * the jsdom pool.
 *
 * The load-bearing test is the last one: it runs the shipped parser against the
 * REAL docs/12 and the REAL package.json. A guard proven only against fixtures
 * is a guard that can be green while the file it reads has changed shape.
 */
import { describe, expect, it } from 'vitest'

import {
  findBanned,
  importSpecifiers,
  normalise,
  parseVendorLedger,
  vendorFor,
} from '../scripts/vendor-whitelist.mjs'

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')
const LEDGER = join(REPO, 'docs', '12-INFRA-CREDITS.md')

const TABLE = [
  '| Vendor      | Credit / plan              | Job (this app)              | Status    | Never for                    |',
  '|-------------|----------------------------|-----------------------------|-----------|------------------------------|',
  '| Cloudflare  | $10,000                    | hosting, cron, queues, R2   | WIRED     | databases (no D1 rewrite)    |',
  '| Azure       | $5,000 exp 2027-06-14      | one-shot batch              | RESERVE   | anything persistent          |',
  '| Mixpanel    | live project, no SDK       | analytics fallback          | BENCH     | —                            |',
  '| Student Pack| domain, Copilot Pro        | domain → Cloudflare DNS     | PARTIAL   | persistent infra on DO/Azure |',
].join('\n')

describe('parseVendorLedger', () => {
  it('reads the vendor from cell 1 and the status from cell 4', () => {
    const vendors = parseVendorLedger(TABLE)
    expect(vendors).toContainEqual({ name: 'Cloudflare', status: 'WIRED' })
    expect(vendors).toContainEqual({ name: 'Azure', status: 'RESERVE' })
    expect(vendors).toContainEqual({ name: 'Mixpanel', status: 'BENCH' })
  })

  it('keeps a status it has never seen, instead of dropping the row', () => {
    /* The failure this prevents: an allow-list of known statuses would silently
       skip any row whose status someone invents later, and a skipped row is an
       unguarded vendor that reads as a clean result. */
    expect(parseVendorLedger(TABLE)).toContainEqual({ name: 'Student Pack', status: 'PARTIAL' })
  })

  it('skips the header and the separator row', () => {
    const names = parseVendorLedger(TABLE).map((v) => v.name)
    expect(names).not.toContain('Vendor')
    expect(names.every((n) => /[a-z]/i.test(n))).toBe(true)
  })

  it('returns nothing for text that is not the table, so the caller can tell "blind" from "clean"', () => {
    expect(parseVendorLedger('# 12 — heading only\n\nno table here\n')).toEqual([])
    expect(parseVendorLedger('')).toEqual([])
  })
})

describe('vendorFor', () => {
  const vendors = parseVendorLedger(TABLE)

  it('matches through a scope and a dash', () => {
    expect(vendorFor('@cloudflare/workers-types', vendors)).toEqual({
      name: 'Cloudflare',
      status: 'WIRED',
    })
    expect(vendorFor('@datadog/browser-rum', [{ name: 'Datadog', status: 'BENCH' }])).toEqual({
      name: 'Datadog',
      status: 'BENCH',
    })
  })

  it('returns null for a package that names no vendor', () => {
    for (const pkg of ['react', 'clsx', 'lucide-react', 'class-variance-authority', 'jsdom']) {
      expect(vendorFor(pkg, vendors)).toBeNull()
    }
  })

  it('normalises case, scope and punctuation away', () => {
    expect(normalise('@supabase/supabase-js')).toBe('supabasesupabasejs')
    expect(normalise('Student Pack')).toBe('studentpack')
  })
})

describe('findBanned', () => {
  const vendors = parseVendorLedger(TABLE)

  it('flags an entry whose vendor is not WIRED, and names both', () => {
    expect(findBanned(['mixpanel-browser'], vendors)).toEqual([
      { pkg: 'mixpanel-browser', vendor: 'Mixpanel', status: 'BENCH' },
    ])
    expect(findBanned(['@azure/storage-blob'], vendors)).toEqual([
      { pkg: '@azure/storage-blob', vendor: 'Azure', status: 'RESERVE' },
    ])
  })

  it('leaves a WIRED vendor alone', () => {
    expect(findBanned(['@cloudflare/workers-types'], vendors)).toEqual([])
  })

  it('leaves vendor-free packages alone, so it is not just flagging everything', () => {
    expect(findBanned(['react', 'react-dom', 'vite', 'typescript'], vendors)).toEqual([])
  })

  it('answers the same question for an import as for a dependency', () => {
    /* One implementation, two callers — a dependency and an import cannot drift
       into disagreeing about the same package. `posthog-js` is in the source but
       not in this fixture's ledger, so it must not be flagged: the guard reports
       vendors it knows are not WIRED, not packages it does not recognise. */
    const src = `import posthog from 'posthog-js'\nimport { x } from '@azure/storage-blob'\n`
    expect(findBanned(importSpecifiers(src), vendors)).toEqual([
      { pkg: '@azure/storage-blob', vendor: 'Azure', status: 'RESERVE' },
    ])
  })
})

describe('importSpecifiers', () => {
  it('reads all four spellings', () => {
    const src = [
      `import a from 'pkg-a'`,
      `import 'pkg-b'`,
      `const c = await import('pkg-c')`,
      `const d = require('pkg-d')`,
    ].join('\n')
    expect(importSpecifiers(src).sort()).toEqual(['pkg-a', 'pkg-b', 'pkg-c', 'pkg-d'])
  })

  it('drops relative and absolute paths, which name no vendor', () => {
    const src = `import x from './lib/x'\nimport y from '../y'\nimport z from '/abs/z'\n`
    expect(importSpecifiers(src)).toEqual([])
  })
})

/* The real files. Everything above proves the logic; this proves the logic is
   pointed at the repo that actually ships. */
describe('the shipped repo', () => {
  const ledger = readFileSync(LEDGER, 'utf8')
  const vendors = parseVendorLedger(ledger)
  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))

  it('parses the real ledger into a non-empty vendor list', () => {
    /* Without this, a broken parser would make the next assertion pass
       vacuously — "no banned vendors" and "no vendors at all" read alike. */
    expect(vendors.length).toBeGreaterThan(10)
    expect(vendors).toContainEqual({ name: 'Supabase', status: 'WIRED' })
    expect(vendors).toContainEqual({ name: 'Azure', status: 'RESERVE' })
    expect(vendors).toContainEqual({ name: 'Mixpanel', status: 'BENCH' })
  })

  it('has no dependency naming a vendor that is not WIRED', () => {
    const deps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]
    expect(findBanned(deps, vendors)).toEqual([])
  })

  it('has no source import naming a vendor that is not WIRED', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'dist') continue
          walk(full)
        } else if (/\.tsx?$/.test(e.name)) files.push(full)
      }
    }
    walk(join(APP, 'src'))

    const specifiers = files.flatMap((f) => importSpecifiers(readFileSync(f, 'utf8')))
    expect(specifiers.length).toBeGreaterThan(20)
    expect(findBanned(specifiers, vendors)).toEqual([])
  })
})
