#!/usr/bin/env node
/* collab-check.mjs — mechanical guard for docs/11-COLLAB.md.
 *
 * Several agents on different models AND different platforms work this repo at
 * once, and the protocol is written in prose, so nobody actually follows it.
 * This turns the parts that can be checked into a command:
 *
 *   1. hot files      — you are about to commit a file another agent is
 *                       writing RIGHT NOW (the lost-work / red-build cause).
 *   2. scope          — untracked `??` work left behind, and over-broad staging.
 *   3. generated      — routeTree.gen.ts is stale: a route file on disk is not
 *                       registered, or the tree names a route that is gone.
 *   4. commit message — shape rule (never empty or a single character).
 *   5. green rule     — typecheck + full test suite, unless --fast.
 *   6. vendors        — docs/12 §2: no dependency or import may name a vendor
 *                       whose ledger row is not WIRED.
 *   7. staging        — docs/12 §4: no committed file may point at a Supabase
 *                       project that is not the recorded staging one.
 *   8. i18n namespace — a staged catalogue edit must stay inside the key
 *                       namespace the committer declared (LANE_KEYS).
 *
 * Correctness of money/copy/schema stays in the vitest suite; this only adds
 * the collaboration and staleness checks the suite cannot see.
 *
 * Usage:
 *   node scripts/collab-check.mjs                 # all checks
 *   node scripts/collab-check.mjs --fast          # skip typecheck + tests
 *   node scripts/collab-check.mjs --message "..." # check a commit message
 *   node scripts/collab-check.mjs --staged-only   # only the staged/hot checks
 */

import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* The decisions live in modules with no imports, so tests can exercise them
   without pulling `node:child_process` into the jsdom pool — the mistake that
   broke test collection for six lanes when `translator-lib.mjs` did it
   (docs/11). */
import {
  clashesFor,
  deadSurfaces,
  declaredBy,
  localeLeaves,
  localeNamespaceVerdict,
  localeTouched,
  ownedByLane,
  parseActiveLanes,
  parseCatalogue,
  parseSurfaces,
} from './lane-board.mjs'
import { parseProjectRefs, supabaseUrlFindings } from './staging-lib.mjs'
import { findBanned, importSpecifiers, parseVendorLedger } from './vendor-whitelist.mjs'
import { backupFindings, parseBackupContract } from './backup-contract.mjs'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(APP, '..')
const HOT_MINUTES = 15

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

const SKIP_GREEN = has('--fast') || has('--staged-only')

let warnings = 0
let failures = 0

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const warn = (m) => {
  warnings++
  console.log(`  \x1b[33m!\x1b[0m ${m}`)
}
const bad = (m) => {
  failures++
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`)

function git(args, cwd = REPO) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return ''
  }
}

const staged = () =>
  git(['diff', '--cached', '--name-only'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

const untracked = () =>
  git(['status', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .filter(Boolean)

/* ---- 1. hot files: written by another agent in the last HOT_MINUTES ---- */
function hotFiles() {
  const roots = ['src', 'tests', 'locales', 'supabase']
  const cutoff = Date.now() - HOT_MINUTES * 60_000
  const found = new Set()
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        walk(full)
      } else if (statSync(full).mtimeMs > cutoff) {
        found.add(relative(REPO, full))
      }
    }
  }
  for (const r of roots) walk(join(APP, r))
  return found
}

/* ---- 3. routeTree.gen.ts staleness ---- */
function routeFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...routeFiles(full))
    else if (e.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

function checkGenerated() {
  const genPath = join(APP, 'src', 'routeTree.gen.ts')
  let gen
  try {
    gen = readFileSync(genPath, 'utf8')
  } catch {
    warn('routeTree.gen.ts missing — run `npm run build`')
    return
  }
  const declared = new Set()
  for (const file of routeFiles(join(APP, 'src', 'routes'))) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/createFileRoute\(\s*'([^']+)'/g)) {
      const p = m[1].replace(/\/_index$/, '').replace(/\/$/, '') || '/'
      declared.add(p)
    }
  }
  const missing = [...declared].filter((p) => !gen.includes(`'${p}'`))
  if (missing.length > 0) {
    bad(`routeTree.gen.ts is stale — not registered: ${missing.join(', ')}`)
    console.log('      run `npm run build` and commit the regenerated tree with the route')
  } else {
    ok(`routeTree.gen.ts covers all ${declared.size} declared routes`)
  }
}

/* ---- 6. vendor whitelist (docs/12 §2) ----
   "only vendors marked WIRED in docs/12 §2 may appear in code, package.json,
   or config". The vendor names AND their statuses are parsed out of the ledger
   rather than hardcoded here, so adding a row to docs/12 brings it under the
   guard with no edit to this file — and moving a row to WIRED is the only thing
   that permits its SDK. The decisions live in `vendor-whitelist.mjs`, which
   imports nothing, so a test can reach them (docs/11). */
function sourceFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(full)
    }
  }
  return out
}

function dependencyNames() {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const names = []
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    names.push(...Object.keys(pkg[field] ?? {}))
  }
  return names
}

function checkVendors() {
  let ledger
  try {
    ledger = readFileSync(join(REPO, 'docs', '12-INFRA-CREDITS.md'), 'utf8')
  } catch {
    bad('docs/12-INFRA-CREDITS.md is unreadable — the vendor whitelist cannot be checked')
    return
  }

  const vendors = parseVendorLedger(ledger)
  /* Zero vendors is NOT a pass. A parser that has stopped recognising the
     ledger table reports exactly the same thing as a clean repo, and the two
     mean opposite things: "nothing to see" versus "this check is blind". */
  if (vendors.length === 0) {
    bad('parsed 0 vendors from docs/12 §2 — the ledger format changed, so this check is blind')
    return
  }

  const deps = dependencyNames()
  if (deps === null) {
    bad('app/package.json is unreadable or not JSON — the vendor whitelist cannot be checked')
    return
  }

  const specifiers = []
  for (const file of sourceFiles(join(APP, 'src'))) {
    specifiers.push(...importSpecifiers(readFileSync(file, 'utf8')))
  }

  const banned = findBanned([...deps, ...specifiers], vendors)
  if (banned.length > 0) {
    for (const b of banned) {
      bad(`${b.pkg} names ${b.vendor}, whose docs/12 §2 status is ${b.status}`)
    }
    console.log('      only WIRED vendors may appear in code, package.json or config (docs/12 §2)')
    console.log('      a RESERVE/BENCH vendor needs its ledger row moved to WIRED first — by Ayu')
  } else {
    const wired = vendors.filter((v) => v.status === 'WIRED').length
    ok(
      `${vendors.length} vendors in docs/12 §2 (${wired} WIRED) — ` +
        `${deps.length} deps + ${specifiers.length} imports, none off-whitelist`,
    )
  }
}

/* ---- 7. staging by default (docs/12 §4) ----
   "Agents develop against staging" was prose until now, and prose holds until
   the first agent who has not read it. What this catches is the expensive
   version of that: a PROD project URL committed to wrangler.toml `[vars]`, to
   `.env.example`, or hardcoded in a lib — after which a laptop, a CI job or a
   deploy writes to the database real passengers are in, and nothing in the
   output says which project it just touched.

   Refs are parsed from docs/12 §4 rather than hardcoded here, for the reason
   `checkVendors` gives: a second copy of a mapping is a second thing to rot. The
   decisions live in `staging-lib.mjs`, which imports nothing.

   A Supabase URL host is the project REF, never the project name, so an
   unrecorded ref is unclassifiable rather than "probably staging" — refusing it
   is what makes recording the ref in docs/12 §4 load-bearing. */
function checkSupabaseEnv() {
  let ledger
  try {
    ledger = readFileSync(join(REPO, 'docs', '12-INFRA-CREDITS.md'), 'utf8')
  } catch {
    bad('docs/12-INFRA-CREDITS.md is unreadable — the staging default cannot be checked')
    return
  }

  const refs = parseProjectRefs(ledger)
  /* Zero rows is NOT a pass, for the same reason zero vendors is not: a parser
     that has stopped recognising the §4 table reports exactly what a clean repo
     reports, and the two mean opposite things. */
  if (refs.staging.project === '' && refs.prod.project === '') {
    bad('parsed no environment rows from docs/12 §4 — the table changed shape, so this check is blind')
    return
  }

  /* Committed files that could carry a project URL. `.env.local` is deliberately
     absent: it is gitignored, and reading it here would put a key in a log. */
  const files = [join(APP, 'wrangler.toml'), join(APP, '.env.example'), ...sourceFiles(join(APP, 'src'))]
  let urls = 0
  const offenders = []
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const finding of supabaseUrlFindings(text, refs)) {
      urls++
      if (!finding.allowed) offenders.push({ path: relative(REPO, file), ...finding })
    }
  }

  if (offenders.length > 0) {
    for (const o of offenders) {
      bad(`${o.path} points at ${o.host}, which is ${o.kind} — agents develop against staging (docs/12 §4)`)
    }
    console.log('      prod needs an explicit opt-in, not a default; "unknown" means docs/12 §4 records no such ref')
  } else {
    const recorded = [refs.staging, refs.prod].filter((r) => r.ref !== null).length
    ok(
      `${files.length} committed file(s) scanned, ${urls} Supabase URL(s), none prod and none unrecorded ` +
        `(${recorded}/2 project refs recorded in docs/12 §4)`,
    )
  }
}

/* ---- 8. the nightly backup contract (docs/12 §5, docs/16) ----
   Build-plan item 3. The workflow needs six secrets that do not exist yet, so
   it cannot be RUN — and the file handed over for it was wrong in six ways no
   reader would catch: it sat in a directory GitHub does not read, its
   `pg_dump | gzip` was unguarded by `pipefail`, its ZeptoMail alert sent a bare
   token where the API requires the `Zoho-enczapikey` prefix, its only dump
   check was a size floor on the compressed file, and it omitted the
   `--clean --if-exists` docs/16's own restore drill needs.

   The decisions live in `backup-contract.mjs`, which imports nothing, so the
   suite covers them. What this function adds is the part the suite cannot see
   from a string: the file's LOCATION. The handoff sat at
   `workflows/seatswap-backup.yml` in the repo root — GitHub reads
   `.github/workflows/` only — so the nightly backup had never existed, and
   nothing anywhere said so. */
function checkBackup() {
  const read = (rel) => {
    try {
      return readFileSync(join(REPO, rel), 'utf8')
    } catch {
      return null
    }
  }
  const ledger = read('docs/12-INFRA-CREDITS.md')
  const exit = read('docs/16-EXIT-PLAYBOOK.md')
  if (ledger === null || exit === null) {
    bad('docs/12 or docs/16 is unreadable — the backup contract cannot be checked')
    return
  }

  const doc = parseBackupContract(ledger, exit)
  if (!doc.filePath) {
    bad('docs/12 §5 no longer names the workflow file path, so this check is blind')
    return
  }
  const workflow = read(doc.filePath)
  if (workflow === null) {
    bad(`${doc.filePath} does not exist — docs/10 item 3's nightly backup has never run`)
    return
  }
  if (existsSync(join(REPO, 'workflows', 'seatswap-backup.yml'))) {
    bad(
      'a second copy sits at workflows/seatswap-backup.yml — GitHub reads .github/workflows/ only, ' +
        'so that copy is dead weight that reads as live',
    )
  }

  const findings = backupFindings({ workflowText: workflow, ledgerText: ledger, exitText: exit })
  if (!findings.ok) {
    for (const p of findings.problems) bad(p)
  } else {
    const f = findings.facts
    ok(
      `docs/12 §5 contract holds — ${f.workflowName}, cron ${f.expectedCron}, ` +
        `${f.secretRefs.length} secrets, ${f.unparsedLines} unread line(s)`,
    )
  }
  /* What no file here can do. Printed rather than assumed, because "the check
     passed" and "the check only covers the half a machine can see" differ. */
  for (const step of findings.humanSteps) console.log(`      \x1b[33m·\x1b[0m ${step}`)
}

/* ---- 9. the ownership map protects something (docs/13 §1) ----
   A surface that matches no file is not a guard. `clashesFor` can only refuse a
   file some surface MATCHES, so a surface matching nothing is indistinguishable
   from a lane with nothing to do — and the real files it was written for stay
   unowned while the entry reads as healthy.

   Two of the 39 surfaces did exactly that until 2026-10-01: L1's
   `app/src/components/pwa*.tsx` (the PWA components are `install-prompt.tsx`
   and `service-worker.tsx`, neither of which starts with `pwa`) and L2's
   `routes/index` (no extension and no wildcard, so it was compared literally
   against `app/src/routes/index.tsx`). In both cases the fix was one character
   and the cost was three days of an unowned file nobody knew about. The
   decisions live in `lane-board.mjs`, which imports nothing, so the suite can
   cover them; this function is only the part that reads the disk. */
function checkOwnership() {
  let contract
  try {
    contract = readFileSync(join(REPO, 'docs', '13-COLLAB-CONTRACT.md'), 'utf8')
  } catch {
    bad('docs/13-COLLAB-CONTRACT.md is unreadable — the ownership map cannot be checked')
    return
  }

  /* EVERY lane, not just the active ones: an inactive lane's dead surface is a
     hole waiting for the day that lane is claimed. The ids are read from the
     contract rather than hardcoded, so a new lane is covered with no edit here
     — and a contract whose table was rewritten into some other shape reports
     that rather than passing vacuously. */
  const ids = [...new Set([...contract.matchAll(/^\|\s*L(\d+)\b/gm)].map((m) => `L${m[1]}`))]
  if (ids.length === 0) {
    bad('docs/13 §1 has no lane rows — the ownership map is empty or its table changed shape')
    return
  }

  /* The TRACKED tree is the universe: only a tracked path can appear in a
     commit, so a surface matching an untracked or gitignored file is still dead
     as far as this guard is concerned. `app/.tanstack/` is the case that makes
     this concrete — it exists on disk, is gitignored, and was listed as an
     unowned path by the item that raised this. */
  const files = git(['ls-files']).split('\n').filter(Boolean)
  if (files.length === 0) {
    warn('git ls-files returned nothing — the ownership check cannot run in this tree')
    return
  }

  const lanes = parseSurfaces(contract, ids)
  const dead = deadSurfaces(lanes, files)
  if (dead.length === 0) {
    const total = lanes.reduce((n, l) => n + l.surfaces.length, 0)
    ok(`docs/13 §1: ${total} surface(s) across ${lanes.length} lanes, every one matches a file`)
    return
  }
  for (const d of dead) {
    bad(`${d.id}'s surface \`${d.surface}\` matches no tracked file, so it protects nothing`)
  }
  console.log('      fix the glob, or drop the entry. A surface written for a naming')
  console.log('      convention the files do not follow is a hole in the guard, not a plan.')
}

/* ---- 10. disjoint i18n commits (docs/14 Requests, L3 -> L7 + L9) ----
   L10 is the single writer for `app/locales/**`, so while L10 holds that claim
   `clashesFor` refuses EVERY commit touching a catalogue — including one whose
   keys have nothing to do with L10's. That has cost four L10 brief claims from
   three lanes, and the two escapes (wait, or `--no-verify`) are what produced
   `3c6fddd`, where one lane's commit silently carried another's locale lines.

   This is not a loosening. A lane declares the namespace it is writing
   (`LANE_KEYS=share`) and the guard diffs the STAGED catalogue against HEAD, so
   the swept-in keys are named instead of carried. The decision lives in
   `lane-board.mjs` (imports nothing, so the suite can reach it); this function is
   only the part that reads git. */

/** The catalogues in a staged set. Repo-relative, because that is what git lists. */
const isCatalogue = (file) => /^app\/locales\/[^/]+\.json$/.test(file)

/**
 * The refusal text for a locale commit, or `null` when there is nothing to say.
 *
 * A STRING rather than printed lines, because two callers need it and they need
 * it differently: hook mode has to exit 1, the full report has to colour a line
 * and count a failure. A check that only printed would be enforced in one and
 * merely narrated in the other.
 *
 * @returns {string|null}
 */
function hookLocaleProblem(files) {
  const catalogues = files.filter(isCatalogue)
  if (catalogues.length === 0) return null

  const declared = process.env.LANE_KEYS
  /* Opt-in and fails safe: with no LANE_KEYS the caller keeps yesterday's
     behaviour exactly, and the file-level active-lane check still refuses a
     contended catalogue. Same shape as the LANE/LANE_AGENT declaration. */
  if (!declared || declared.trim() === '') return null

  const lines = []
  for (const file of catalogues) {
    /* THE INDEX, NOT THE WORKING TREE. Measured on 2026-10-02, because the two
       disagree under `git commit --only -- <path>`: git builds a TEMPORARY index
       from the working tree for the named paths, hands it to the hook, and
       commits exactly that. So `git show :<file>` is what will land in the commit
       under BOTH spellings — `--only` (temp index, worktree content) and plain
       (real index, staged content) — while reading the worktree would report keys
       a plain commit does not carry, and block a correct one.

       HEAD is the "before". A catalogue with no HEAD blob yet is a file being
       added, which `parseCatalogue` reads as the one legitimate empty. */
    const before = parseCatalogue(git(['show', `HEAD:${file}`]))
    const after = parseCatalogue(git(['show', `:${file}`]))

    if (!before.ok) {
      lines.push(`${file}: the committed version is unreadable (${before.error}) — cannot tell which keys this commit touches`)
      continue
    }
    if (!after.ok) {
      /* A parse failure must REFUSE. The natural shorthand — treat unreadable
         text as an empty catalogue — yields zero touched keys, which is a
         vacuous pass over the one input the guard cannot read. */
      lines.push(`${file}: not valid JSON (${after.error}) — refusing rather than reading it as empty`)
      continue
    }

    const verdict = localeNamespaceVerdict({
      touched: localeTouched(before.value, after.value),
      declared,
    })
    if (verdict.ok) {
      console.error(`collab-check: note — ${file}: ${verdict.reason}`)
      continue
    }
    lines.push(
      `${file}: ${verdict.outside.length} key(s) outside your declared namespace (${verdict.prefixes.join(', ')}):\n        ${verdict.outside.join('\n        ')}`,
    )
  }

  if (lines.length === 0) return null
  return (
    `a locale commit touches keys outside the namespace you declared:\n        ${lines.join('\n        ')}` +
    '\n      A catalogue is refused file-wide while L10 holds the single-writer claim, so this is' +
    '\n      the check that makes a DISJOINT commit committable without --no-verify. Declare what' +
    '\n      you are actually writing, and stage only your own keys:' +
    '\n        LANE_KEYS=share LANE=L3 git commit -m "…"' +
    "\n      If those keys really are yours, you have swept up another lane's uncommitted work:" +
    '\n      unstage them, or file a request on docs/14 for L10 to release (docs/11).'
  )
}

/** The full-check report: one section, reusing the hook's own decision. */
function checkLocaleNamespace(files) {
  const problem = hookLocaleProblem(files)
  if (problem === null) {
    if (files.some(isCatalogue) && (process.env.LANE_KEYS ?? '').trim() !== '') {
      ok(`every staged catalogue key is inside ${process.env.LANE_KEYS}`)
    }
    return
  }
  bad(problem)
}

/* ---- active lanes, read out of the board itself ----
   docs/13 §1 holds the lane -> surface map; docs/14 holds who is active right
   now. Parsing both means the guard can never drift from the board: a new lane
   or a new `active:` timestamp is enforced with no edit to this file.

   The parsing itself lives in `lane-board.mjs`, which imports nothing — so the
   decisions are unit-testable without dragging `node:child_process` into a
   jsdom test file (docs/11 records what that cost last time). This function is
   now only the part that touches the disk. */
function activeLanes() {
  const board = readFileSync(join(REPO, 'docs', '14-LANES.md'), 'utf8')
  const claims = parseActiveLanes(board)
  if (claims.length === 0) return []
  const contract = readFileSync(join(REPO, 'docs', '13-COLLAB-CONTRACT.md'), 'utf8')
  const surfaces = parseSurfaces(
    contract,
    claims.map((c) => c.id),
  )
  const byId = new Map(claims.map((c) => [c.id, c.holder]))
  return surfaces.map((lane) => ({ ...lane, holder: byId.get(lane.id) ?? '' }))
}

/* `globToRegExp` and `ownedByLane` now live in `lane-board.mjs` and are
   imported above. They were extracted rather than duplicated: two copies of a
   surface-matching rule is how the guard and its tests would come to disagree
   about what a lane owns, and the tests would then be evidence about the wrong
   code. */

/* ---- pre-commit mode (.githooks/pre-commit) ----
   Runs on every commit. Keeps the fast structural checks only; the green rule
   (typecheck + test + build) stays in CI so a commit is never blocked for
   minutes on a slow machine. */
function hookMode() {
  const problems = []
  const files = staged()

  if (files.length === 0) problems.push('nothing is staged — a hook that passes on an empty index is a hook nobody trusts')

  const lanes = activeLanes()
  /* WHO IS COMMITTING. The guard knows which lanes are active but cannot know
     the committer's identity: every agent here commits under ONE shared git
     identity, so `git config user.name` would exempt everybody and turn the
     guard off. The identity is declared per-process instead — LANE=<id> or
     LANE_AGENT=<holder> — and a declared lane's files are its own business.
     Unset means unchanged behaviour, so this is opt-in and fails safe. */
  const declaration = { lane: process.env.LANE, agent: process.env.LANE_AGENT }
  const clashes = clashesFor(files, lanes, declaration)
  if (clashes.length > 0) {
    problems.push(
      `these files belong to a lane that is active right now:\n        ${clashes.join('\n        ')}` +
        '\n      If this is your own lane and you hold the claim, say so — that is what' +
        '\n      the declaration is for, and it is safer than --no-verify:' +
        '\n        LANE_AGENT=<your name> git commit -m "…"      # matches the claim holder' +
        '\n        LANE=<Lx> git commit -m "…"                   # claims lane Lx outright' +
        '\n      Otherwise stage only your own files, or wait for that lane to release (docs/14).',
    )
  }

  /* The hot-file check exists to catch someone ELSE editing a file you staged.
     It cannot tell that apart from your own work in progress, and a fresh
     change is hot by definition — so blocking on it makes the guard useless
     within 15 minutes of starting. It is reported as a warning, and the gate
     that actually protects other agents' work is the active-lane check above.
     Escape hatch: HOT_CHECK=block to restore the strict behaviour. */
  const hot = [...hotFiles()]
  const hotClash = files.filter((f) => hot.includes(f))
  if (hotClash.length > 0) {
    const note = `written in the last ${HOT_MINUTES} min: ${hotClash.join(', ')}`
    if (process.env.HOT_CHECK === 'block') problems.push(note)
    else console.error('collab-check: note — ' + note)
  }

  /* THE SAME NAMESPACE CHECK, IN HOOK MODE — and this is the one that matters.
     `checkLocaleNamespace` above prints into the full-check report; the hook is
     the only place a commit is actually stopped, so a check that lived only in
     the report would document the rule without enforcing it. */
  const localeProblem = hookLocaleProblem(files)
  if (localeProblem) problems.push(localeProblem)

  if (problems.length === 0) {
    console.error('collab-check: ok — ' + files.length + ' file(s) staged, no active-lane or hot-file clash')
    process.exit(0)
  }
  console.error('\ncollab-check blocked this commit:\n')
  for (const p of problems) console.error('  \u2717 ' + p)
  console.error('\n  bypass with --no-verify only if you know it is safe.\n')
  process.exit(1)
}

/* ---- prepare-commit-msg mode ----
   The subject cannot be checked in pre-commit: git writes COMMIT_EDITMSG only
   after pre-commit has run, so a `git commit -m "0"` hands the hook the
   *previous* commit's message. prepare-commit-msg runs once the message exists
   and receives its path as $1, so that is where the subject belongs. */
function hookMsgMode(msgFile) {
  const problems = []
  let raw = ''
  try {
    raw = readFileSync(msgFile, 'utf8')
  } catch {
    raw = ''
  }
  /* Comment lines start with '#' and are not the subject. */
  const subject = raw.split('\n').find((line) => !line.trimStart().startsWith('#'))?.trim() ?? ''

  if (subject.length === 0) {
    problems.push('empty commit subject — history is how lanes attribute files')
  } else if (subject.length < 10) {
    problems.push(`commit subject "${subject}" is too short to attribute`)
  } else if (!/^(?:[a-z]+(?:\(.+\))?!?:|L\d+:)/.test(subject)) {
    /* Two house styles are in use and both are accepted: a conventional-commit
       scope (`feat(pay): ...`) and a lane prefix (`L5: ...`). Rejecting the
       lane form would block the other platforms' own workflow, which is the
       opposite of what this guard is for. What it still catches is the real
       failure mode — a one-character subject like `0`. */
    problems.push(
      `commit subject "${subject}" is neither conventional-commit scoped (feat(pay): ...) nor lane-prefixed (L5: ...)`,
    )
  }

  if (problems.length > 0) {
    console.error('\ncollab-check blocked this commit:\n')
    for (const p of problems) console.error('  \u2717 ' + p)
    console.error('\n  bypass with --no-verify only if you know it is safe.\n')
    process.exit(1)
  }
  process.exit(0)
}

function main() {
  if (has('--hook')) return hookMode()
  const msgFile = valueOf('--hook-msg')
  if (msgFile) return hookMsgMode(msgFile)
  console.log('\x1b[1mcollab-check\x1b[0m — docs/11-COLLAB.md, enforced\n')

  /* commit message shape (docs/11: never single-character or empty) */
  const message = valueOf('--message')
  if (message !== undefined) {
    head('commit message')
    const subject = message.split('\n')[0].trim()
    if (subject.length === 0) bad('empty subject — history is how agents attribute files')
    else if (subject.length < 10) bad(`"${subject}" is too short to attribute (min 10 chars)`)
    else if (!/^[a-z]+(\(.+\))?:/.test(subject)) {
      warn(`"${subject}" is not conventional-commit scoped, e.g. feat(pay): …`)
    } else ok(`subject ok: ${subject}`)
  }

  /* 1 + 2. staging and hot files */
  const files = staged()
  head(`staged (${files.length} file${files.length === 1 ? '' : 's'})`)
  if (files.length === 0) {
    warn('nothing staged')
  } else {
    ok(`${files.length} file(s) staged`)
    if (files.length > 25) {
      warn(`${files.length} files staged — check this is your work, not a \`git add -A\``)
    }
  }

  const hot = hotFiles()
  head(`hot files (written in the last ${HOT_MINUTES} min)`)
  if (hot.size === 0) {
    ok('no file written in the last ' + HOT_MINUTES + ' min')
  } else {
    const clashing = files.filter((f) => hot.has(f))
    if (clashing.length > 0) {
      bad(`staging a file another agent is editing right now: ${clashing.join(', ')}`)
      console.log('      wait, or coordinate — do not `git rm` or rewrite it (docs/11)')
    } else {
      ok(`${hot.size} recently written, none staged by you`)
    }
  }

  const loose = untracked()
  if (loose.length > 0) {
    head('untracked')
    for (const f of loose) {
      console.log(`  \x1b[33m?\x1b[0m ${f} — belongs to whoever created it; leave it alone`)
    }
  }

  /* 3. generated files */
  if (!has('--staged-only')) {
    head('generated files')
    checkGenerated()
  }

  /* 6. vendor whitelist (docs/12 §2) */
  if (!has('--staged-only')) {
    head('vendor whitelist (docs/12 §2)')
    checkVendors()
  }

  /* 7. staging by default (docs/12 §4) */
  if (!has('--staged-only')) {
    head('staging by default (docs/12 §4)')
    checkSupabaseEnv()
  }

  /* 8. the nightly backup contract (docs/12 §5, docs/16) */
  if (!has('--staged-only')) {
    head('nightly backup contract (docs/12 §5)')
    checkBackup()
  }

  /* 9. the ownership map protects something (docs/13 §1) */
  if (!has('--staged-only')) {
    head('ownership map (docs/13 §1)')
    checkOwnership()
  }

  /* 10. a locale commit stays inside the namespace it declared (docs/14) */
  if (files.some(isCatalogue)) {
    head('i18n namespace (docs/14)')
    checkLocaleNamespace(files)
  }

  /* 5. green rule */
  if (!SKIP_GREEN) {
    head('green rule (docs/11)')
    for (const [label, cmd] of [
      ['typecheck', 'npm run typecheck'],
      ['tests', 'npm run test'],
    ]) {
      try {
        execSync(cmd, { cwd: APP, stdio: 'ignore' })
        ok(label)
      } catch {
        bad(`${label} failed — a red tree blocks every agent, so do not commit`)
      }
    }
  }

  head('result')
  if (failures > 0) {
    console.log(`  \x1b[31m${failures} failure(s)\x1b[0m, ${warnings} warning(s) — do not commit\n`)
    process.exit(1)
  }
  console.log(`  \x1b[32mclear\x1b[0m${warnings > 0 ? `, ${warnings} warning(s)` : ''}\n`)
}

/* Run the CLI only when this file IS the command. Without the guard, importing
   the module from a test would execute `main()` — reading git state and calling
   `process.exit`, which kills the test run rather than testing anything. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
