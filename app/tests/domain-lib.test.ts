/* The domain contract: docs/12 §4.1 is the source of truth, and it is checked.
 *
 * WHY THESE EXIST. docs/10's L9 item 4 asks for a claimed domain wired into
 * Cloudflare DNS at TTL 300 and into wrangler's routes. The claim and the
 * nameserver move are a human's, and `app/wrangler.toml` is L1's surface, so
 * what can be proven here is proven here: that the domain is recorded ONCE
 * rather than copied six times, that every file which names it still agrees,
 * and that the command which answers "is it attachable yet?" measures the world
 * instead of trusting a two-day-old comment.
 *
 * The name itself is listed in docs/10 under "Placeholders to replace", which is
 * the whole argument for the drift check: the one certainty about this contract
 * is that its central value changes, and a value copied into five files with
 * nothing comparing them drifts silently on the day it is swapped.
 *
 * The functions come from `scripts/domain-lib.mjs`, which imports NOTHING. The
 * CLI cannot be imported from a test — docs/11 records what `node:fs` under the
 * jsdom pool cost six lanes — so it is spawned, against a throwaway `--repo`
 * rather than against fixtures planted in the real tree.
 *
 * The last two describe blocks are the load-bearing ones: they run the shipped
 * code against the REAL docs/12, the REAL CNAME and the REAL wrangler.toml, and
 * they assert that §4.1's four new tables did not break the two parsers that
 * already read docs/12. A guard proven only against fixtures can be green while
 * the thing it reads has changed shape.
 */
import { afterAll, describe, expect, it } from 'vitest'

import {
  attachVerdict,
  classifyNameservers,
  cnameDomain,
  domainsDeclaredBy,
  driftFindings,
  isSameOrSubdomain,
  normaliseHost,
  normalisePath,
  parseDomainExclusions,
  parseDomainLedger,
  parseDomainPaths,
  parseRequiredRecords,
  recordFindings,
  unlistedMentions,
  wranglerRoutes,
} from '../scripts/domain-lib.mjs'
import type {
  DomainExclusion,
  DomainLedger,
  DomainPath,
  DriftFile,
  Mention,
  NameserverClass,
  RequiredRecord,
  Verdict,
  VerdictInput,
  WranglerRoute,
} from '../scripts/domain-lib.mjs'
import { parseProjectRefs } from '../scripts/staging-lib.mjs'
import { parseVendorLedger } from '../scripts/vendor-whitelist.mjs'

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { spawnSync } = process.getBuiltinModule('node:child_process') as typeof import('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } =
  process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { tmpdir } = process.getBuiltinModule('node:os') as typeof import('node:os')
const { dirname, join } = process.getBuiltinModule('node:path') as typeof import('node:path')

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')
const CLI = join(APP, 'scripts', 'domain-dry-run.mjs')
const DOCS12 = join(REPO, 'docs', '12-INFRA-CREDITS.md')
const WRANGLER = join(APP, 'wrangler.toml')
const CNAME = join(REPO, 'CNAME')

/* Derived from the committed ledger rather than written down here. A literal in
   this file would be a tenth copy of a name scheduled for replacement — and the
   completeness check would (correctly) report this very file as a mention that
   is in neither §4.1 table. Throwing rather than defaulting matters: with an
   empty domain every fixture below would build itself around '' and pass. */
const COMMITTED_LEDGER = parseDomainLedger(readFileSync(DOCS12, 'utf8'))
if (!COMMITTED_LEDGER.domain) {
  throw new Error('docs/12 §4.1 names no domain — the fixtures in this file cannot be built')
}
const DOMAIN = COMMITTED_LEDGER.domain

/* ---- fixtures ---- */

/** A docs/12 whose §4.1 holds all four tables, in the shipped shape. */
function ledgerDoc(
  overrides: { domain?: string; ttl?: string; paths?: string; records?: string; excluded?: string } = {},
) {
  const domain = overrides.domain ?? DOMAIN
  return [
    '# 12 — Infrastructure & Credits Ledger',
    '',
    '## §2 Vendor ledger',
    '| Vendor | Credit / plan | Job | Status | Never for |',
    '|--------|---------------|-----|--------|-----------|',
    '| Cloudflare | $10k | hosting | WIRED | — |',
    '',
    '## §4.1 Domain & DNS',
    'Prose that mentions no table.',
    '',
    '| Key | Value |',
    '|-----|-------|',
    `| domain | ${domain} |`,
    '| status | placeholder |',
    `| dns-ttl | ${overrides.ttl ?? '300'} |`,
    '| zone-must-be-on | cloudflare |',
    '| serving-now | seatswap.ayodhya-711.workers.dev |',
    '',
    overrides.records ??
      [
        '| Record | Type | Value |',
        '|--------|------|-------|',
        `| ${domain} | A / AAAA | proxied to the worker |`,
        `| www.${domain} | CNAME | ${domain} |`,
      ].join('\n'),
    '',
    overrides.paths ??
      ['| Path | Kind |', '|------|------|', '| CNAME | config |', '| app/wrangler.toml | config |'].join('\n'),
    '',
    /* The ledger names the domain in its own tables, so it has to exclude
       itself or the completeness check reports the contract for stating the
       contract. Same row the shipped §4.1 carries. */
    overrides.excluded ??
      [
        '| Excluded path | Why |',
        '|---------------|-----|',
        '| docs/12-INFRA-CREDITS.md | the ledger itself |',
      ].join('\n'),
    '',
    '## §5 Backups & exit',
    'Nightly workflow.',
    '',
  ].join('\n')
}

const GOOD_LEDGER: DomainLedger = {
  found: true,
  domain: DOMAIN,
  status: 'placeholder',
  ttl: 300,
  zoneMustBeOn: 'cloudflare',
  servingNow: 'seatswap.ayodhya-711.workers.dev',
}

const REQUIRED_RECORDS: RequiredRecord[] = [
  { name: DOMAIN, type: 'A / AAAA', value: 'proxied to the worker' },
  { name: `www.${DOMAIN}`, type: 'CNAME', value: DOMAIN },
]

const LISTED_PATHS: DomainPath[] = [
  { path: 'CNAME', kind: 'config' },
  { path: 'app/wrangler.toml', kind: 'config' },
]

const EXCLUSIONS: DomainExclusion[] = [{ path: 'docs/12-INFRA-CREDITS.md', why: 'the ledger itself' }]

/** What a whole-repo scan would have found, in the shape `unlistedMentions` takes. */
const SCAN_HITS: Mention[] = [
  { path: 'CNAME', count: 1 },
  { path: 'app/wrangler.toml', count: 3 },
  { path: 'docs/12-INFRA-CREDITS.md', count: 4 },
]

function verdictInput(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    ledger: GOOD_LEDGER,
    drift: [],
    ns: 'on-provider' as NameserverClass,
    records: [],
    routes: [{ pattern: `${DOMAIN}/*`, zoneName: DOMAIN, commented: false }] as WranglerRoute[],
    offline: false,
    requiredRecords: REQUIRED_RECORDS,
    listedPaths: LISTED_PATHS,
    unlisted: [],
    scanned: 496,
    ...overrides,
  }
}

const tempDirs: string[] = []

/** A throwaway repo, so no fixture is ever planted where a live run can see it. */
function tempRepo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'domain-dryrun-'))
  tempDirs.push(dir)
  for (const [rel, body] of Object.entries(files)) {
    const at = join(dir, rel)
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, body)
  }
  return dir
}

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOMAIN_DRYRUN_OFFLINE: '' },
  })
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/* ---- host comparison ---- */

describe('normaliseHost / isSameOrSubdomain', () => {
  it('lowercases, trims and drops a trailing root dot', () => {
    expect(normaliseHost('  ARA.ns.Cloudflare.COM. ')).toBe('ara.ns.cloudflare.com')
    expect(normaliseHost('')).toBe('')
  })

  it('accepts the domain itself and anything under it', () => {
    expect(isSameOrSubdomain(DOMAIN, DOMAIN)).toBe(true)
    expect(isSameOrSubdomain(`www.${DOMAIN}`, DOMAIN)).toBe(true)
    expect(isSameOrSubdomain(`a.b.${DOMAIN}`, DOMAIN)).toBe(true)
  })

  /* The endsWith trap, pinned because it is the difference between a subdomain
     check and a suffix check: `evilexample.com`.endsWith('example.com') is true,
     so a naive implementation calls a stranger's domain ours. */
  it('refuses a domain that merely ends with the same letters', () => {
    expect(isSameOrSubdomain(`evil${DOMAIN}`, DOMAIN)).toBe(false)
    expect(isSameOrSubdomain(`not${DOMAIN}`, DOMAIN)).toBe(false)
    expect(isSameOrSubdomain(DOMAIN, '')).toBe(false)
    expect(isSameOrSubdomain('', DOMAIN)).toBe(false)
  })
})

/* ---- reading docs/12 §4.1 ---- */

describe('parseDomainLedger', () => {
  it('reads every key out of the §4.1 table', () => {
    const ledger = parseDomainLedger(ledgerDoc())
    expect(ledger).toEqual(GOOD_LEDGER)
  })

  it('reports a missing §4.1 as not found, not as a clean repo', () => {
    const ledger = parseDomainLedger('# 12\n\n## §5 Backups & exit\nnothing here\n')
    expect(ledger.found).toBe(false)
    expect(ledger.domain).toBe('')
  })

  it('leaves an unusable ttl as NaN rather than defaulting it', () => {
    expect(parseDomainLedger(ledgerDoc({ ttl: 'five minutes' })).ttl).toBeNaN()
    expect(parseDomainLedger(ledgerDoc({ ttl: '' })).ttl).toBeNaN()
  })

  /* Zero parsed is not a pass. A table that lost its header row reports exactly
     what a clean repo reports, and the two mean opposite things, so `found`
     stays true while the values come back empty and the caller fails on them. */
  it('is loud-about-blind when the Key table loses its header', () => {
    const headless = ledgerDoc().replace('| Key | Value |\n|-----|-------|\n', '')
    const ledger = parseDomainLedger(headless)
    expect(ledger.found).toBe(true)
    expect(ledger.domain).toBe('')
    expect(ledger.ttl).toBeNaN()
  })

  it('stops at the next section, so §5 prose cannot become a value', () => {
    const ledger = parseDomainLedger(ledgerDoc())
    expect(ledger.servingNow).toBe('seatswap.ayodhya-711.workers.dev')
    expect(JSON.stringify(ledger)).not.toContain('Nightly')
  })
})

describe('parseRequiredRecords / parseDomainPaths', () => {
  it('reads both records, apex and www', () => {
    const records = parseRequiredRecords(ledgerDoc())
    expect(records.map((r) => r.name)).toEqual([DOMAIN, `www.${DOMAIN}`])
    expect(records[1].type).toBe('CNAME')
  })

  /* Four tables in a row is the shape §4.1 actually has. A reader that treated
     "lines starting with |" as one table would swallow the second header as a
     data row of the first, and every later table with it. */
  it('keeps four consecutive tables separate', () => {
    const doc = ledgerDoc()
    expect(parseDomainLedger(doc).domain).toBe(DOMAIN)
    expect(parseRequiredRecords(doc)).toHaveLength(2)
    expect(parseDomainPaths(doc).map((p) => p.path)).toEqual(['CNAME', 'app/wrangler.toml'])
    expect(parseDomainExclusions(doc).map((r) => r.path)).toEqual(['docs/12-INFRA-CREDITS.md'])
  })

  it('does not filter path kinds, so an invented kind is reported not dropped', () => {
    const doc = ledgerDoc({
      paths: ['| Path | Kind |', '|------|------|', '| CNAME | config |', '| docs/new.md | prose |'].join('\n'),
    })
    expect(parseDomainPaths(doc).map((p) => p.kind)).toEqual(['config', 'prose'])
  })

  it('returns nothing when the tables are absent', () => {
    expect(parseRequiredRecords('no tables here')).toEqual([])
    expect(parseDomainPaths('no tables here')).toEqual([])
    expect(parseDomainExclusions('no tables here')).toEqual([])
  })
})

describe('parseDomainExclusions', () => {
  it('reads the path and the reason, and keeps the two apart', () => {
    const rows = parseDomainExclusions(ledgerDoc())
    expect(rows).toEqual([{ path: 'docs/12-INFRA-CREDITS.md', why: 'the ledger itself' }])
  })

  /* A reason is not decoration: an exclusion is a promise that a file may keep
     naming the OLD domain, so a row with no reason is an unaudited promise. */
  it('keeps a reasonless row rather than dropping it', () => {
    const doc = ledgerDoc({
      excluded: ['| Excluded path | Why |', '|---------------|-----|', '| docs/old.md |  |'].join('\n'),
    })
    expect(parseDomainExclusions(doc)).toEqual([{ path: 'docs/old.md', why: '' }])
  })

  it('does not read the Path table as the Excluded table', () => {
    const rows = parseDomainExclusions(ledgerDoc())
    expect(rows.map((r) => r.path)).not.toContain('CNAME')
  })
})

/* ---- reading the files that must agree ---- */

describe('cnameDomain', () => {
  it('reads a bare hostname, with or without a trailing newline', () => {
    expect(cnameDomain(`${DOMAIN}\n`)).toBe(DOMAIN)
    /* The committed CNAME has no trailing newline — this is not hypothetical. */
    expect(cnameDomain(DOMAIN)).toBe(DOMAIN)
  })

  it('skips comments and drops a root dot', () => {
    expect(cnameDomain(`# GitHub Pages\n${DOMAIN}.\n`)).toBe(DOMAIN)
  })

  it('returns null for an empty file rather than an empty string', () => {
    expect(cnameDomain('')).toBeNull()
    expect(cnameDomain('\n\n')).toBeNull()
  })
})

describe('wranglerRoutes', () => {
  const LIVE = `routes = [{ pattern = "${DOMAIN}/*", zone_name = "${DOMAIN}" }]`

  it('reads a live routes line', () => {
    expect(wranglerRoutes(LIVE)).toEqual([{ pattern: `${DOMAIN}/*`, zoneName: DOMAIN, commented: false }])
  })

  /* The commented case is the one that matters: the shipped wrangler.toml keeps
     its routes line commented precisely BECAUSE the zone is not attachable yet,
     and a reader that only parsed live TOML would report "no routes, nothing to
     disagree" about the one file whose whole point is the pending disagreement. */
  it('reads a commented-out routes line and says it is commented', () => {
    const routes = wranglerRoutes(`# ${LIVE}\n`)
    expect(routes).toEqual([{ pattern: `${DOMAIN}/*`, zoneName: DOMAIN, commented: true }])
  })

  it('finds nothing when there is no routes line', () => {
    expect(wranglerRoutes('name = "seatswap"\n[assets]\ndirectory = "./dist/cf"\n')).toEqual([])
  })

  it('is not fooled by a word ending in routes', () => {
    expect(wranglerRoutes('# some routes = "prose about routes"\n')).toEqual([])
  })

  /* The uncommented form is the dangerous one: a prose line that reads as a
     live routes entry would set `wired`, and `wired` with the zone off
     Cloudflare raises a "zone not found" blocker against a worker that was
     never configured with a route at all. */
  it('does not read prose about routes as a live routes line', () => {
    expect(wranglerRoutes('name = "seatswap"\nroutes = is what L1 will add\n')).toEqual([])
  })

  it('reads an indented routes line', () => {
    expect(wranglerRoutes(`  ${LIVE}\n`)).toEqual([
      { pattern: `${DOMAIN}/*`, zoneName: DOMAIN, commented: false },
    ])
  })
})

describe('domainsDeclaredBy', () => {
  it('reads CNAME by basename', () => {
    expect(domainsDeclaredBy('CNAME', `${DOMAIN}\n`)).toEqual([DOMAIN])
    expect(domainsDeclaredBy('nested/CNAME', DOMAIN)).toEqual([DOMAIN])
  })

  it('reads both the zone and the pattern host out of wrangler.toml', () => {
    const text = `# routes = [{ pattern = "www.${DOMAIN}/*", zone_name = "${DOMAIN}" }]`
    expect(domainsDeclaredBy('app/wrangler.toml', text)).toEqual([DOMAIN, `www.${DOMAIN}`])
  })

  it('handles an environment-suffixed wrangler file the same way', () => {
    expect(domainsDeclaredBy('app/wrangler.staging.toml', `routes = [{ zone_name = "${DOMAIN}" }]`)).toEqual([DOMAIN])
  })

  /* null is not []. An empty array says "this file declares no domain", which
     passes; null says "I do not know how to read this file", which must be
     reported. Collapsing them is how a guard goes blind quietly. */
  it('returns null, not an empty list, for a config shape it cannot read', () => {
    expect(domainsDeclaredBy('app/some-config.json', '{}')).toBeNull()
    expect(domainsDeclaredBy('', DOMAIN)).toBeNull()
  })

  it('returns an empty list for a wrangler file with no routes', () => {
    expect(domainsDeclaredBy('app/wrangler.toml', 'name = "seatswap"\n')).toEqual([])
  })

  /* The multi-line array is legal TOML and this parser reads one line at a
     time, so it finds `routes = [` and no zone name. Returning [] would say
     "declares no domain" — a pass on a file that may declare any zone at all.
     null makes the drift check report that it could not read the file. */
  it('returns null, not an empty list, for a routes line it could not parse', () => {
    const multiline = `routes = [\n  { pattern = "other.example/*", zone_name = "other.example" },\n]\n`
    expect(domainsDeclaredBy('app/wrangler.toml', multiline)).toBeNull()
  })
})

describe('driftFindings', () => {
  const files = (...entries: DriftFile[]) => entries

  it('reports nothing when every file agrees', () => {
    expect(
      driftFindings(
        DOMAIN,
        files(
          { path: 'CNAME', kind: 'config', text: `${DOMAIN}\n` },
          { path: 'app/wrangler.toml', kind: 'config', text: `# routes = [{ zone_name = "${DOMAIN}" }]` },
          { path: 'docs/10-BUILD-PLAN.md', kind: 'doc', text: `planned: ${DOMAIN}` },
        ),
      ),
    ).toEqual([])
  })

  /* The false positive this would otherwise produce: a wrangler pattern is
     allowed to be a subdomain of the zone, so `www.<domain>/*` against a zone of
     `<domain>` is correct, not drift. */
  it('accepts a wrangler pattern that is a subdomain of the canonical domain', () => {
    const found = driftFindings(DOMAIN, [
      { path: 'app/wrangler.toml', kind: 'config', text: `routes = [{ pattern = "www.${DOMAIN}/*", zone_name = "${DOMAIN}" }]` },
    ])
    expect(found).toEqual([])
  })

  it('reports a config file that declares a different domain', () => {
    const found = driftFindings(DOMAIN, [{ path: 'CNAME', kind: 'config', text: 'other.example\n' }])
    expect(found).toEqual([{ path: 'CNAME', kind: 'config', problem: 'mismatch', found: ['other.example'] }])
  })

  it('reports a doc that stopped naming the domain', () => {
    const found = driftFindings(DOMAIN, [{ path: 'docs/16-BEST-PRACTICES.md', kind: 'doc', text: 'zone example.test' }])
    expect(found).toEqual([
      { path: 'docs/16-BEST-PRACTICES.md', kind: 'doc', problem: 'missing', found: [] },
    ])
  })

  it('reports an unreadable file instead of skipping it', () => {
    expect(driftFindings(DOMAIN, [{ path: 'CNAME', kind: 'config', text: null }])).toEqual([
      { path: 'CNAME', kind: 'config', problem: 'unreadable', found: [] },
    ])
  })

  it('reports a kind it does not recognise rather than exempting the file', () => {
    expect(driftFindings(DOMAIN, [{ path: 'x', kind: 'prose', text: 'anything' }])).toEqual([
      { path: 'x', kind: 'prose', problem: 'unknown-kind', found: [] },
    ])
  })

  it('reports a config file whose shape it cannot read', () => {
    expect(driftFindings(DOMAIN, [{ path: 'app/deploy.json', kind: 'config', text: '{}' }])).toEqual([
      { path: 'app/deploy.json', kind: 'config', problem: 'unknown-config', found: [] },
    ])
  })
})

/* ---- is the ledger complete? ---- */

describe('normalisePath / unlistedMentions', () => {
  it('makes two spellings of one path comparable', () => {
    expect(normalisePath('./docs/12-INFRA-CREDITS.md')).toBe('docs/12-INFRA-CREDITS.md')
    expect(normalisePath('  CNAME ')).toBe('CNAME')
    expect(normalisePath('app\\wrangler.toml')).toBe('app/wrangler.toml')
  })

  it('reports a mention that is in neither table', () => {
    expect(
      unlistedMentions(DOMAIN, [...SCAN_HITS, { path: 'app/new.md', count: 2 }], LISTED_PATHS, EXCLUSIONS),
    ).toEqual([{ path: 'app/new.md', count: 2 }])
  })

  it('accepts a mention the ledger lists, and one it excludes with a reason', () => {
    expect(unlistedMentions(DOMAIN, SCAN_HITS, LISTED_PATHS, EXCLUSIONS)).toEqual([])
  })

  /* The comparison is on normalised paths, so a scan reporting `./CNAME` against
     a ledger row reading `CNAME` is a match rather than a finding. */
  it('matches ./CNAME from the scan against CNAME in the ledger', () => {
    expect(unlistedMentions(DOMAIN, [{ path: './CNAME', count: 1 }], LISTED_PATHS, EXCLUSIONS)).toEqual([])
  })

  /* A blank contract is already a blocker in `attachVerdict`. Matching every
     file in the repo against '' would bury that one finding under hundreds. */
  it('looks for nothing when the contract names no domain', () => {
    expect(unlistedMentions('', SCAN_HITS, [], [])).toEqual([])
  })

  it('ignores a hit with no path rather than reporting an empty name', () => {
    expect(unlistedMentions(DOMAIN, [{ path: '', count: 1 }], LISTED_PATHS, EXCLUSIONS)).toEqual([])
  })
})

/* ---- reading the world ---- */

describe('classifyNameservers', () => {
  it('recognises the provider on every nameserver', () => {
    expect(classifyNameservers(['ara.ns.cloudflare.com', 'rick.ns.cloudflare.com'], 'cloudflare')).toBe('on-provider')
  })

  it('recognises a zone still sitting at its registrar', () => {
    /* The real answer for this domain as measured 2026-10-01, root dots and all. */
    expect(classifyNameservers(['dns1.registrar-servers.com.', 'dns2.registrar-servers.com.'], 'cloudflare')).toBe(
      'elsewhere',
    )
  })

  /* Mid-migration is its own state, not a flavour of "not yet": some resolvers
     have the new NS and some the old, so a deploy succeeds or fails depending on
     which one Cloudflare asked. Folding it into `elsewhere` hides that. */
  it('names a half-migrated zone as mixed', () => {
    expect(classifyNameservers(['ara.ns.cloudflare.com', 'dns1.registrar-servers.com'], 'cloudflare')).toBe('mixed')
  })

  it('answers none when nothing replied', () => {
    expect(classifyNameservers([], 'cloudflare')).toBe('none')
    expect(classifyNameservers(['', '.'], 'cloudflare')).toBe('none')
  })

  it('does not claim the provider when the ledger never named one', () => {
    expect(classifyNameservers(['ara.ns.cloudflare.com'], '')).toBe('elsewhere')
  })
})

describe('recordFindings', () => {
  const RECORDS: RequiredRecord[] = [
    { name: DOMAIN, type: 'A / AAAA', value: 'proxied' },
    { name: `www.${DOMAIN}`, type: 'CNAME', value: DOMAIN },
  ]

  it('reports nothing when both records answer at the required TTL', () => {
    expect(
      recordFindings(
        RECORDS,
        [
          { name: DOMAIN, addresses: ['192.0.2.1'], ttl: 300 },
          { name: `www.${DOMAIN}`, addresses: [DOMAIN], ttl: 300 },
        ],
        300,
      ),
    ).toEqual([])
  })

  /* Both records resolve here, so the only finding is the TTL one: `www` sits
     exactly ON the ceiling and must not be reported, because 300 is the number
     docs/16's fast cutover needs and a record that already meets it is done. */
  it('treats the required TTL as a ceiling, not a target to undershoot', () => {
    expect(
      recordFindings(
        RECORDS,
        [
          { name: DOMAIN, addresses: ['192.0.2.1'], ttl: 3600 },
          { name: `www.${DOMAIN}`, addresses: [DOMAIN], ttl: 300 },
        ],
        300,
      ),
    ).toEqual([{ name: DOMAIN, problem: 'ttl-too-high', ttl: 3600 }])
  })

  it('reports a record that does not answer', () => {
    expect(recordFindings(RECORDS, [{ name: DOMAIN, addresses: [], ttl: 300 }], 300)).toEqual([
      { name: DOMAIN, problem: 'absent', ttl: null },
      { name: `www.${DOMAIN}`, problem: 'absent', ttl: null },
    ])
  })

  /* Node's resolver does not expose TTL, so "could not read it" is a real
     outcome. Reporting it as fine would be the guard claiming a check it never
     performed; `ttl-unverified` keeps the number honestly unknown. */
  it('says unverified when the TTL could not be read', () => {
    expect(recordFindings(RECORDS, [{ name: DOMAIN, addresses: ['192.0.2.1'], ttl: null }], 300)).toEqual([
      { name: DOMAIN, problem: 'ttl-unverified', ttl: null },
      { name: `www.${DOMAIN}`, problem: 'absent', ttl: null },
    ])
  })
})

/* ---- the verdict ---- */

describe('attachVerdict', () => {
  it('says yes when the zone is on the provider, wired and clean', () => {
    const verdict = attachVerdict(verdictInput())
    expect(verdict.attachable).toBe('yes')
    expect(verdict.blockers).toEqual([])
  })

  it('refuses to reason at all when §4.1 could not be read', () => {
    const verdict = attachVerdict(verdictInput({ ledger: null }))
    expect(verdict.attachable).toBe('no')
    expect(verdict.blockers[0]).toContain('§4.1 is missing')
    /* Early return: with no contract there is nothing else to say, and piling
       on findings would bury the one that matters. */
    expect(verdict.blockers).toHaveLength(1)
  })

  /* `found: false` with the object still present is the case the null test
     cannot reach: every other guard here would fire on it and drown the real
     message, so "the contract could not be read at all" would come out looking
     like a domain typo. Drift and record findings are supplied to make the
     early return load-bearing rather than merely tidy. */
  it('stops at the unreadable section rather than reasoning past it', () => {
    const verdict = attachVerdict(
      verdictInput({
        ledger: { ...GOOD_LEDGER, found: false },
        ns: 'elsewhere' as NameserverClass,
        drift: [{ path: 'CNAME', kind: 'config', problem: 'mismatch', found: ['other.example'] }],
        records: [{ name: DOMAIN, problem: 'absent', ttl: null }],
      }),
    )
    expect(verdict.blockers).toEqual([expect.stringContaining('§4.1 is missing')])
    expect(verdict.attachable).toBe('no')
  })

  it('fails on a blank domain and on an unusable TTL', () => {
    const blank = attachVerdict(verdictInput({ ledger: { ...GOOD_LEDGER, domain: '' } }))
    expect(blank.blockers.join('\n')).toContain('records no domain')
    const noTtl = attachVerdict(verdictInput({ ledger: { ...GOOD_LEDGER, ttl: Number.NaN } }))
    expect(noTtl.blockers.join('\n')).toContain('no usable dns-ttl')
  })

  /* Zero parsed is not a pass, in both tables. A header row that got edited away
     leaves the contract looking satisfied — "no records required", "no files to
     compare" — which is the same output a clean repo gives and the opposite
     meaning. This is the same reason `parseVendorLedger` refuses to filter to
     statuses it recognises. */
  it('fails when the ledger parsed no required records', () => {
    const verdict = attachVerdict(verdictInput({ requiredRecords: [] }))
    expect(verdict.attachable).toBe('no')
    expect(verdict.blockers.join('\n')).toContain('no required DNS records')
  })

  it('fails when the ledger parsed no paths to compare', () => {
    const verdict = attachVerdict(verdictInput({ listedPaths: [] }))
    expect(verdict.attachable).toBe('no')
    expect(verdict.blockers.join('\n')).toContain('no paths that must name the domain')
  })

  it('answers unmeasured rather than yes when offline', () => {
    /* Absence of blockers is not evidence. Offline the world was never asked, so
       "attachable" must not read as a green light. */
    const verdict = attachVerdict(verdictInput({ offline: true, ns: 'none' }))
    expect(verdict.attachable).toBe('unmeasured')
    expect(verdict.blockers).toEqual([])
    expect(verdict.notes.join('\n')).toContain('no DNS was queried')
  })

  it('names the nameserver move as the blocker, and Ayu as owing it', () => {
    const verdict = attachVerdict(
      verdictInput({ ns: 'elsewhere', routes: [{ pattern: null, zoneName: DOMAIN, commented: true }] }),
    )
    expect(verdict.attachable).toBe('no')
    expect(verdict.blockers.join('\n')).toContain('not attachable')
    expect(verdict.next.join('\n')).toContain('Ayu:')
  })

  it('refuses a half-migrated zone', () => {
    const verdict = attachVerdict(verdictInput({ ns: 'mixed' }))
    expect(verdict.blockers.join('\n')).toContain('mid-migration')
  })

  it('refuses a domain whose nameservers never answer', () => {
    const verdict = attachVerdict(verdictInput({ ns: 'none' }))
    expect(verdict.blockers.join('\n')).toContain('does not resolve')
  })

  /* The expensive shape: a routes line uncommented while the zone is still at
     the registrar is a deploy that fails with "zone not found" — and it is only
     detectable by comparing the file against the world. */
  it('catches an uncommented routes line while the zone is elsewhere', () => {
    const verdict = attachVerdict(verdictInput({ ns: 'elsewhere' }))
    expect(verdict.blockers.join('\n')).toContain('zone not found')
  })

  it('does not guess that verdict offline, and says so', () => {
    const verdict: Verdict = attachVerdict(verdictInput({ ns: 'none', offline: true }))
    expect(verdict.blockers.join('\n')).not.toContain('zone not found')
    expect(verdict.notes.join('\n')).toContain('re-run without --offline')
  })

  it('carries every drift finding into the blockers', () => {
    const verdict = attachVerdict(
      verdictInput({ drift: [{ path: 'CNAME', kind: 'config', problem: 'mismatch', found: ['other.example'] }] }),
    )
    expect(verdict.blockers.join('\n')).toContain('CNAME (config) mismatch declares other.example')
  })

  it('escalates a too-high TTL but only notes an unverifiable one', () => {
    const high = attachVerdict(verdictInput({ records: [{ name: DOMAIN, problem: 'ttl-too-high', ttl: 3600 }] }))
    expect(high.blockers.join('\n')).toContain('TTL 3600')
    const unknown = attachVerdict(verdictInput({ records: [{ name: DOMAIN, problem: 'ttl-unverified', ttl: null }] }))
    expect(unknown.blockers).toEqual([])
    expect(unknown.notes.join('\n')).toContain('TTL unverified')
  })

  /* Ownership: `app/wrangler.toml` is L1's surface per docs/13, so the output
     must not imply that one command in this lane finishes the item. */
  it('attributes the routes change to L1 while it is still commented', () => {
    const verdict = attachVerdict(
      verdictInput({ ns: 'elsewhere', routes: [{ pattern: null, zoneName: DOMAIN, commented: true }] }),
    )
    expect(verdict.next.join('\n')).toContain('L1:')
    expect(verdict.next.join('\n')).toContain("L1's surface")
  })

  /* The drift check can only ever disagree with paths the ledger LISTS, so an
     incomplete ledger reads exactly like a clean repo. These three pin the
     check that the list itself is complete. */
  it('fails when a scanned file names the domain and is in neither table', () => {
    const verdict = attachVerdict(verdictInput({ unlisted: [{ path: 'app/new.md', count: 2 }] }))
    expect(verdict.attachable).toBe('no')
    expect(verdict.blockers.join('\n')).toContain('app/new.md')
    expect(verdict.blockers.join('\n')).toContain('neither §4.1 table')
  })

  it('fails when the scan read nothing rather than reporting completeness', () => {
    const verdict = attachVerdict(verdictInput({ scanned: 0 }))
    expect(verdict.attachable).toBe('no')
    expect(verdict.blockers.join('\n')).toContain('completeness check is blind')
  })

  /* A caller that forgets the field entirely is the case that produced this
     test: `scanned` arrived undefined and, without the guard, would have read
     as "no files unlisted". */
  it('fails when the scan reported no count at all', () => {
    const input = verdictInput() as Partial<VerdictInput>
    delete input.scanned
    const verdict = attachVerdict(input as VerdictInput)
    expect(verdict.blockers.join('\n')).toContain('completeness check is blind')
  })

  it('owes nothing once the domain is attached and verified', () => {
    expect(attachVerdict(verdictInput()).next).toEqual([])
  })
})

/* ---- the shipped contract, read from the real repo ---- */

describe('the committed docs/12 §4.1', () => {
  const doc = readFileSync(DOCS12, 'utf8')
  const ledger = parseDomainLedger(doc)
  const records = parseRequiredRecords(doc)
  const paths = parseDomainPaths(doc)

  it('records a real contract', () => {
    expect(ledger.found, 'docs/12 §4.1 has gone missing, so the domain has no source of truth').toBe(true)
    expect(ledger.domain).not.toBe('')
    expect(ledger.ttl, 'item 4 asks for TTL 300 and nothing else may silently replace it').toBe(300)
    expect(ledger.zoneMustBeOn).toBe('cloudflare')
  })

  it('requires the apex and the www record, without freezing how many', () => {
    const names = records.map((r) => r.name)
    expect(names).toContain(ledger.domain)
    expect(names).toContain(`www.${ledger.domain}`)
  })

  it('lists only paths that still exist, so the drift check cannot skip a deleted file', () => {
    expect(paths.length).toBeGreaterThan(0)
    for (const entry of paths) {
      expect(existsSync(join(REPO, entry.path)), `${entry.path} is listed in docs/12 §4.1 but is not on disk`).toBe(true)
      expect(['config', 'doc'], `${entry.path} has kind "${entry.kind}", which driftFindings would report as unknown`).toContain(
        entry.kind,
      )
    }
  })

  it('has no drift: every listed file still names the recorded domain', () => {
    const files: DriftFile[] = paths.map((entry) => {
      const at = join(REPO, entry.path)
      let text: string | null = null
      try {
        text = readFileSync(at, 'utf8')
      } catch {
        text = null
      }
      return { path: entry.path, kind: entry.kind, text }
    })
    expect(driftFindings(ledger.domain, files)).toEqual([])
  })

  it('has the routes line prepared in wrangler.toml, and still commented', () => {
    const routes = wranglerRoutes(readFileSync(WRANGLER, 'utf8'))
    expect(routes.length, 'wrangler.toml lost its routes line entirely').toBeGreaterThan(0)
    /* Deliberately asserting the CURRENT truth, not the desired one: while the
       zone sits at its registrar an uncommented routes line is a broken deploy.
       When item 4 closes, this is the assertion that should be flipped. */
    for (const route of routes) {
      expect(route.commented, 'the zone is not on Cloudflare yet, so routes must stay commented').toBe(true)
      if (route.zoneName) expect(isSameOrSubdomain(route.zoneName, ledger.domain)).toBe(true)
    }
  })

  it('has a CNAME that agrees with the ledger', () => {
    expect(cnameDomain(readFileSync(CNAME, 'utf8'))).toBe(ledger.domain)
  })

  /* The cross-check that matters most: docs/12 is read by two OTHER guards, and
     §4.1 added four new tables to it. `parseVendorLedger` scans the whole
     document for any table whose fourth cell is one ALL-CAPS word, so a new
     table can quietly become a vendor row and break the whitelist. */
  it('did not corrupt the vendor ledger parser', () => {
    const vendors = parseVendorLedger(doc)
    expect(vendors.length).toBeGreaterThan(0)
    const keys = ['Key', 'Value', 'Record', 'Type', 'Path', 'Kind', 'Excluded path', 'Why', 'domain', 'status', 'dns-ttl']
    for (const vendor of vendors) {
      expect(keys, `docs/12 §4.1 leaked "${vendor.name}" into the vendor ledger`).not.toContain(vendor.name)
    }
    expect(vendors.filter((v) => v.status === 'WIRED').length).toBeGreaterThan(0)
  })

  it('did not corrupt the project-ref parser', () => {
    const refs = parseProjectRefs(doc)
    expect(refs.staging.project).toBe('seatswap-staging')
    expect(refs.prod.project).toBe('seatswap-prod')
  })

  /* Frozen on purpose. An exclusion is a promise that a file may keep naming the
     OLD domain, so adding one should cost an edit here and a reason there — not
     slip in silently. */
  it('excludes exactly the four files allowed to go stale, each with a reason', () => {
    const rows = parseDomainExclusions(doc)
    expect(rows.map((r) => r.path)).toEqual([
      'docs/12-INFRA-CREDITS.md',
      'docs/DECISIONS.md',
      '.workbuddy-ai/memory/2026-09-29.md',
      'lovable build/seatswap-build-pack/docs/10-BUILD-PLAN.md',
    ])
    for (const row of rows) {
      expect(row.why.trim().length, `${row.path} is excluded with no reason`).toBeGreaterThan(0)
    }
  })

  /* The end-to-end form of the same claim: nothing in the tree names the domain
     without the ledger knowing about it. This is the check that would have
     caught `app/tests/domain-lib.test.ts` hardcoding the name — it did, on the
     run that introduced it. */
  it('has no file naming the domain that the ledger does not account for', () => {
    const { status, out } = runCli(['--offline'])
    expect(out, out).not.toContain('is in neither §4.1 table')
    expect(status).toBe(0)
  })
})

/* ---- the CLI ---- */

describe('domain-dry-run.mjs', () => {
  const source = readFileSync(CLI, 'utf8')
  const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])

  /* This dry run MEASURES the world, so unlike its siblings it is allowed to
     reach the network — but only to resolve names. The allow-list is what makes
     "read-only, no credentials, $0" a structural fact instead of a claim: there
     is no HTTP client in it, so there is no Cloudflare API call it could make. */
  it('imports a resolver and no HTTP client', () => {
    const allowed = ['node:fs', 'node:path', 'node:url', 'node:dns', 'node:child_process', './domain-lib.mjs']
    expect(specifiers.length, 'the import scan found nothing, so it is proving nothing').toBeGreaterThan(0)
    for (const spec of specifiers) {
      expect(allowed, `${spec} would give the dry run reach it must not have`).toContain(spec)
    }
    expect(specifiers).toContain('node:dns')
  })

  it('never calls fetch', () => {
    /* Comment lines are stripped first: the header explains that there is no
       fetch here, and grepping the prose would test the sentence, not the code. */
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n')
    expect(code).not.toMatch(/\bfetch\s*\(/)
  })

  it('is green and queries nothing with --offline against the real repo', () => {
    const { status, out } = runCli(['--offline'])
    expect(out, out).toMatch(
      /DOMAIN-DRYRUN-OK domain=\S+ ns=unmeasured attachable=unmeasured records=\d+ drift=0 unlisted=0 scanned=[1-9]\d* blockers=0 warnings=\d+ dns=0 spend=0\.00/,
    )
    expect(status).toBe(0)
  })

  it('prints the token last, after every finding', () => {
    const { out } = runCli(['--offline'])
    expect(out.trimEnd().endsWith('spend=0.00')).toBe(true)
  })

  it('names the --repo it read, so a fixture run cannot pass vacuously', () => {
    const dir = tempRepo({
      'docs/12-INFRA-CREDITS.md': ledgerDoc(),
      CNAME: `${DOMAIN}\n`,
      'app/wrangler.toml': `# routes = [{ pattern = "${DOMAIN}/*", zone_name = "${DOMAIN}" }]\n`,
    })
    const { out } = runCli(['--offline', '--repo', dir])
    expect(out).toContain(dir)
    expect(out).toMatch(/DOMAIN-DRYRUN-OK/)
  })

  /* The defect `azure/burndown-dry-run.mjs` had: printing the success token and
     then exiting 1, so the output carried a green line for a failed run. The
     assertion that matters is the OK token's ABSENCE. */
  it('exits 1 and withholds the OK token when a file disagrees', () => {
    const dir = tempRepo({
      'docs/12-INFRA-CREDITS.md': ledgerDoc(),
      CNAME: 'someone-elses-domain.test\n',
      'app/wrangler.toml': `# routes = [{ zone_name = "${DOMAIN}" }]\n`,
    })
    const { status, out } = runCli(['--offline', '--repo', dir])
    expect(status).toBe(1)
    expect(out).toMatch(/DOMAIN-DRYRUN-FAILED/)
    expect(out).not.toMatch(/DOMAIN-DRYRUN-OK/)
    expect(out).toContain('mismatch')
    expect(out).toMatch(/dns=0/)
  })

  it('exits 1 rather than passing when §4.1 is missing entirely', () => {
    const dir = tempRepo({ 'docs/12-INFRA-CREDITS.md': '# 12\n\n## §5 Backups\n' })
    const { status, out } = runCli(['--offline', '--repo', dir])
    expect(status).toBe(1)
    expect(out).not.toMatch(/DOMAIN-DRYRUN-OK/)
    /* The phrase, not just "§4.1": every other blocker quotes the section, so
       matching on the number would pass on a run that diagnosed the wrong thing. */
    expect(out).toContain('is missing')
  })

  it('exits 1 rather than passing when §4.1 exists but its tables are empty', () => {
    const dir = tempRepo({ 'docs/12-INFRA-CREDITS.md': '## §4.1 Domain & DNS\nprose only, no tables\n\n## §5 x\n' })
    const { status, out } = runCli(['--offline', '--repo', dir])
    expect(status).toBe(1)
    expect(out).not.toMatch(/DOMAIN-DRYRUN-OK/)
  })

  it('exits 1 when docs/12 cannot be read at all', () => {
    const dir = tempRepo({ 'README.md': 'no docs here\n' })
    const { status, out } = runCli(['--offline', '--repo', dir])
    expect(status).toBe(1)
    expect(out).toContain('unreadable')
  })

  /* The file is untracked in a directory that is not a repository, which is the
     reason the scan walks the filesystem instead of running `git grep`: a new
     file naming the domain is a gap in the ledger the moment it is written, not
     the moment somebody commits it. */
  it('exits 1 when a file names the domain and the ledger does not account for it', () => {
    const dir = tempRepo({
      'docs/12-INFRA-CREDITS.md': ledgerDoc(),
      CNAME: `${DOMAIN}\n`,
      'app/wrangler.toml': `# routes = [{ pattern = "${DOMAIN}/*", zone_name = "${DOMAIN}" }]\n`,
      'notes/new-screen.md': `Deploy to ${DOMAIN} once the zone moves.\n`,
    })
    const { status, out } = runCli(['--offline', '--repo', dir])
    expect(status).toBe(1)
    expect(out).not.toMatch(/DOMAIN-DRYRUN-OK/)
    expect(out).toContain('notes/new-screen.md')
    expect(out).toContain('is in neither §4.1 table')
  })

  it('says the completeness check is blind when the contract names no domain', () => {
    const dir = tempRepo({
      'docs/12-INFRA-CREDITS.md': ledgerDoc({ domain: '' }),
      CNAME: `${DOMAIN}\n`,
      'app/wrangler.toml': `# routes = [{ zone_name = "${DOMAIN}" }]\n`,
    })
    const { status, out } = runCli(['--offline', '--repo', dir])
    expect(status).toBe(1)
    expect(out).toContain('completeness check is blind')
    /* Searching for '' would match every file in the repo. It must not: the
       blank-domain blocker is the finding, and a thousand unlisted files would
       bury it. */
    expect(out).not.toContain('is in neither §4.1 table')
    /* The run exits 1 either way, so nothing else pins section 5's own wording —
       and a ✓ printed above the blocker is a green line in a red run, the same
       defect as the early OK token. "Nothing unlisted" and "nothing read" must
       not print the same thing. */
    expect(out).toContain('the scan read nothing')
    expect(out).not.toContain('✓ each is listed')
  })
})
