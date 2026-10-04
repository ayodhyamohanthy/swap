#!/usr/bin/env node
/* SeatSwap staging provisioning — DRY RUN. Proves the path, spends nothing.
 *
 *     node app/scripts/staging-dry-run.mjs
 *
 * WHY THIS EXISTS. docs/10's L9 item 2 asks for three things: a Supabase project
 * named `seatswap-staging`, its schema mirrored "via migrations", and agents
 * pointing at staging by default. Only the first needs a credential this repo
 * does not have — there is no `SUPABASE_ACCESS_TOKEN` in the environment, no
 * `~/.supabase`, no `supabase` CLI on PATH and zero GitHub Actions secrets. So
 * the human step is one `curl`, and everything that could be wrong *around* it is
 * checked here instead of discovered by whoever runs it.
 *
 * WHAT IT CHECKS, and why each is worth a gate rather than a glance:
 *   - the migrations still mirror the released schema (`staging-lib.mjs`), so
 *     "apply the migrations" and "apply schema.sql" cannot quietly become two
 *     different databases;
 *   - the object parser is not blind — every CREATE kind it does not recognise,
 *     and every CREATE it failed to match, is a failure rather than a shrug;
 *   - the migrations are in a defined order;
 *   - whether a Supabase-CLI-driven apply would even find them.
 *
 * WHAT IT NEVER DOES. There is no `fetch` in this file, so it cannot create a
 * project, cannot reach an API and cannot spend. That is a checked property, not
 * a claim in a comment: `tests/staging-lib.test.ts` runs it under
 * `app/azure/no-net.mjs` — the same preload `burndown-dry-run.mjs` uses — which
 * replaces `globalThis.fetch` before this module loads and records any attempt.
 *
 * The success token is printed LAST, after every check above has passed. A
 * machine-readable "ok" that appears before the check that could fail it is not a
 * success signal; `burndown-dry-run.mjs` had exactly that bug and the test now
 * asserts the token's absence on a failing run.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createdObjects,
  KNOWN_OBJECT_KINDS,
  mirrorFindings,
  parseProjectRefs,
  resolveSupabaseTarget,
  stripSqlComments,
  unrecognisedCreateKinds,
} from './staging-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')
const REPO = join(APP, '..')
const SB = join(APP, 'supabase')
const MIGRATIONS = join(SB, 'migrations')
const CLI_DEFAULT = join(REPO, 'supabase', 'migrations')

const read = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const sqlFilesIn = (dir, filter = () => true) => {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.sql') && filter(name))
      .sort()
  } catch {
    return []
  }
}

const failures = []
const warnings = []
const fail = (message) => failures.push(message)
const warn = (message) => warnings.push(message)

console.log('\x1b[1mstaging dry run\x1b[0m — docs/10 L9 item 2, docs/12 §4\n')

/* ---- 1. read the three copies of the schema ---------------------------- */

const migrationNames = sqlFilesIn(MIGRATIONS)
const migrations = migrationNames
  .map((file) => ({ file, sql: read(join(MIGRATIONS, file)) }))
  .filter((m) => m.sql !== null)

const canonicalSql = read(join(SB, 'schema.sql'))
const canonical = canonicalSql === null ? null : { file: 'app/supabase/schema.sql', sql: canonicalSql }

const partNames = sqlFilesIn(SB, (name) => /^schema\.part.+\.sql$/.test(name))
const parts = partNames.map((file) => ({ file, sql: read(join(SB, file)) })).filter((p) => p.sql !== null)

/* The repo root's own `supabase/`. It is not where our schema lives, but it IS
   where the Supabase CLI looks, which is what makes its contents dangerous
   rather than merely stale. */
const strayDir = join(REPO, 'supabase')
const stray = sqlFilesIn(strayDir).map((file) => ({ file: `supabase/${file}`, sql: read(join(strayDir, file)) }))

console.log(`  migrations   ${migrations.length} file(s) in app/supabase/migrations`)
console.log(`  canonical    ${canonical ? 'app/supabase/schema.sql' : 'MISSING'}`)
console.log(`  parts        ${parts.length} file(s)`)
console.log(`  root stray   ${stray.length} file(s) in supabase/`)

if (migrations.length === 0) fail('no migrations found in app/supabase/migrations — nothing to mirror')
if (canonical === null) fail('app/supabase/schema.sql is unreadable — the mirror has nothing to compare against')

/* ---- 2. is the object parser blind? ------------------------------------
   A completeness check on the checker. Without it, "no duplicates found" and
   "I could not read half the file" produce the same output. */

const allSql = [...migrations, ...parts, ...(canonical ? [canonical] : []), ...stray].map((f) => f.sql).join('\n')
const unrecognised = unrecognisedCreateKinds(allSql)
if (unrecognised.length > 0) {
  fail(`CREATE kind(s) staging-lib does not handle: ${unrecognised.join(', ')} — add them to KNOWN_OBJECT_KINDS or the duplicate check silently skips those objects`)
}

/* Count CREATE statements of a known kind against objects actually identified,
   per source. Catches a matcher that knows the kind but misses the statement — a
   function without RETURNS, a policy whose ON sits on the next line — which the
   kind check above would wave through. Compared within one file, never across
   files: `identified` grows with every migration while the canonical schema is
   frozen, so a cross-file comparison would start failing the day someone adds
   migration #2. */
const kindPattern = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:unique\\s+)?(?:materialized\\s+)?(?:unlogged\\s+)?(?:constraint\\s+)?(${KNOWN_OBJECT_KINDS.join('|')})\\b`, 'gi')
const countStatements = (sql) => [...stripSqlComments(sql).matchAll(kindPattern)].length

const identified = migrations.reduce((n, m) => n + createdObjects(m.sql).length, 0)
for (const source of [...migrations, ...(canonical ? [canonical] : []), ...parts, ...stray]) {
  const statements = countStatements(source.sql)
  const objects = createdObjects(source.sql).length
  if (statements !== objects) {
    fail(`${source.file} holds ${statements} CREATE statements but ${objects} objects were identified — the parser is missing some, so its verdict on that file means nothing`)
  }
}

if (failures.length === 0) {
  console.log(`  parser       ${identified} object(s) identified, statement count matched in every file, 0 unrecognised kinds`)
}

/* ---- 3. the mirror itself ---------------------------------------------- */

const mirror = mirrorFindings({ migrations, canonical, parts, stray })
for (const finding of mirror.findings) {
  const line = `${finding.code}: ${finding.detail}`
  if (finding.blocking) fail(line)
  else warn(line)
}

/* ---- 4. would a Supabase CLI apply even find the migrations? ------------
   Reported separately from the mirror because the mirror can be perfect and
   this can still provision an empty database. **The trap needs the repo root
   to LOOK like a Supabase project.** The CLI resolves `supabase/` from the
   project root, so the hazard is a `<repo>/supabase/` that exists and shadows
   the real migrations — which is exactly what the stray file did before
   2026-10-04. With no `<repo>/supabase/` at all there is no project for the
   CLI to resolve here, so it stops instead of provisioning anything. Warning
   unconditionally would keep crying wolf after the cause was removed, and a
   warning nobody believes is worse than none. */
const cliFindsMigrations = existsSync(CLI_DEFAULT)
if (!cliFindsMigrations) {
  if (existsSync(strayDir)) {
    warn(
      'the Supabase CLI resolves supabase/migrations from the PROJECT ROOT, and ' +
        `<repo>/supabase/migrations does not exist while <repo>/supabase/ does — \`supabase db push\` ` +
        `from here finds ${stray.length} stray file(s) and no migrations, so it would provision an empty ` +
        'database. Use the psql apply in STEP 3 below, or move the migrations (L8 owns app/supabase/**).',
    )
  } else {
    console.log(
      '  cli path     no <repo>/supabase/ — `supabase db push` from the repo root has no project to\n' +
        '               resolve here and stops, rather than provisioning an empty database. STEP 3 is the apply.',
    )
  }
}

/* ---- 5. which project does this environment point at? ------------------- */
const refs = parseProjectRefs(read(join(REPO, 'docs', '12-INFRA-CREDITS.md')) ?? '')
const target = resolveSupabaseTarget({ url: process.env.VITE_SUPABASE_URL ?? '', refs })
if (!target.ok) fail(`this environment points at the wrong project — ${target.reason}`)
console.log(`  env target   ${target.target} — ${target.reason}`)
if (refs.staging.ref === null) {
  warn('docs/12 §4 records no staging project ref yet, so nothing can distinguish a staging URL from a prod one. STEP 2 below is what fixes it.')
}

/* ---- the plan ---------------------------------------------------------- */

console.log('\n\x1b[1mThe human step, and everything around it\x1b[0m\n')

console.log('STEP 1 (Ayu — cannot be done from this repo). Create the project.')
console.log('  It is the second of Supabase\'s two free projects (docs/12 §2), so it costs')
console.log('  nothing, but it needs an account credential that is not here.')
console.log('  Dashboard → New project → name `seatswap-staging`, Free plan, and the SAME')
console.log('  region as seatswap-prod (docs/15: a name identifies app + surface + env).')
console.log('  Or the Management API with a token holding `organization_projects_create`:')
console.log('')
console.log('    curl -sS -X POST https://api.supabase.com/v1/projects \\')
console.log('      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\')
console.log('      -H "Content-Type: application/json" \\')
console.log('      -d \'{"organization_slug":"<ORG_SLUG>","name":"seatswap-staging",\'  \\')
console.log('           \'"db_pass":"<GENERATED>","plan":"free","region":"<SAME_AS_PROD>"}\'')
console.log('')
console.log('  This script never issues that call — there is no fetch in this file, and the')
console.log('  test runs it under no-net.mjs to prove it.')

console.log('\nSTEP 2. Record the ref in the docs/12 §4 table, or nothing can tell the two')
console.log('  projects apart. A Supabase URL host is the project REF (a random slug), never')
console.log('  the project name, so `seatswap-staging` does not appear in any URL. Once it is')
console.log('  recorded, `parseProjectRefs` reads it and collab-check refuses a committed')
console.log('  prod URL; until then every supabase.co literal in tracked source is "unknown".')

console.log('\nSTEP 3. Mirror the schema via migrations, in this order:')
for (const migration of migrations) {
  console.log(`    psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f app/supabase/migrations/${migration.file}`)
}
console.log('  ON_ERROR_STOP is not decoration: without it psql reports the error and keeps')
console.log('  going, so a half-applied schema exits 0 and looks like success.')
if (!cliFindsMigrations) {
  console.log('  NOT `supabase db push` from the repo root — see the warning above.')
}

console.log('\nSTEP 4. Point the app at staging (the default, per docs/12 §4):')
console.log('    cp app/.env.example app/.env.local    # gitignored, never committed')
console.log('    VITE_SUPABASE_URL=https://<REF>.supabase.co')
console.log('    VITE_SUPABASE_ANON_KEY=<staging anon key>')
console.log('  Anon key only. The service-role key is a worker secret and is never VITE_-')
console.log('  prefixed (docs/12 §8) — that mistake has already shipped once.')

console.log('\nSTEP 5 (optional). Demo data: app/supabase/seed.sql. It needs two real')
console.log('  auth.users first and inserts nothing without them — see its own header.')

/* ---- verdict ----------------------------------------------------------- */

if (warnings.length > 0) {
  console.log('\n\x1b[33m=== WARNINGS ===\x1b[0m')
  for (const w of warnings) console.log(`  ! ${w}`)
}

if (failures.length > 0) {
  console.log('\n\x1b[31m=== DRY RUN FAILED ===\x1b[0m')
  for (const f of failures) console.log(`  \u2717 ${f}`)
  process.exit(1)
}

console.log(
  `\nSTAGING-DRYRUN-OK migrations=${migrations.length} objects=${identified} ` +
    `blocking=0 warnings=${warnings.length} network=0 spend=0.00`,
)
