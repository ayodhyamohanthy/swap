/* domain-lib.mjs — the docs/12 §4.1 domain contract, as pure functions.
 *
 * WHY THIS IS A SEPARATE FILE, and why it has no imports. Same reason as
 * `lane-board.mjs`, `vendor-whitelist.mjs` and `staging-lib.mjs`: the CLI that
 * uses these decisions has to touch the filesystem and the resolver, and a test
 * cannot import a module that does. So the judgement lives here — strings in,
 * decisions out — and `domain-dry-run.mjs` only does I/O.
 *
 * WHY IT DERIVES THE CONTRACT INSTEAD OF HARDCODING IT. The domain, its TTL,
 * the required records and the list of files that must name it are all parsed
 * out of docs/12 §4.1 at check time. docs/10 files the domain itself under
 * "Placeholders to replace", so the one thing certain about this contract is
 * that its central value will change — and a second copy of it in code would be
 * a second thing to rot on the day it does. Swapping the domain in §4.1 is
 * supposed to be the whole change.
 *
 * WHY "ZERO PARSED" IS NEVER A PASS. Every parser here can come back empty: the
 * section can be renumbered, a table can lose its header, a file can go
 * unreadable. An empty result reported as "nothing to check" is indistinguishable
 * from a clean repo and means the opposite thing, so each of those is a finding
 * the caller must fail on rather than a quiet zero.
 */

/** Trim a hostname: lowercase, no trailing root dot. */
export function normaliseHost(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
}

/** `host` is `domain` itself or sits under it. */
export function isSameOrSubdomain(host, domain) {
  const h = normaliseHost(host)
  const d = normaliseHost(domain)
  if (!h || !d) return false
  return h === d || h.endsWith(`.${d}`)
}

/* ---- reading docs/12 §4.1 ---- */

/**
 * The body of one `##` section, heading excluded.
 *
 * Returns `''` both for "no such section" and "section exists but is empty", so
 * callers that care must test `sectionFound` rather than the string.
 */
function sectionBody(text, headingPrefix) {
  const all = String(text ?? '')
  const start = all.indexOf(headingPrefix)
  if (start === -1) return ''
  const rest = all.slice(start)
  const nextHeading = rest.slice(1).search(/^##\s/m)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1)
}

/**
 * Markdown tables in a section, as arrays of trimmed cell arrays.
 *
 * Split on blank-line-delimited blocks rather than "lines starting with |",
 * because §4.1 holds four tables in a row and a run-on reader would swallow
 * the second table's header as a data row of the first.
 */
function tablesIn(section) {
  const out = []
  let block = []
  for (const line of String(section ?? '').split('\n')) {
    if (line.trim().startsWith('|')) {
      block.push(line.trim())
      continue
    }
    if (block.length > 0) {
      out.push(block)
      block = []
    }
  }
  if (block.length > 0) out.push(block)

  return out.map((rows) =>
    rows
      .map((row) => row.split('|').slice(1, -1).map((c) => c.trim()))
      /* Drop the `|---|---|` separator: every cell is nothing but dashes. */
      .filter((cells) => cells.length > 0 && !cells.every((c) => /^:?-+:?$/.test(c))),
  )
}

/** The data rows of the table whose header's first cell is `headerFirst`. */
function tableWithHeader(section, headerFirst) {
  for (const table of tablesIn(section)) {
    if (table.length >= 2 && table[0][0] === headerFirst) return table.slice(1)
  }
  return []
}

/**
 * The §4.1 key/value table.
 *
 * `found` is false when the section itself is missing — the distinction the
 * caller needs, since an absent §4.1 means this whole check is blind, while a
 * present one with a blank `domain` row means something else entirely.
 *
 * @returns {{ found: boolean, domain: string, status: string, ttl: number,
 *             zoneMustBeOn: string, servingNow: string }}
 */
export function parseDomainLedger(docs12Text) {
  const body = sectionBody(String(docs12Text ?? ''), '## §4.1')
  const rows = tableWithHeader(body, 'Key')
  const map = {}
  for (const cells of rows) {
    if (cells[0]) map[cells[0]] = cells[1] ?? ''
  }
  return {
    found: body !== '',
    domain: map['domain'] ?? '',
    status: map['status'] ?? '',
    /* NaN when the row is absent or non-numeric; the caller fails on it rather
       than defaulting to a TTL nobody chose. */
    ttl: Number.parseInt(map['dns-ttl'] ?? '', 10),
    zoneMustBeOn: map['zone-must-be-on'] ?? '',
    servingNow: map['serving-now'] ?? '',
  }
}

/**
 * The §4.1 record table: what Cloudflare must hold once the zone moves.
 *
 * @returns {{ name: string, type: string, value: string }[]}
 */
export function parseRequiredRecords(docs12Text) {
  const body = sectionBody(String(docs12Text ?? ''), '## §4.1')
  return tableWithHeader(body, 'Record')
    .filter((cells) => cells[0])
    .map((cells) => ({ name: cells[0], type: cells[1] ?? '', value: cells[2] ?? '' }))
}

/**
 * The §4.1 path table: every tracked file that names the domain.
 *
 * Kinds are NOT filtered to the two this module understands. Dropping an
 * unrecognised kind here would silently exempt a file the moment someone
 * invents a third kind, which is the failure this module exists to avoid — so
 * the row is returned and `driftFindings` reports it as `unknown-kind`.
 *
 * @returns {{ path: string, kind: string }[]}
 */
export function parseDomainPaths(docs12Text) {
  const body = sectionBody(String(docs12Text ?? ''), '## §4.1')
  return tableWithHeader(body, 'Path')
    .filter((cells) => cells[0])
    .map((cells) => ({ path: cells[0], kind: cells[1] ?? '' }))
}

/**
 * The §4.1 exclusion table: files that name the domain and are allowed to keep
 * naming the OLD one.
 *
 * This is a table rather than a paragraph because a completeness check cannot
 * read a paragraph. Every exclusion is a promise that the name in that file may
 * go stale, so each row carries the reason it was made — an exclusion nobody can
 * justify is the same as a file nobody owns.
 *
 * @returns {{ path: string, why: string }[]}
 */
export function parseDomainExclusions(docs12Text) {
  const body = sectionBody(String(docs12Text ?? ''), '## §4.1')
  return tableWithHeader(body, 'Excluded path')
    .filter((cells) => cells[0])
    .map((cells) => ({ path: cells[0], why: cells[1] ?? '' }))
}

/* ---- reading the files that must agree with it ---- */

/**
 * The domain a `CNAME` file declares, or `null` when it declares none.
 *
 * Comment lines are skipped and a trailing root dot is stripped, because both
 * are legal in the file and neither is part of the name.
 */
export function cnameDomain(text) {
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    return normaliseHost(trimmed)
  }
  return null
}

/**
 * Every `routes` entry in a wrangler config — commented ones included.
 *
 * The commented case is the interesting one: `app/wrangler.toml` carries its
 * `routes` line commented out precisely because the zone is not attachable yet,
 * and a check that only read live TOML would report "no routes, nothing to
 * disagree" on the one file whose whole point is the pending disagreement.
 * `commented` is returned so the caller can tell "wired" from "prepared".
 *
 * The key is matched only at the start of a line, and only when the value opens
 * an array, because this reads a file full of prose about routes. An unanchored
 * match counts a comment like `# uncomment the routes line` as a routes entry,
 * and uncommented that would report a live route where there is none — raising a
 * "zone not found" blocker against a deploy that was never configured.
 *
 * @returns {{ pattern: string|null, zoneName: string|null, commented: boolean }[]}
 */
export function wranglerRoutes(text) {
  const out = []
  for (const raw of String(text ?? '').split('\n')) {
    const commented = /^\s*#/.test(raw)
    const line = raw.replace(/^\s*#+/, '').trim()
    if (!/^routes\s*=\s*[\[{]/.test(line)) continue
    const zone = /zone_name\s*=\s*"([^"]*)"/.exec(line)
    const pattern = /pattern\s*=\s*"([^"]*)"/.exec(line)
    out.push({
      pattern: pattern ? pattern[1] : null,
      zoneName: zone ? zone[1] : null,
      commented,
    })
  }
  return out
}

/**
 * The domains a config file declares, or `null` when its shape is not one this
 * module knows how to read.
 *
 * `null` is deliberate and is not the same as `[]`: an empty array says "this
 * file declares no domain", which is a pass, while `null` says "I could not
 * read this file's meaning", which must be reported. Dispatch is on the
 * basename so a `wrangler.staging.toml` is handled like `wrangler.toml`.
 *
 * @returns {string[]|null}
 */
export function domainsDeclaredBy(path, text) {
  const base = String(path ?? '').split('/').pop() ?? ''
  if (base === 'CNAME') {
    const domain = cnameDomain(text)
    return domain ? [domain] : []
  }
  if (/^wrangler(?:\.[\w-]+)?\.toml$/.test(base)) {
    const routes = wranglerRoutes(text)
    /* A routes line that yielded neither a zone nor a pattern is one this
       parser could not read — a multi-line TOML array, say. `[]` here would
       say "declares no domain" and pass, so say `null` instead and let the
       caller report that the file was not understood. */
    if (routes.some((route) => !route.zoneName && !route.pattern)) return null
    const out = []
    for (const route of routes) {
      if (route.zoneName) out.push(normaliseHost(route.zoneName))
      /* A pattern's host may legitimately be a subdomain of the zone, so keep
         the whole host and let `driftFindings` compare it as one. */
      if (route.pattern) out.push(normaliseHost(route.pattern.replace(/\/.*$/, '')))
    }
    return out
  }
  return null
}

/**
 * Every listed file that disagrees with the canonical domain.
 *
 * Two rules, because the two kinds of file mean different things: a `config`
 * file is read by a machine, so its declared domain must BE the canonical one
 * (or a subdomain of it, for a wrangler pattern); a `doc` file only has to
 * still mention it, since prose describes rather than configures and rewriting
 * a sentence is not this check's business.
 *
 * @param {string} canonical
 * @param {{ path: string, kind: string, text: string|null }[]} files
 *        `text` is `null` when the file could not be read.
 * @returns {{ path: string, kind: string, problem: string, found: string[] }[]}
 */
export function driftFindings(canonical, files) {
  const out = []
  const want = normaliseHost(canonical)

  for (const file of files ?? []) {
    const at = { path: file.path, kind: file.kind }
    if (file.text == null) {
      out.push({ ...at, problem: 'unreadable', found: [] })
      continue
    }
    if (file.kind === 'doc') {
      if (want && !String(file.text).includes(want)) {
        out.push({ ...at, problem: 'missing', found: [] })
      }
      continue
    }
    if (file.kind !== 'config') {
      out.push({ ...at, problem: 'unknown-kind', found: [] })
      continue
    }
    const declared = domainsDeclaredBy(file.path, file.text)
    if (declared === null) {
      out.push({ ...at, problem: 'unknown-config', found: [] })
      continue
    }
    for (const found of declared) {
      if (!isSameOrSubdomain(found, want)) {
        out.push({ ...at, problem: 'mismatch', found: [found] })
      }
    }
  }
  return out
}

/* ---- is the ledger complete? ---- */

/** A repo-relative path, comparable to another one: no `./`, no trailing space. */
export function normalisePath(path) {
  return String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
}

/**
 * Files that name the domain and appear in NEITHER §4.1 table.
 *
 * The drift check above can only ever disagree with the paths the ledger lists,
 * so a ledger missing a row is indistinguishable from a repo with nothing to
 * check — the same shape as "zero parsed", one level up. This is the check that
 * the list itself is complete, and it is why the scan is over the whole repo
 * rather than over the table.
 *
 * An empty `domain` returns nothing rather than everything: a blank contract is
 * already a blocker in `attachVerdict`, and matching every file in the repo
 * against `''` would bury that one finding under a thousand.
 *
 * @param {string} domain
 * @param {{ path: string, count: number }[]} mentions what the scan found
 * @param {{ path: string }[]} listed §4.1's Path table
 * @param {{ path: string }[]} excluded §4.1's Excluded table
 * @returns {{ path: string, count: number }[]}
 */
export function unlistedMentions(domain, mentions, listed, excluded) {
  const want = normaliseHost(domain)
  if (!want) return []
  const known = new Set(
    [...(listed ?? []), ...(excluded ?? [])].map((row) => normalisePath(row.path)).filter(Boolean),
  )
  const out = []
  for (const mention of mentions ?? []) {
    const path = normalisePath(mention.path)
    if (!path || known.has(path)) continue
    out.push({ path, count: mention.count })
  }
  return out
}

/* ---- reading the world ---- */

/**
 * Where a zone's nameservers actually point.
 *
 * `mixed` is its own answer rather than being folded into `elsewhere`: it is the
 * state a zone sits in mid-migration, when some registrars have the new NS and
 * some the old, and deploying into it means the deploy succeeds or fails
 * depending on which resolver Cloudflare asked. That deserves to be named.
 *
 * @param {string[]} nsHosts
 * @param {string} provider substring identifying the required provider
 * @returns {'on-provider'|'elsewhere'|'mixed'|'none'}
 */
export function classifyNameservers(nsHosts, provider) {
  const hosts = (nsHosts ?? []).map(normaliseHost).filter(Boolean)
  if (hosts.length === 0) return 'none'
  const want = String(provider ?? '').trim().toLowerCase()
  if (!want) return 'elsewhere'
  const onProvider = hosts.filter((h) => h.includes(want))
  if (onProvider.length === hosts.length) return 'on-provider'
  if (onProvider.length === 0) return 'elsewhere'
  return 'mixed'
}

/**
 * The ledger's records compared against what DNS returned.
 *
 * `ttl-too-high` is a finding and not a nitpick: docs/16-EXIT-PLAYBOOK's
 * promise of a fast cutover is a promise about this number, and a record left
 * at a registrar's 1-hour default quietly withdraws it. `ttl-unverified` is the
 * opposite case — Node's resolver does not expose TTL at all, so when `dig` is
 * absent the honest answer is "not measured", never "fine".
 *
 * @param {{ name: string, type: string, value: string }[]} records
 * @param {{ name: string, addresses: string[], ttl: number|null }[]} resolved
 * @param {number} ttl required TTL in seconds
 * @returns {{ name: string, problem: string, ttl: number|null }[]}
 */
export function recordFindings(records, resolved, ttl) {
  const seen = new Map()
  for (const entry of resolved ?? []) {
    seen.set(normaliseHost(entry.name), entry)
  }
  const out = []
  for (const record of records ?? []) {
    const name = normaliseHost(record.name)
    const live = seen.get(name)
    if (!live || (live.addresses ?? []).length === 0) {
      out.push({ name, problem: 'absent', ttl: null })
      continue
    }
    if (live.ttl == null) {
      out.push({ name, problem: 'ttl-unverified', ttl: null })
      continue
    }
    if (Number.isFinite(ttl) && live.ttl > ttl) {
      out.push({ name, problem: 'ttl-too-high', ttl: live.ttl })
    }
  }
  return out
}

/**
 * Whether the custom domain can be attached to the worker, and what is owed.
 *
 * Pure: every measurement is an argument, so the reasoning can be tested
 * without a resolver. `next` is derived from the blockers rather than being a
 * fixed list, and each step names WHO owes it — `app/wrangler.toml` is L1's
 * surface per docs/13, so "uncomment the routes line" is not this lane's to do
 * and the output must not imply that running one command here finishes it.
 *
 * `requiredRecords` and `listedPaths` are the ledger's own tables, passed in so
 * that an EMPTY one is a blocker: a table that lost its header would otherwise
 * report "no records required" and "no files to compare", which is the same
 * output a clean contract gives and the opposite meaning.
 *
 * `unlisted` and `scanned` are the completeness half — files a whole-repo scan
 * found naming the domain that appear in NEITHER §4.1 table, and how many files
 * that scan actually read. `scanned: 0` blocks for the same reason an empty
 * table does: a scan that read nothing reports exactly what a complete ledger
 * reports, and means the opposite.
 *
 * @returns {{ attachable: 'yes'|'no'|'unmeasured', blockers: string[],
 *             notes: string[], next: string[] }}
 */
export function attachVerdict(input) {
  const { ledger, drift, ns, records, routes, offline, requiredRecords, listedPaths, unlisted, scanned } =
    input ?? {}
  const blockers = []
  const notes = []
  const next = []

  if (!ledger || ledger.found !== true) {
    blockers.push('docs/12 §4.1 is missing — the domain contract cannot be read, so nothing below is knowable')
    return { attachable: 'no', blockers, notes, next }
  }
  if (!ledger.domain) {
    blockers.push('docs/12 §4.1 records no domain — the contract is present but blank')
  }
  if (!Number.isFinite(ledger.ttl)) {
    blockers.push(`docs/12 §4.1 records no usable dns-ttl (got ${JSON.stringify(ledger.ttl ?? null)}) — "TTL 300" would be unenforced prose`)
  }
  /* Zero parsed is not a pass. A table that lost its header reports exactly what
     a satisfied check reports, so each one is named as blindness rather than
     allowed to look like "nothing to check". */
  if ((requiredRecords ?? []).length === 0) {
    blockers.push('docs/12 §4.1 lists no required DNS records — the table changed shape, so the record and TTL check is blind')
  }
  if ((listedPaths ?? []).length === 0) {
    blockers.push('docs/12 §4.1 lists no paths that must name the domain — the table changed shape, so the drift check is blind')
  }
  if (!(Number.isFinite(scanned) && scanned > 0)) {
    blockers.push(
      `the repo scan read ${scanned ?? 'an unknown number of'} file(s) — the completeness check is blind, so "nothing unlisted" would be a guess`,
    )
  }
  for (const mention of unlisted ?? []) {
    blockers.push(
      `${mention.path} names ${ledger.domain} (${mention.count}×) but is in neither §4.1 table — list it under Path, or under Excluded with a reason, or a swap leaves this file behind`,
    )
  }

  for (const finding of drift ?? []) {
    const detail = finding.found.length > 0 ? ` declares ${finding.found.join(', ')}` : ''
    blockers.push(`${finding.path} (${finding.kind}) ${finding.problem}${detail} — docs/12 §4.1 says ${ledger.domain}`)
  }

  const wired = (routes ?? []).some((r) => !r.commented)
  /* Not asserted offline: without a measurement, "the zone is not on
     Cloudflare" is a guess, and a live routes line is exactly the case where
     guessing wrong is expensive. */
  if (wired && !offline && ns !== 'on-provider') {
    blockers.push('app/wrangler.toml has an UNCOMMENTED routes line but the zone is not on Cloudflare — `wrangler deploy` would fail with "zone not found"')
  }
  if (wired && offline) {
    notes.push('app/wrangler.toml has an UNCOMMENTED routes line — re-run without --offline to confirm the zone is actually on Cloudflare before deploying')
  }

  if (offline) {
    notes.push('offline: no DNS was queried, so the nameservers and records are unmeasured')
    next.push('re-run without --offline to measure the zone (read-only DNS, $0)')
  } else if (ns === 'none') {
    blockers.push(`no nameservers answer for ${ledger.domain} — the domain does not resolve, so it cannot be a zone`)
  } else if (ns === 'mixed') {
    blockers.push(`${ledger.domain} is mid-migration: some nameservers are on ${ledger.zoneMustBeOn} and some are not — deploying now depends on which resolver answered`)
  } else if (ns !== 'on-provider') {
    blockers.push(`${ledger.domain}'s nameservers are not on ${ledger.zoneMustBeOn}, so the zone is not attachable — the routes line must stay commented`)
    next.push(`Ayu: at the registrar, set ${ledger.domain}'s nameservers to the two Cloudflare assigns (Cloudflare dashboard → add zone). Nothing in this repo can do it.`)
  }

  for (const finding of records ?? []) {
    if (finding.problem === 'ttl-unverified') {
      notes.push(`${finding.name}: TTL unverified — Node's resolver does not expose it and \`dig\` was not available`)
      continue
    }
    if (finding.problem === 'ttl-too-high') {
      blockers.push(`${finding.name} has TTL ${finding.ttl}, above the ${ledger.ttl} docs/16-EXIT-PLAYBOOK's fast cutover assumes`)
      continue
    }
    blockers.push(`${finding.name} (${finding.problem}) — docs/12 §4.1 requires it`)
  }

  if (!wired) {
    next.push(`L1: uncomment the routes line in app/wrangler.toml once the zone is on ${ledger.zoneMustBeOn}. That file is L1's surface (docs/13), not L9's — this lane can only report that it is still commented.`)
  }
  if (ns === 'on-provider' && !wired) {
    next.push('then: `wrangler deploy` and confirm the domain serves the app, keeping the workers.dev URL alive as docs/17-PRODUCTION-PATH asks')
  }

  const attachable = blockers.length > 0 ? 'no' : offline ? 'unmeasured' : 'yes'
  return { attachable, blockers, notes, next }
}
