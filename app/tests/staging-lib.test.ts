/* Staging provisioning: the mirror is checked, and the dry run cannot spend.
 *
 * WHY THESE EXIST. docs/10's L9 item 2 asks for a staging Supabase project whose
 * schema is mirrored "via migrations", with agents pointing at staging by
 * default. Creating the project needs a credential this repo does not have, so
 * the part that can be proven here is proven here: that applying the migrations
 * reproduces the released schema, that the parser reading them is not blind, and
 * that the command an agent runs to prepare all this makes no network call.
 *
 * The schema is three copies of the same 1086 lines (`schema.part*.sql` →
 * `schema.sql` → `migrations/20260925000000_init.sql`) with nothing asserting
 * they agree, plus a fourth older copy at the repo root's `supabase/` — which is
 * where the Supabase CLI looks by default. `app/tests/schema.test.ts` (L8's)
 * asserts what the schema MEANS; this asserts the copies still say the same
 * thing, which is what makes "apply the migrations" safe to hand to a human.
 *
 * The functions come from `scripts/staging-lib.mjs`, which imports NOTHING. The
 * CLI cannot be imported from a test — docs/11 records what `node:fs` under the
 * jsdom pool cost six lanes — so it is spawned instead.
 *
 * The last describe block is the load-bearing one: it runs the shipped code
 * against the REAL files and the REAL dry run. A guard proven only against
 * fixtures can be green while the thing it reads has changed shape.
 */
import { describe, expect, it } from 'vitest'

import {
  createdObjects,
  duplicateCreates,
  KNOWN_OBJECT_KINDS,
  mirrorFindings,
  objectStatements,
  orderMigrations,
  parseProjectRefs,
  PLACEHOLDER_HOSTS,
  resolveSupabaseTarget,
  stripSqlComments,
  supabaseUrlFindings,
  unrecognisedCreateKinds,
} from '../scripts/staging-lib.mjs'

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { spawnSync } = process.getBuiltinModule('node:child_process') as typeof import('node:child_process')
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } =
  process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { tmpdir } = process.getBuiltinModule('node:os') as typeof import('node:os')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')
const SB = join(APP, 'supabase')
const MIGRATIONS = join(SB, 'migrations')
const CLI = join(APP, 'scripts', 'staging-dry-run.mjs')
const NO_NET = join(APP, 'azure', 'no-net.mjs')

const ids = (sql: string) => createdObjects(sql).map((o) => o.id)

/* A §4-shaped table with both refs recorded, for the cases that need one. */
const RECORDED = [
  '| Env | Supabase project | Project ref |',
  '|---|---|---|',
  '| staging | seatswap-staging | stagingrefabcdefgh |',
  '| prod | seatswap-prod | prodrefabcdefghijk |',
].join('\n')
const REFS = parseProjectRefs(RECORDED)

describe('createdObjects', () => {
  it('identifies every kind the schema uses', () => {
    const sql = [
      'CREATE TYPE app_role AS ENUM (\'admin\');',
      'CREATE TABLE public.bookings (id uuid);',
      'CREATE INDEX bookings_user ON public.bookings (user_id);',
      'CREATE UNIQUE INDEX one_role ON public.user_roles (user_id);',
      'CREATE OR REPLACE FUNCTION public.has_role(uid uuid, want app_role) RETURNS boolean AS $$ select true $$ LANGUAGE sql;',
      'CREATE POLICY own_read ON public.bookings FOR SELECT TO authenticated USING (true);',
      'CREATE TRIGGER touch BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION x();',
      'CREATE OR REPLACE VIEW public.v AS SELECT 1;',
    ].join('\n')
    expect(ids(sql)).toEqual([
      'type:app_role',
      'table:bookings',
      'index:bookings_user',
      'index:one_role',
      'function:has_role(uid uuid, want app_role)',
      'policy:bookings.own_read',
      'trigger:bookings.touch',
      'view:v',
    ])
  })

  it('does not read a CREATE mentioned in a comment as DDL', () => {
    /* L7 shipped a guard that failed on its own explanatory comment. The schema
       has prose like "-- Payers create rows and read their own", which a
       comment-blind parser turns into an object kind nobody handles. */
    const sql = '-- Payers create rows; see CREATE TABLE public.ghost below.\nCREATE TABLE public.real (id int);'
    expect(ids(sql)).toEqual(['table:real'])
    expect(unrecognisedCreateKinds(sql)).toEqual([])
  })

  it('marks IF NOT EXISTS and OR REPLACE idempotent, and a plain CREATE not', () => {
    const sql = [
      'CREATE TABLE public.a (id int);',
      'CREATE TABLE IF NOT EXISTS public.b (id int);',
      'CREATE OR REPLACE FUNCTION public.f() RETURNS int AS $$ select 1 $$ LANGUAGE sql;',
    ].join('\n')
    expect(createdObjects(sql).map((o) => o.idempotent)).toEqual([false, true, true])
  })

  it('scopes a policy to its table, so a reused name is not a collision', () => {
    const sql = [
      'CREATE POLICY read_own ON public.bookings FOR SELECT TO authenticated USING (true);',
      'CREATE POLICY read_own ON public.passengers FOR SELECT TO authenticated USING (true);',
    ].join('\n')
    expect(ids(sql)).toEqual(['policy:bookings.read_own', 'policy:passengers.read_own'])
  })

  it('treats two overloads as two objects, not one duplicate', () => {
    const sql = [
      'CREATE FUNCTION public.f(a uuid) RETURNS int AS $$ select 1 $$ LANGUAGE sql;',
      'CREATE FUNCTION public.f(a uuid, b int) RETURNS int AS $$ select 2 $$ LANGUAGE sql;',
    ].join('\n')
    expect(duplicateCreates([{ file: 'm.sql', sql }])).toEqual([])
    expect(createdObjects(sql)).toHaveLength(2)
  })

  it('reads an argument list that contains its own parenthesis', () => {
    /* `gen_random_uuid()` closes a paren before the signature does. Reading to
       the first `)` truncates the identity, and two different signatures can
       then truncate to the same string. */
    const sql = 'CREATE FUNCTION public.f(a uuid DEFAULT gen_random_uuid(), b int) RETURNS int AS $$ select 1 $$ LANGUAGE sql;'
    expect(ids(sql)).toEqual(['function:f(a uuid default gen_random_uuid(), b int)'])
  })

  it('records drops as operations, in source order', () => {
    const sql = 'CREATE POLICY p ON public.t FOR ALL TO authenticated USING (true);\nDROP POLICY IF EXISTS p ON public.t;'
    expect(objectStatements(sql).map((s) => `${s.op} ${s.id}`)).toEqual([
      'create policy:t.p',
      'drop policy:t.p',
    ])
  })

  it('reports a CREATE kind it does not handle rather than skipping it', () => {
    expect(unrecognisedCreateKinds('CREATE AGGREGATE public.x (int) (SFUNC = s, STYPE = int);')).toEqual(['aggregate'])
    expect(KNOWN_OBJECT_KINDS).toContain('policy')
  })
})

describe('duplicateCreates', () => {
  it('reports a plain repeat CREATE, which aborts a fresh apply', () => {
    const dupes = duplicateCreates([
      { file: 'a.sql', sql: 'CREATE TYPE app_role AS ENUM (\'user\');' },
      { file: 'b.sql', sql: 'CREATE TYPE app_role AS ENUM (\'admin\');' },
    ])
    expect(dupes).toEqual([{ id: 'type:app_role', file: 'b.sql', firstFile: 'a.sql' }])
  })

  it('does NOT report a DROP followed by a re-create', () => {
    /* THE FALSE POSITIVE THIS FILE WAS ALMOST SHIPPED WITH. The real migration
       re-creates five policies and seven triggers this way, tightening a
       WITH CHECK once the helper it needs exists. A CREATE-only counter reports
       all twelve as "a fresh apply aborts here" — and it did, on the first run,
       naming `confirmations_self_write`. The schema was right; the parser was
       wrong. Pinned here so the fix cannot be reverted by a simplification. */
    const sql = [
      'CREATE POLICY self_write ON public.confirmations FOR INSERT TO authenticated WITH CHECK (true);',
      'DROP POLICY IF EXISTS self_write ON public.confirmations;',
      'CREATE POLICY self_write ON public.confirmations FOR INSERT TO authenticated WITH CHECK (false);',
    ].join('\n')
    expect(duplicateCreates([{ file: 'init.sql', sql }])).toEqual([])
  })

  it('does NOT report an idempotent re-create', () => {
    const fn = 'CREATE OR REPLACE FUNCTION public.f() RETURNS int AS $$ select 1 $$ LANGUAGE sql;'
    expect(duplicateCreates([{ file: 'a.sql', sql: `${fn}\n${fn}` }])).toEqual([])
  })

  it('carries the live set across migrations in apply order', () => {
    const dupes = duplicateCreates([
      { file: '1_init.sql', sql: 'CREATE TABLE public.t (id int);' },
      { file: '2_next.sql', sql: 'CREATE TABLE public.t (id int);' },
    ])
    expect(dupes).toHaveLength(1)
  })

  it('lets a later migration re-create what an earlier one dropped', () => {
    expect(
      duplicateCreates([
        { file: '1.sql', sql: 'CREATE TABLE public.t (id int);' },
        { file: '2.sql', sql: 'DROP TABLE IF EXISTS public.t;' },
        { file: '3.sql', sql: 'CREATE TABLE public.t (id int);' },
      ]),
    ).toEqual([])
  })
})

describe('orderMigrations', () => {
  it('sorts by the timestamp prefix, not by the slug', () => {
    const { ordered } = orderMigrations(['20261001000000_zebra.sql', '20260925000000_init.sql'])
    expect(ordered.map((m) => m.file)).toEqual(['20260925000000_init.sql', '20261001000000_zebra.sql'])
  })

  it('reports a name whose place in the order is undefined', () => {
    const { malformed, ordered } = orderMigrations(['20260925_init.sql', 'notes.sql', '20260925000000_ok.sql'])
    expect(malformed).toEqual(['20260925_init.sql', 'notes.sql'])
    expect(ordered).toHaveLength(1)
  })

  it('reports two migrations sharing one timestamp', () => {
    const { duplicateStamps } = orderMigrations(['20260925000000_a.sql', '20260925000000_b.sql'])
    expect(duplicateStamps).toEqual(['20260925000000'])
  })
})

describe('mirrorFindings', () => {
  const schema = 'CREATE TYPE app_role AS ENUM (\'user\');\n'
  const clean = {
    migrations: [{ file: '20260925000000_init.sql', sql: schema }],
    canonical: { file: 'schema.sql', sql: schema },
    parts: [{ file: 'schema.part1.sql', sql: schema }],
    stray: [],
  }

  it('passes a set that mirrors the released schema', () => {
    const verdict = mirrorFindings(clean)
    expect(verdict.ok).toBe(true)
    expect(verdict.findings).toEqual([])
  })

  it('fails when the first migration is not the released schema', () => {
    /* Not "all migrations == schema.sql": schema.sql is frozen at release and
       migrations extend past it, so comparing the concatenation would report
       drift the day someone adds migration #2. */
    const verdict = mirrorFindings({
      ...clean,
      migrations: [
        { file: '20260925000000_init.sql', sql: 'CREATE TYPE app_role AS ENUM (\'admin\');\n' },
        { file: '20261001000000_more.sql', sql: 'CREATE TABLE public.t (id int);\n' },
      ],
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.findings.map((f) => f.code)).toContain('init-migration-drift')
  })

  it('passes when a later migration extends the frozen schema', () => {
    const verdict = mirrorFindings({
      ...clean,
      migrations: [...clean.migrations, { file: '20261001000000_more.sql', sql: 'CREATE TABLE public.t (id int);\n' }],
    })
    expect(verdict.ok).toBe(true)
  })

  it('fails when the parts no longer assemble to the schema', () => {
    const verdict = mirrorFindings({
      ...clean,
      parts: [{ file: 'schema.part1.sql', sql: schema }, { file: 'schema.part2.sql', sql: 'CREATE TABLE public.t (id int);\n' }],
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.findings.map((f) => f.code)).toContain('parts-drift')
  })

  it('fails on an empty migrations directory', () => {
    const verdict = mirrorFindings({ ...clean, migrations: [] })
    expect(verdict.ok).toBe(false)
    expect(verdict.findings.map((f) => f.code)).toContain('no-migrations')
  })

  it('fails on a duplicate CREATE and on a name with no defined order', () => {
    const verdict = mirrorFindings({
      migrations: [
        { file: '20260925000000_init.sql', sql: schema },
        { file: '20261001000000_again.sql', sql: schema },
        { file: 'undated.sql', sql: '' },
      ],
      canonical: { file: 'schema.sql', sql: schema },
      parts: [],
      stray: [],
    })
    const codes = verdict.findings.map((f) => f.code)
    expect(codes).toContain('duplicate-create')
    expect(codes).toContain('bad-migration-name')
    expect(verdict.ok).toBe(false)
  })

  it('reports a colliding stray schema as a warning, not a blocker', () => {
    /* Severity is the assertion. The psql apply in the dry run is correct
       whatever sits in the repo root's supabase/, so exiting non-zero here would
       teach people to ignore the exit code; but it is the file a CLI-driven
       provisioning run finds INSTEAD, so it cannot be silent either. */
    const verdict = mirrorFindings({
      ...clean,
      stray: [{ file: 'supabase/schema-steps-1-2.sql', sql: schema }],
    })
    const strayFinding = verdict.findings.find((f) => f.code === 'stray-schema')
    expect(strayFinding?.blocking).toBe(false)
    expect(verdict.ok).toBe(true)
  })

  it('ignores a stray file that shares no object with the migrations', () => {
    const verdict = mirrorFindings({
      ...clean,
      stray: [{ file: 'supabase/scratch.sql', sql: 'CREATE TABLE public.unrelated (id int);' }],
    })
    expect(verdict.findings).toEqual([])
  })
})

describe('parseProjectRefs', () => {
  it('reads both refs out of the docs/12 §4 table', () => {
    expect(REFS.staging).toEqual({ project: 'seatswap-staging', ref: 'stagingrefabcdefgh' })
    expect(REFS.prod).toEqual({ project: 'seatswap-prod', ref: 'prodrefabcdefghijk' })
  })

  it('reads a project that does not exist yet as no ref, not as a ref it failed to parse', () => {
    const refs = parseProjectRefs('| staging | seatswap-staging | — none yet (not created) |')
    expect(refs.staging).toEqual({ project: 'seatswap-staging', ref: null })
  })

  it('returns null refs when the table is absent', () => {
    const refs = parseProjectRefs('no table here')
    expect(refs.staging.ref).toBeNull()
    expect(refs.prod.ref).toBeNull()
  })
})

describe('supabaseUrlFindings', () => {
  it('classifies a recorded staging ref as allowed', () => {
    expect(supabaseUrlFindings('https://stagingrefabcdefgh.supabase.co', REFS)).toEqual([
      { host: 'stagingrefabcdefgh.supabase.co', kind: 'staging', allowed: true },
    ])
  })

  it('refuses a prod URL, and allows it only when prod is explicitly asked for', () => {
    const url = 'https://prodrefabcdefghijk.supabase.co'
    expect(supabaseUrlFindings(url, REFS)[0]).toMatchObject({ kind: 'prod', allowed: false })
    expect(supabaseUrlFindings(url, REFS, { allowProd: true })[0].allowed).toBe(true)
  })

  it('refuses a host that matches no recorded ref', () => {
    /* An unrecognised project is neither staging nor prod. Guessing "probably
       staging" is how a prod URL gets committed by someone who typed it wrong. */
    expect(supabaseUrlFindings('https://somethingelse.supabase.co', REFS)[0]).toMatchObject({
      kind: 'unknown',
      allowed: false,
    })
  })

  it('allows the documented placeholder hosts', () => {
    for (const host of PLACEHOLDER_HOSTS) {
      expect(supabaseUrlFindings(`https://${host}`, REFS)[0]).toMatchObject({ kind: 'placeholder', allowed: true })
    }
  })

  it('finds nothing in text with no Supabase URL', () => {
    expect(supabaseUrlFindings('VITE_SUPABASE_URL=\nno url here', REFS)).toEqual([])
  })
})

describe('resolveSupabaseTarget', () => {
  it('treats an empty URL as local-first, which is the state the repo is in', () => {
    const verdict = resolveSupabaseTarget({ url: '', refs: REFS })
    expect(verdict).toMatchObject({ ok: true, target: 'none' })
  })

  it('points at staging by default', () => {
    expect(resolveSupabaseTarget({ url: 'https://stagingrefabcdefgh.supabase.co', refs: REFS })).toMatchObject({
      ok: true,
      target: 'staging',
    })
  })

  it('refuses prod unless it is an explicit opt-in', () => {
    const url = 'https://prodrefabcdefghijk.supabase.co'
    expect(resolveSupabaseTarget({ url, refs: REFS })).toMatchObject({ ok: false, target: 'prod' })
    expect(resolveSupabaseTarget({ url, refs: REFS, allowProd: true })).toMatchObject({ ok: true, target: 'prod' })
  })

  it('refuses a URL it cannot classify', () => {
    expect(resolveSupabaseTarget({ url: 'https://somethingelse.supabase.co', refs: REFS })).toMatchObject({ ok: false })
  })

  it('refuses a value that is not a Supabase project URL at all', () => {
    expect(resolveSupabaseTarget({ url: 'http://localhost:54321', refs: REFS })).toMatchObject({ ok: false, target: 'none' })
  })
})

/* ------------------------------------------------------------------ *
 * The real repo. Fixtures prove the functions work; these prove they work on
 * what is actually committed, which is the only version that matters.
 * ------------------------------------------------------------------ */

function realInputs() {
  const names = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()
  const migrations = names.map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }))
  const canonical = { file: 'schema.sql', sql: readFileSync(join(SB, 'schema.sql'), 'utf8') }
  const parts = readdirSync(SB)
    .filter((n) => /^schema\.part.+\.sql$/.test(n))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(SB, file), 'utf8') }))
  const strayDir = join(REPO, 'supabase')
  const stray = existsSync(strayDir)
    ? readdirSync(strayDir)
        .filter((n) => n.endsWith('.sql'))
        .sort()
        .map((file) => ({ file: `supabase/${file}`, sql: readFileSync(join(strayDir, file), 'utf8') }))
    : []
  return { migrations, canonical, parts, stray }
}

describe('the committed schema', () => {
  it('mirrors: the migrations reproduce the released schema with nothing blocking', () => {
    const verdict = mirrorFindings(realInputs())
    expect(verdict.findings.filter((f) => f.blocking)).toEqual([])
    expect(verdict.ok).toBe(true)
  })

  it('has an object parser that is not blind to the real migration', () => {
    const { migrations } = realInputs()
    let total = 0
    for (const migration of migrations) {
      expect(unrecognisedCreateKinds(migration.sql)).toEqual([])
      /* Every CREATE statement of a known kind must produce an object. Without
         this, a matcher that knows the kind but misses the statement reports
         "no duplicates" about half the file. */
      const pattern = new RegExp(
        `\\bcreate\\s+(?:or\\s+replace\\s+)?(?:unique\\s+)?(?:materialized\\s+)?(?:unlogged\\s+)?(?:constraint\\s+)?(${KNOWN_OBJECT_KINDS.join('|')})\\b`,
        'gi',
      )
      const statements = [...stripSqlComments(migration.sql).matchAll(pattern)].length
      const objects = createdObjects(migration.sql).length
      expect(objects, `${migration.file}: ${statements} CREATE statements, ${objects} objects identified`).toEqual(statements)
      total += objects
    }
    /* The floor is on the TOTAL, not per file: a second migration may legitimately
       add three objects, and a frozen per-file count would go red for a change
       that is not a defect. */
    expect(total).toBeGreaterThan(100)
  })

  it('the real repo has no stray root schema, and the detector still bites on a planted one', () => {
    /* **This assertion was the INVERSE until 2026-10-04** — it read
       `stray.length > 0` and pinned the defect's presence, deliberately, so the
       detector could not be vacuously green on real inputs. Ayu then had the
       stray file deleted (docs/14: "Deleting it is your call, not mine"), so
       the honest assertion is the invariant. **A test that pins a defect must
       be rewritten when the defect is fixed, or it silently becomes a test
       that demands the bug come back** — and that is the failure mode this
       whole file exists to catch, one level up. The anti-vacuity proof is not
       lost: the synthetic case above plants a colliding stray and asserts the
       `stray-schema` finding, and the assertion below pins that the detector
       still fires on that same input, so a detector that stopped biting would
       fail both. */
    const { stray } = realInputs()
    expect(stray).toEqual([])
    const verdict = mirrorFindings(realInputs())
    expect(verdict.findings.map((f) => f.code)).not.toContain('stray-schema')

    const planted = mirrorFindings({
      ...realInputs(),
      stray: [{ file: 'supabase/planted.sql', sql: 'CREATE TABLE public.profiles (id int);' }],
    })
    expect(planted.findings.map((f) => f.code)).toContain('stray-schema')
  })

  it('commits no Supabase project URL that is not a documented placeholder', () => {
    /* The repo state this item starts from: no project exists, so the only
       literal allowed is the vendor example in wrangler.toml's comments. Once
       docs/12 §4 records refs, the same assertion starts distinguishing staging
       from prod instead of refusing everything. */
    const refs = parseProjectRefs(readFileSync(join(REPO, 'docs', '12-INFRA-CREDITS.md'), 'utf8'))
    const scanned = [
      join(APP, 'wrangler.toml'),
      join(APP, '.env.example'),
      ...readdirSync(join(APP, 'src', 'lib')).filter((n) => /\.tsx?$/.test(n)).map((n) => join(APP, 'src', 'lib', n)),
    ]
    let found = 0
    for (const file of scanned) {
      if (!existsSync(file)) continue
      for (const finding of supabaseUrlFindings(readFileSync(file, 'utf8'), refs)) {
        found += 1
        expect(finding.allowed, `${file} hardcodes ${finding.host} (${finding.kind})`).toBe(true)
      }
    }
    expect(found).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ *
 * The dry run itself: no network, no spend, and a success token that cannot
 * appear on a failing run.
 * ------------------------------------------------------------------ */

function runDryRun(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-dryrun-'))
  const log = join(dir, 'net.log')
  const result = spawnSync(
    process.execPath,
    ['--import', NO_NET, CLI],
    {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, NO_NET_LOG: log, VITE_SUPABASE_URL: '', ...env },
    },
  )
  /* no-net.mjs appends one line per refused call and creates nothing otherwise,
     so "the file does not exist" and "the file is empty" both mean zero calls. */
  const attempts = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
  rmSync(dir, { recursive: true, force: true })
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}`, attempts }
}

describe('staging-dry-run.mjs', () => {
  it('is importable only from fs/path/url and the pure module — no network or subprocess capability at all', () => {
    /* Stronger than grepping for `fetch`, which the file's own comments contain.
       A module that cannot import http, https, child_process or net cannot reach
       an API however it is written, so this stays true if someone later adds a
       `create project` branch. */
    const source = readFileSync(CLI, 'utf8')
    const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const spec of specifiers) {
      expect(['node:fs', 'node:path', 'node:url', './staging-lib.mjs'], `${spec} gives the dry run reach it must not have`).toContain(spec)
    }
  })

  it('makes zero network calls and reports the machine-readable token', () => {
    const run = runDryRun()
    expect(run.attempts).toEqual([])
    expect(run.out).toMatch(/STAGING-DRYRUN-OK migrations=\d+ objects=\d+ blocking=0 warnings=\d+ network=0 spend=0\.00/)
    expect(run.status).toBe(0)
  })

  it('reports the object count it measured, cross-checked against the pure function', () => {
    /* Not a frozen `objects=112`: the schema grows, and a number that goes red for
       a legitimate migration teaches people to ignore the token. What is asserted
       instead is that the CLI's reported count equals one computed independently
       here, so it cannot report a measurement it did not make. */
    const run = runDryRun()
    const token = /objects=(\d+) blocking=0/.exec(run.out)
    expect(token, `no clean token in: ${run.out.slice(-400)}`).not.toBeNull()
    const { migrations } = realInputs()
    const expected = migrations.reduce((n, m) => n + createdObjects(m.sql).length, 0)
    expect(Number(token?.[1])).toBe(expected)
    expect(expected).toBeGreaterThan(100)
    expect(run.out).not.toMatch(/DRY RUN FAILED/)
  })

  it('exits non-zero WITHOUT the token when the environment points at an unrecorded project', () => {
    /* The ordering assertion, and the reason the token is printed last. A
       machine-readable "ok" that appears before the check that can fail it is
       not a success signal — `burndown-dry-run.mjs` shipped exactly that bug. */
    const run = runDryRun({ VITE_SUPABASE_URL: 'https://unrecordedproject.supabase.co' })
    expect(run.status).toBe(1)
    expect(run.out).toMatch(/DRY RUN FAILED/)
    expect(run.out).not.toMatch(/STAGING-DRYRUN-OK/)
  })

  it('refuses a prod URL in the environment even when a prod ref is recorded', () => {
    /* Reachable today only through docs/12 §4 gaining a ref; asserted through the
       pure function above and through the CLI's own gate here, so the two cannot
       drift apart. */
    const verdict = resolveSupabaseTarget({ url: 'https://prodrefabcdefghijk.supabase.co', refs: REFS })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/staging by default/)
  })
})
