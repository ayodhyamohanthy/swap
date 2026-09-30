/* staging-lib.mjs — what "mirror schema via migrations" and "agents point at
 * staging by default" mean, as pure functions.
 *
 * WHY THIS IS A SEPARATE FILE, and why it has no imports. Same reason as
 * `lane-board.mjs` and `vendor-whitelist.mjs`: a test cannot import a module
 * that pulls in `node:child_process` or `node:fs`, because docs/11 records what
 * that costs under the jsdom pool. So the decisions live here — strings in,
 * verdicts out — and `staging-dry-run.mjs` is the part that touches the disk.
 *
 * WHY IT EXISTS AT ALL. docs/10's L9 item 2 asks for a staging Supabase project
 * whose schema is mirrored "via migrations". Creating the project needs Ayu's
 * access token and cannot be done here. The mirroring can be *checked* here, and
 * it needed checking: the schema exists as three copies of the same 1086 lines
 * (`schema.part*.sql` → `schema.sql` → `migrations/20260925000000_init.sql`)
 * with nothing asserting they agree, and a fourth, older copy sits at the repo
 * root's `supabase/` — which is where the Supabase CLI looks by default.
 *
 * WHY THE DRIFT CHECK IS "FIRST MIGRATION == SCHEMA", NOT "ALL MIGRATIONS ==
 * SCHEMA". `schema.sql` says so itself: "do not edit parts after release — add a
 * new migration instead". So `schema.sql` is a frozen snapshot of the released
 * schema and migrations extend past it. Comparing the *concatenation* of all
 * migrations to `schema.sql` would therefore report drift the moment anyone adds
 * migration #2 — a guard that fails on the workflow it exists to protect is a
 * guard everyone learns to ignore. The invariant that stays true is: parts
 * assemble to `schema.sql`, and `schema.sql` is exactly the first migration.
 */

/* ------------------------------------------------------------------ *
 * SQL object identities — for "would a fresh apply fail?"
 * ------------------------------------------------------------------ */

/**
 * Strip block comments and `--` line comments.
 *
 * Done before every match, because a header comment that *mentions* a CREATE
 * would otherwise be counted as one. L7 hit exactly this: a guard read its own
 * explanatory comment and failed on it. The simplification worth naming: a `--`
 * inside a string literal is also stripped. Nothing in this schema puts one
 * there, and `createdObjects` only ever looks for `create <kind> <name>`, so the
 * cost of being wrong here is an object this file does not report.
 */
export function stripSqlComments(sql) {
  return String(sql ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

/** Modifiers that sit between CREATE and the object kind. */
const MODIFIERS = '(?:or\\s+replace\\s+)?(?:unique\\s+)?(?:materialized\\s+)?(?:unlogged\\s+)?(?:constraint\\s+)?'

/** The object kinds `createdObjects` knows how to identify. */
export const KNOWN_OBJECT_KINDS = [
  'type',
  'table',
  'index',
  'sequence',
  'extension',
  'schema',
  'view',
  'function',
  'policy',
  'trigger',
]

/**
 * CREATE kinds present in the SQL that `createdObjects` does not handle.
 *
 * This is the completeness check, and it is the part that keeps the rest honest.
 * A matcher that has never heard of `CREATE AGGREGATE` does not fail — it silently
 * skips the object, and then "no duplicates" means "no duplicates among the kinds
 * I recognised". `burndown-dry-run.mjs` fails on an unlisted script for the same
 * reason.
 */
export function unrecognisedCreateKinds(sql) {
  const src = stripSqlComments(sql)
  const known = new Set(KNOWN_OBJECT_KINDS)
  const found = new Set()
  const re = new RegExp(`\\bcreate\\s+${MODIFIERS}(\\w+)`, 'gi')
  for (const match of src.matchAll(re)) {
    const kind = match[1].toLowerCase()
    if (!known.has(kind)) found.add(kind)
  }
  return [...found].sort()
}

/** Collapse an argument list to a comparable form. */
function signature(args) {
  return String(args ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Every CREATE and DROP that names an object, in source order.
 *
 * `idempotent` is the point of the shape: a second `CREATE OR REPLACE FUNCTION`
 * or `CREATE TABLE IF NOT EXISTS` is a no-op on a fresh apply, while a second
 * plain `CREATE TYPE` is a hard error. A duplicate check that cannot tell those
 * apart either misses real failures or reports the schema's own 13 `OR REPLACE`
 * functions as broken.
 *
 * DROPS ARE HALF THE ANSWER, and leaving them out produces a confident lie. This
 * schema deliberately re-creates five policies and seven triggers — `DROP POLICY
 * IF EXISTS …;` then a tighter `CREATE POLICY …` once the helper function it
 * needs exists. Counting CREATEs alone reports all twelve as "a fresh apply
 * aborts here", which is false, and the first agent to check one by hand stops
 * believing the rest. So the walker sees both operations, and an object is a
 * duplicate only if it is still live when the second CREATE reaches it.
 *
 * @returns {{ op: 'create' | 'drop', kind: string, id: string, idempotent: boolean, at: number }[]}
 */
export function objectStatements(sql) {
  const src = stripSqlComments(sql)
  const out = []
  const add = (op, kind, name, idempotent, match) => {
    out.push({ op, kind, id: `${kind}:${name}`, idempotent: Boolean(idempotent), at: match.index ?? 0 })
  }

  /* ---- creates ---- */
  for (const m of src.matchAll(/create\s+type\s+(?:public\.)?(?<n>\w+)/gi)) {
    add('create', 'type', m.groups.n, false, m)
  }
  for (const m of src.matchAll(/create\s+table\s+(?<ine>if\s+not\s+exists\s+)?(?:public\.)?(?<n>\w+)/gi)) {
    add('create', 'table', m.groups.n, m.groups.ine, m)
  }
  for (const m of src.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?<ine>if\s+not\s+exists\s+)?(?<n>\w+)/gi)) {
    add('create', 'index', m.groups.n, m.groups.ine, m)
  }
  for (const m of src.matchAll(/create\s+sequence\s+(?<ine>if\s+not\s+exists\s+)?(?:public\.)?(?<n>\w+)/gi)) {
    add('create', 'sequence', m.groups.n, m.groups.ine, m)
  }
  for (const m of src.matchAll(/create\s+extension\s+(?<ine>if\s+not\s+exists\s+)?(?<n>\w+)/gi)) {
    add('create', 'extension', m.groups.n, m.groups.ine, m)
  }
  for (const m of src.matchAll(/create\s+schema\s+(?<ine>if\s+not\s+exists\s+)?(?<n>\w+)/gi)) {
    add('create', 'schema', m.groups.n, m.groups.ine, m)
  }
  for (const m of src.matchAll(/create\s+(?<orr>or\s+replace\s+)?(?:materialized\s+)?view\s+(?:public\.)?(?<n>\w+)/gi)) {
    add('create', 'view', m.groups.n, m.groups.orr, m)
  }
  /* A function's identity is its signature, not its name: Postgres overloads, so
     `f(uuid)` and `f(uuid, int)` coexist and are not a duplicate. The argument
     list is read up to the `)` that precedes RETURNS rather than the first `)`,
     because a default like `gen_random_uuid()` contains one. */
  for (const m of src.matchAll(/create\s+(?<orr>or\s+replace\s+)?function\s+(?:public\.)?(?<n>\w+)\s*\((?<a>[\s\S]*?)\)\s*returns\b/gi)) {
    add('create', 'function', `${m.groups.n}(${signature(m.groups.a)})`, m.groups.orr, m)
  }
  /* Policies and triggers are scoped to their table: the schema reuses names like
     `read_own` across 43 policies, so the bare name is not an identity. */
  for (const m of src.matchAll(/create\s+policy\s+(?<n>\w+)\s+on\s+(?:public\.)?(?<t>\w+)/gi)) {
    add('create', 'policy', `${m.groups.t}.${m.groups.n}`, false, m)
  }
  for (const m of src.matchAll(/create\s+(?:constraint\s+)?trigger\s+(?<n>\w+)[\s\S]*?\bon\s+(?:public\.)?(?<t>\w+)/gi)) {
    add('create', 'trigger', `${m.groups.t}.${m.groups.n}`, false, m)
  }

  /* ---- drops, in the same identity scheme ---- */
  for (const m of src.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?(?<n>\w+)\s+on\s+(?:public\.)?(?<t>\w+)/gi)) {
    add('drop', 'policy', `${m.groups.t}.${m.groups.n}`, false, m)
  }
  for (const m of src.matchAll(/drop\s+(?:constraint\s+)?trigger\s+(?:if\s+exists\s+)?(?<n>\w+)\s+on\s+(?:public\.)?(?<t>\w+)/gi)) {
    add('drop', 'trigger', `${m.groups.t}.${m.groups.n}`, false, m)
  }
  for (const m of src.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(?<n>\w+)\s*\((?<a>[\s\S]*?)\)/gi)) {
    add('drop', 'function', `${m.groups.n}(${signature(m.groups.a)})`, false, m)
  }
  for (const m of src.matchAll(/drop\s+(?<k>type|table|index|sequence|extension|schema|view)\s+(?:if\s+exists\s+)?(?:public\.)?(?<n>\w+)/gi)) {
    add('drop', m.groups.k.toLowerCase(), m.groups.n, false, m)
  }

  return out.sort((a, b) => a.at - b.at)
}

/**
 * The objects a script creates — `objectStatements` without the drops.
 *
 * @returns {{ kind: string, id: string, idempotent: boolean }[]}
 */
export function createdObjects(sql) {
  return objectStatements(sql)
    .filter((s) => s.op === 'create')
    .map(({ kind, id, idempotent }) => ({ kind, id, idempotent }))
}

/**
 * Objects created twice while still live, across files in apply order.
 *
 * The live set carries between files, because that is what an apply does: a
 * migration may legitimately re-create something an earlier one dropped, and may
 * not create something an earlier one already created.
 *
 * @param files {{ file: string, sql: string }[]}
 * @returns {{ id: string, file: string, firstFile: string }[]}
 */
export function duplicateCreates(files) {
  const live = new Map()
  const out = []
  for (const file of files ?? []) {
    for (const stmt of objectStatements(file.sql)) {
      if (stmt.op === 'drop') {
        live.delete(stmt.id)
        continue
      }
      const firstFile = live.get(stmt.id)
      if (firstFile !== undefined && !stmt.idempotent) {
        out.push({ id: stmt.id, file: file.file, firstFile })
      }
      live.set(stmt.id, file.file)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Migration ordering
 * ------------------------------------------------------------------ */

/** A Supabase migration filename: `<14-digit timestamp>_<slug>.sql`. */
const MIGRATION_NAME = /^(\d{14})_(.+)\.sql$/

/**
 * Migration filenames in apply order.
 *
 * Order is the whole contract of a migrations directory, and lexicographic sort
 * of a fixed-width timestamp is chronological sort — which stops being true the
 * day someone writes a 10-digit prefix, so a name that does not match is reported
 * rather than sorted anyway. Two migrations sharing one timestamp have no defined
 * order between them; that is reported too, because "applies on my machine" is
 * what a nondeterministic order looks like from the inside.
 *
 * @returns {{ ordered: { file: string, stamp: string }[], malformed: string[], duplicateStamps: string[] }}
 */
export function orderMigrations(names) {
  const ordered = []
  const malformed = []
  for (const name of names ?? []) {
    const match = MIGRATION_NAME.exec(name)
    if (!match) {
      malformed.push(name)
      continue
    }
    ordered.push({ file: name, stamp: match[1] })
  }
  ordered.sort((a, b) => (a.stamp === b.stamp ? a.file.localeCompare(b.file) : a.stamp.localeCompare(b.stamp)))

  const seen = new Map()
  for (const m of ordered) seen.set(m.stamp, (seen.get(m.stamp) ?? 0) + 1)
  const duplicateStamps = [...seen].filter(([, n]) => n > 1).map(([stamp]) => stamp).sort()

  return { ordered, malformed, duplicateStamps }
}

/* ------------------------------------------------------------------ *
 * The mirror
 * ------------------------------------------------------------------ */

/** Concatenate file bodies the way an apply would. */
function concat(files) {
  return (files ?? []).map((f) => String(f?.sql ?? '')).join('')
}

/**
 * Does the migration set still mirror the released schema?
 *
 * @param migrations {{ file: string, sql: string }[]} in apply order
 * @param canonical  {{ file: string, sql: string } | null} the released `schema.sql`
 * @param parts      {{ file: string, sql: string }[]} in assembly order
 * @param stray      {{ file: string, sql: string }[]} SQL in a *different* `supabase/` dir
 *
 * `blocking` separates "a fresh apply would fail or build the wrong database"
 * from "a tool could pick the wrong directory". Only the first stops a
 * provisioning run; the second is reported because it is real, but it does not
 * make the psql path unsafe, and a dry run that exits non-zero on something the
 * recommended path already avoids teaches people to ignore its exit code.
 *
 * @returns {{ ok: boolean, findings: { code: string, blocking: boolean, detail: string }[] }}
 */
export function mirrorFindings({ migrations, canonical, parts, stray }) {
  const findings = []
  const add = (code, blocking, detail) => findings.push({ code, blocking, detail })
  const list = migrations ?? []

  if (list.length === 0) {
    add('no-migrations', true, 'the migrations directory is empty — there is nothing to mirror a schema from')
  }

  /* Apply order is part of the mirror: the same statements in a different order
     is a different database. Both of these mean the order is not decided by the
     filenames, so "worked on my machine" is the only evidence it ever gets. */
  const ordering = orderMigrations(list.map((f) => f.file))
  for (const name of ordering.malformed) {
    add('bad-migration-name', true, `${name} is not <14-digit timestamp>_<slug>.sql, so its place in the apply order is undefined`)
  }
  for (const stamp of ordering.duplicateStamps) {
    add('duplicate-timestamp', true, `two or more migrations share the timestamp ${stamp}, so nothing decides which applies first`)
  }

  /* A repeated non-idempotent CREATE with no DROP between them. See
     `duplicateCreates` for why the DROP matters. */
  for (const dup of duplicateCreates(list)) {
    add(
      'duplicate-create',
      true,
      `${dup.id} is created in ${dup.firstFile} and again in ${dup.file} with no DROP in between — a fresh apply aborts on the second`,
    )
  }

  if (canonical) {
    if (list.length > 0 && list[0].sql !== canonical.sql) {
      add(
        'init-migration-drift',
        true,
        `${canonical.file} and the first migration ${list[0].file} differ, so "apply the migrations" and "apply the schema" build two different databases`,
      )
    }
    const assembled = concat(parts)
    if ((parts ?? []).length > 0 && assembled !== canonical.sql) {
      add(
        'parts-drift',
        true,
        `${(parts ?? []).length} schema.part*.sql files no longer assemble to ${canonical.file} — reassembling it would change the released schema`,
      )
    }
  }

  /* A second `supabase/` directory. The Supabase CLI resolves `supabase/` from
     the project root, so a stray schema there is not dead weight — it is what a
     CLI-driven provisioning run finds *instead* of the real migrations. Only a
     collision is reported: an unrelated SQL file in that directory cannot be
     mistaken for the schema by anything. */
  const migrated = new Set(list.flatMap((f) => createdObjects(f.sql).map((o) => o.id)))
  for (const file of stray ?? []) {
    const shared = createdObjects(file.sql)
      .map((o) => o.id)
      .filter((id) => migrated.has(id))
    if (shared.length > 0) {
      add(
        'stray-schema',
        false,
        `${file.file} re-creates ${shared.length} object(s) the migrations also create (e.g. ${shared.slice(0, 3).join(', ')}) — applying both aborts, and a CLI run from the repo root finds this instead of app/supabase/migrations`,
      )
    }
  }

  return { ok: findings.every((f) => !f.blocking), findings }
}

/* ------------------------------------------------------------------ *
 * Which project an agent points at
 * ------------------------------------------------------------------ */

/**
 * Supabase project refs recorded in docs/12 §4.
 *
 * Derived from the ledger rather than hardcoded, for the reason
 * `parseVendorLedger` gives: a hand-written ref is a second source of truth that
 * rots, and the moment Ayu creates the projects the refs go into docs/12 §4 and
 * this starts resolving them with no edit here.
 *
 * A Supabase URL host is the project *ref* (a random ~20-char slug), NOT the
 * project name — `seatswap-staging` never appears in a URL. So the name cannot
 * stand in for the ref, and an unrecorded ref is unclassifiable rather than
 * "probably staging".
 *
 * @returns {{ staging: { project: string, ref: string | null }, prod: { project: string, ref: string | null } }}
 */
export function parseProjectRefs(docsText) {
  const out = {
    staging: { project: '', ref: null },
    prod: { project: '', ref: null },
  }
  for (const line of String(docsText ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.split('|').map((c) => c.trim())
    if (cells.length < 4) continue
    const env = cells[1].toLowerCase()
    if (env !== 'staging' && env !== 'prod') continue
    const project = cells[2]
    /* A ref is a lowercase slug. Anything else in that cell — a dash, "(none
       yet)", a TODO — means the project does not exist, which is a different
       fact from a ref this parser failed to read. */
    const ref = /^[a-z][a-z0-9]{7,}$/.test(cells[3]) ? cells[3] : null
    out[env] = { project, ref }
  }
  return out
}

/** Hosts that are documentation placeholders, not projects. */
export const PLACEHOLDER_HOSTS = ['xyzcompany.supabase.co']

/**
 * Classify every Supabase project URL in a text.
 *
 * The rule being enforced is docs/12 §4's "agents develop against staging": a
 * committed prod URL is how a laptop, a CI job or a deploy silently writes to the
 * database real passengers are in. `unknown` is refused for the same reason
 * `parseProjectRefs` refuses to guess — an unrecognised project is neither
 * staging nor prod, and docs/15 requires a resource name to identify its
 * environment on its own.
 *
 * @returns {{ host: string, kind: 'staging' | 'prod' | 'placeholder' | 'unknown', allowed: boolean }[]}
 */
export function supabaseUrlFindings(text, refs, options = {}) {
  const out = []
  const re = /https:\/\/(?<host>[a-z0-9-]+\.supabase\.(?:co|in))/gi
  for (const m of String(text ?? '').matchAll(re)) {
    const host = m.groups.host.toLowerCase()
    let kind = 'unknown'
    if (refs?.staging?.ref && host.startsWith(`${refs.staging.ref}.`)) kind = 'staging'
    else if (refs?.prod?.ref && host.startsWith(`${refs.prod.ref}.`)) kind = 'prod'
    else if (PLACEHOLDER_HOSTS.includes(host)) kind = 'placeholder'
    /* A prod URL is legitimate in exactly one place: a deploy that means to be
       prod. That is an explicit act, not a default, so it has to be asked for. */
    const allowed = kind === 'staging' || kind === 'placeholder' || (kind === 'prod' && options.allowProd === true)
    out.push({ host, kind, allowed })
  }
  return out
}

/**
 * Which project an agent's env points at.
 *
 * Empty env is a legitimate answer, not a failure: the app is local-first and
 * `lib/supabase.ts` falls back to `lib/store` when no key is set. That is the
 * state the repo is in today, so treating it as an error would make the guard
 * unusable until Ayu creates the projects — and a guard that cannot pass is a
 * guard that gets deleted.
 *
 * @returns {{ ok: boolean, target: 'none' | 'staging' | 'prod', reason: string }}
 */
export function resolveSupabaseTarget({ url, refs, allowProd = false } = {}) {
  const value = String(url ?? '').trim()
  if (value.length === 0) {
    return { ok: true, target: 'none', reason: 'no VITE_SUPABASE_URL — the app stays local-first (lib/supabase.ts)' }
  }
  const findings = supabaseUrlFindings(value, refs, { allowProd })
  if (findings.length === 0) {
    return { ok: false, target: 'none', reason: `"${value}" is not a Supabase project URL` }
  }
  const finding = findings[0]
  if (finding.allowed) {
    return { ok: true, target: finding.kind === 'placeholder' ? 'none' : finding.kind, reason: `${finding.host} is ${finding.kind}` }
  }
  if (finding.kind === 'prod') {
    return {
      ok: false,
      target: 'prod',
      reason: `${finding.host} is the PROD project; agents point at staging by default (docs/12 §4) — prod needs an explicit opt-in`,
    }
  }
  return {
    ok: false,
    target: 'none',
    reason: `${finding.host} matches no ref recorded in docs/12 §4, so nothing can say whether it is staging or prod`,
  }
}
