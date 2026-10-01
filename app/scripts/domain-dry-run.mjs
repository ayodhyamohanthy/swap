#!/usr/bin/env node
/* domain-dry-run.mjs — is the custom domain attachable yet, and to whom is what owed?
 *
 * USAGE
 *   node app/scripts/domain-dry-run.mjs            # measures DNS (read-only)
 *   node app/scripts/domain-dry-run.mjs --offline  # docs-only, zero queries
 *   node app/scripts/domain-dry-run.mjs --repo DIR # read the contract from DIR
 *
 * `--repo` exists for the tests, for the reason `azure/burndown-dry-run.mjs`
 * grew `--scan`: without it the only way to exercise the failure path is to
 * plant a doctored file in the real tree, and a fixture planted where a live
 * run can see it is a fixture that eventually gets committed or swept. With it,
 * each test builds a throwaway directory and the repo under development is
 * never a test input.
 *
 * WHY THIS ONE TOUCHES THE NETWORK WHEN THE OTHER DRY RUNS PROVE THEY DO NOT.
 * `staging-dry-run.mjs` and `azure/burndown-dry-run.mjs` answer "would this
 * spend money?", and the honest proof is that they cannot reach the network at
 * all. This one answers a different question — "where do this zone's
 * nameservers point RIGHT NOW?" — which is a fact about the world and cannot be
 * derived from the repo. So it queries DNS, and the safety claim is narrower
 * and stated plainly:
 *
 *   - read-only. `node:dns` resolves names; it cannot create, change or delete
 *     a record, and there is no Cloudflare API call here because there is no
 *     `node:https`, no `fetch` and no credential of any kind.
 *   - $0. DNS resolution is free and unauthenticated.
 *   - recorded. Every question asked is logged and the count is in the success
 *     token, so "read-only" is a checkable claim rather than a promise — the
 *     test runs `--offline` and asserts `dns=0`.
 *
 * WHY IT EXISTS AT ALL. Build-plan item 4 was blocked on a human moving the
 * zone's nameservers, and that blocker was recorded as a dated comment inside
 * `app/wrangler.toml`. Comments do not notice when the world changes: the
 * measurement there was two days stale, and every agent since had to take it on
 * faith. This re-measures on demand, and it is also the thing that will confirm
 * the item is DONE — the day the nameservers move, it verifies the records and
 * the TTL instead of trusting that someone set them to 300.
 *
 * The decisions live in `domain-lib.mjs`, which imports nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as dns } from 'node:dns'
import { execFileSync } from 'node:child_process'
import {
  attachVerdict,
  classifyNameservers,
  driftFindings,
  parseDomainExclusions,
  parseDomainLedger,
  parseDomainPaths,
  parseRequiredRecords,
  recordFindings,
  unlistedMentions,
  wranglerRoutes,
} from './domain-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF_APP = join(HERE, '..')

/** The value following `flag` on the command line, or `null`. */
function argValue(flag) {
  const at = process.argv.indexOf(flag)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const repoArg = argValue('--repo')
const REPO = repoArg ? resolve(repoArg) : join(SELF_APP, '..')
const APP = repoArg ? join(REPO, 'app') : SELF_APP
const DOCS12 = join(REPO, 'docs', '12-INFRA-CREDITS.md')

const offline =
  process.argv.includes('--offline') || process.env.DOMAIN_DRYRUN_OFFLINE === '1'

/* Every DNS question asked, so the read-only claim is checkable rather than
   asserted. Hostnames and record types only — never a URL, because this script
   has no way to make one. */
const queries = []

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/* Directories the scan does not enter, and the size above which a file is not
   read. Both are printed in the output rather than left implicit: a skip nobody
   can see is a skip nobody can audit, and `node_modules` alone is most of the
   tree. Symlinks are skipped too, so a link pointing back up cannot loop. */
const SCAN_SKIP = new Set(['.git', 'node_modules', 'dist', '.tanstack'])
const SCAN_MAX_BYTES = 1_000_000

/**
 * Every file under `root` that contains `needle`, with a count.
 *
 * A filesystem walk rather than `git grep` because the tests point `--repo` at a
 * throwaway directory that is not a repository, and a scan that silently finds
 * nothing there would make the completeness check pass for the wrong reason. It
 * also sees untracked files, which is the point: a new file naming the domain is
 * a gap in the ledger the moment it is written, not the moment it is committed.
 *
 * @returns {{ mentions: { path: string, count: number }[], scanned: number, skipped: number }}
 */
function scanRepo(root, needle) {
  if (!needle) return { mentions: [], scanned: 0, skipped: 0 }
  const mentions = []
  let scanned = 0
  let skipped = 0
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      skipped += 1
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SCAN_SKIP.has(entry.name)) {
          skipped += 1
          continue
        }
        stack.push(full)
        continue
      }
      if (!entry.isFile()) {
        skipped += 1
        continue
      }
      let size
      try {
        size = statSync(full).size
      } catch {
        skipped += 1
        continue
      }
      if (size > SCAN_MAX_BYTES) {
        skipped += 1
        continue
      }
      const text = read(full)
      if (text == null) {
        skipped += 1
        continue
      }
      scanned += 1
      const count = text.split(needle).length - 1
      if (count > 0) mentions.push({ path: relative(root, full), count })
    }
  }
  return { mentions, scanned, skipped }
}

async function resolveAddresses(name) {
  const addresses = []
  for (const [type, fn] of [
    ['A', dns.resolve4],
    ['AAAA', dns.resolve6],
    ['CNAME', dns.resolveCname],
  ]) {
    queries.push({ name, type })
    try {
      const answer = await fn.call(dns, name)
      for (const value of answer ?? []) addresses.push(String(value))
    } catch {
      /* NXDOMAIN, SERVFAIL and "no answer" all mean the same thing here: this
         record type is not what the domain is served by. */
    }
  }
  return addresses
}

/**
 * TTL from `dig`, or `null` when `dig` is unavailable or says nothing.
 *
 * Node's resolver deliberately does not expose TTL, so the choice is between
 * shelling out and reporting "unverified". Reporting a number it did not read
 * would be worse than either, and `recordFindings` turns `null` into an explicit
 * `ttl-unverified` note rather than a pass.
 */
function digTtl(name, type) {
  if (offline) return null
  queries.push({ name, type: `${type} (ttl)` })
  try {
    /* execFileSync with an argument array and no `shell: true`: nothing here is
       interpolated into a command line, so a domain from docs/12 cannot become
       an argument to anything else. */
    const out = execFileSync('dig', ['+noall', '+answer', name, type], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    const ttls = out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => Number(line.split(/\s+/)[1]))
      .filter(Number.isFinite)
    return ttls.length > 0 ? Math.min(...ttls) : null
  } catch {
    return null
  }
}

async function measure(ledger, records) {
  queries.push({ name: ledger.domain, type: 'NS' })
  let nsHosts = []
  try {
    nsHosts = await dns.resolveNs(ledger.domain)
  } catch {
    nsHosts = []
  }
  const ns = classifyNameservers(nsHosts, ledger.zoneMustBeOn)

  /* Records are only meaningful once the zone is on the provider: before that,
     whatever answers is the registrar's parking, and reporting the required
     records as "absent" would be true but useless next to the real blocker. */
  if (ns !== 'on-provider') {
    return { ns, nsHosts, resolved: [], findings: [], recordsSkipped: true }
  }

  const resolved = []
  for (const record of records) {
    const addresses = await resolveAddresses(record.name)
    const type = /cname/i.test(record.type) ? 'CNAME' : 'A'
    resolved.push({ name: record.name, addresses, ttl: digTtl(record.name, type) })
  }
  return {
    ns,
    nsHosts,
    resolved,
    findings: recordFindings(records, resolved, ledger.ttl),
    recordsSkipped: false,
  }
}

function head(text) {
  console.log(`\n${text}`)
}

async function main() {
  const blockers = []

  head('domain dry run — docs/12 §4.1 vs. the world')
  /* Printed so a `--repo` run cannot pass vacuously by having silently read the
     real docs/12 — the output names the contract it actually used. */
  console.log(`  docs:   ${repoArg ? join(repoArg, 'docs', '12-INFRA-CREDITS.md') : 'docs/12-INFRA-CREDITS.md'}`)
  console.log(`  mode:   ${offline ? 'OFFLINE (no DNS queried)' : 'live (read-only DNS, $0, no credentials)'}`)
  console.log(`  measured: ${new Date().toISOString()}`)

  const docs12 = read(DOCS12)
  if (docs12 === null) {
    console.log('\n=== BLOCKERS ===')
    console.log('  x docs/12-INFRA-CREDITS.md is unreadable — the domain contract cannot be checked')
    console.log('\nDOMAIN-DRYRUN-FAILED')
    process.exit(1)
  }

  const ledger = parseDomainLedger(docs12)
  const records = parseRequiredRecords(docs12)
  const paths = parseDomainPaths(docs12)
  const excluded = parseDomainExclusions(docs12)

  head('1. the contract, as docs/12 §4.1 records it')
  if (!ledger.found) {
    console.log('  x no §4.1 section — every check below is blind')
  } else {
    console.log(`  domain:      ${ledger.domain || '(blank)'}`)
    console.log(`  status:      ${ledger.status || '(blank)'}`)
    console.log(`  dns-ttl:     ${Number.isFinite(ledger.ttl) ? `${ledger.ttl}s` : '(unusable)'}`)
    console.log(`  zone must be on: ${ledger.zoneMustBeOn || '(blank)'}`)
    console.log(`  serving now: ${ledger.servingNow || '(blank)'}`)
    console.log(`  ${records.length} required record(s), ${paths.length} path(s) that must name the domain`)
    console.log(`  ${excluded.length} path(s) allowed to keep naming the OLD one`)
  }

  head('2. drift — does every listed file still agree?')
  const files = paths.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    text: read(join(REPO, entry.path)),
  }))
  const drift = driftFindings(ledger.domain, files)
  if (drift.length === 0) {
    console.log(`  ✓ ${files.length} file(s) agree on ${ledger.domain || '(no domain recorded)'}`)
  } else {
    for (const finding of drift) {
      const detail = finding.found.length > 0 ? ` — declares ${finding.found.join(', ')}` : ''
      console.log(`  x ${finding.path} (${finding.kind}): ${finding.problem}${detail}`)
    }
  }

  head('3. wrangler routes')
  const routes = wranglerRoutes(read(join(APP, 'wrangler.toml')) ?? '')
  if (routes.length === 0) {
    console.log('  no routes line at all — the custom domain is not wired, even in preparation')
  }
  for (const route of routes) {
    console.log(
      `  ${route.commented ? 'commented (prepared, not wired)' : 'LIVE'}: pattern=${route.pattern} zone_name=${route.zoneName}`,
    )
  }

  head('4. the world')
  const measurement = offline
    ? { ns: 'none', nsHosts: [], resolved: [], findings: [], recordsSkipped: true }
    : await measure(ledger, records)
  if (offline) {
    console.log('  not measured (--offline)')
  } else {
    console.log(`  NS for ${ledger.domain}: ${measurement.nsHosts.join(', ') || '(none answered)'}`)
    console.log(`  classification: ${measurement.ns}`)
    if (measurement.recordsSkipped) {
      console.log('  record + TTL checks skipped: they mean nothing until the zone is on the provider')
    }
    for (const entry of measurement.resolved) {
      console.log(
        `  ${entry.name}: ${entry.addresses.length > 0 ? entry.addresses.join(', ') : '(no answer)'} ttl=${entry.ttl ?? 'unverified'}`,
      )
    }
  }

  head('5. completeness — is every file naming the domain in one of the two tables?')
  const scan = scanRepo(REPO, ledger.domain)
  const unlisted = unlistedMentions(ledger.domain, scan.mentions, paths, excluded)
  console.log(
    `  scanned ${scan.scanned} file(s), skipped ${scan.skipped} (not entered: ${[...SCAN_SKIP].join(', ')}; over ${SCAN_MAX_BYTES} bytes; not a regular file)`,
  )
  console.log(`  ${scan.mentions.length} file(s) name ${ledger.domain || '(no domain recorded)'}`)
  if (scan.scanned === 0) {
    console.log('  x the scan read nothing — completeness is unmeasured, not satisfied')
  } else if (unlisted.length === 0) {
    console.log(`  ✓ each is listed (${paths.length}) or excluded with a reason (${excluded.length})`)
  } else {
    for (const mention of unlisted) {
      console.log(`  x ${mention.path} (${mention.count}×) is in neither §4.1 table`)
    }
  }

  const verdict = attachVerdict({
    ledger: ledger.found ? ledger : null,
    drift,
    ns: offline ? 'none' : measurement.ns,
    records: measurement.findings,
    routes,
    offline,
    requiredRecords: records,
    listedPaths: paths,
    unlisted,
    scanned: scan.scanned,
  })

  head('=== VERDICT ===')
  console.log(`  attachable: ${verdict.attachable}`)
  if (verdict.blockers.length > 0) {
    console.log('\n=== BLOCKERS ===')
    for (const blocker of verdict.blockers) console.log(`  x ${blocker}`)
  }
  if (verdict.notes.length > 0) {
    console.log('\n=== NOTES ===')
    for (const note of verdict.notes) console.log(`  ! ${note}`)
  }

  head('=== WHAT IS OWED, BY WHOM ===')
  for (const step of verdict.next) console.log(`  → ${step}`)
  if (verdict.next.length === 0) console.log('  nothing — the domain is attached and verified')
  console.log('  Also recorded in docs/12 §4.1: the root CNAME is inert (GitHub Pages was')
  console.log('  deleted 2026-09-29), and item 3\'s backup alert cannot verify a sending')
  console.log('  domain until this item closes, so its failure notice stays undeliverable.')

  /* The token comes LAST and only on success, so a run that found a blocker can
     never print it and still exit 1 — the defect `azure/burndown-dry-run.mjs`
     had, and the reason the test asserts this line's ABSENCE on failure. */
  if (verdict.blockers.length > 0) {
    console.log(`\nDOMAIN-DRYRUN-FAILED domain=${ledger.domain || '-'} ns=${offline ? 'unmeasured' : measurement.ns} blockers=${verdict.blockers.length} scanned=${scan.scanned} dns=${queries.length} spend=0.00`)
    process.exit(1)
  }
  console.log(`\nDOMAIN-DRYRUN-OK domain=${ledger.domain} ns=${offline ? 'unmeasured' : measurement.ns} attachable=${verdict.attachable} records=${records.length} drift=0 unlisted=0 scanned=${scan.scanned} blockers=0 warnings=${verdict.notes.length} dns=${queries.length} spend=0.00`)
}

await main()
