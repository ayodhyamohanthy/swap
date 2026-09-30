#!/usr/bin/env node
/* seatswap-staging mirror (docs/10 L9 item 2) — applies app/supabase/migrations/
   to the staging database, in filename order, with psql's ON_ERROR_STOP.
 *
 * Key model (docs/12 §8): connection strings are NEVER in this repo.
 *   SUPABASE_DB_URL_STAGING — staging direct connection (port 5432).
 *     Supabase dashboard → seatswap-staging → Settings → Database.
 *     Local runs read it from the environment (export it, or a local .env
 *     file the shell sources — never commit it).
 *   Agents point at staging by default by setting their LOCAL .env to the
 *   staging values (same VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY names,
 *   staging project values). The app client is already env-driven
 *   (lib/supabase.ts reads both, never crashes when unset).
 *
 * Simulated keys: with no real URL in the environment (empty, or a value
 * containing example/changeme/placeholder/</>/localhost), --apply REFUSES
 * with the exact dashboard path above. The default plan mode makes no
 * network calls and spawns nothing — safe to run anywhere, any time.
 * The full URL (password included) is NEVER printed; logs show host only.
 */

import { execFileSync, execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const APPLY = process.argv.includes('--apply')

function listMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, bytes: statSync(join(MIGRATIONS, f)).size }))
}

function hostOf(url) {
  const m = /@([^/:]+)(:\d+)?\//.exec(url)
  return m ? m[1] : '(unparseable)'
}

function isPlaceholder(url) {
  if (!url || !url.trim()) return 'empty or unset'
  if (/example|changeme|placeholder|[<>]|your-|localhost|127\.0\.0\.1/i.test(url)) {
    return 'looks simulated'
  }
  return null
}

const files = listMigrations()
const url = process.env.SUPABASE_DB_URL_STAGING ?? ''
console.log(`migrations: ${files.length} file(s) in app/supabase/migrations/`)
for (const f of files) console.log(`  ${f.file} (${f.bytes} bytes)`)

const problem = isPlaceholder(url)
if (!APPLY) {
  console.log(`target host: ${problem ? `(no real URL — ${problem})` : hostOf(url)}`)
  console.log('plan only (default): nothing executed, no network. Re-run with --apply to migrate.')
  process.exit(0)
}

if (problem) {
  console.error(
    `REFUSING --apply: SUPABASE_DB_URL_STAGING is ${problem}.\n` +
      'Real key needed (Ayu): Supabase dashboard → seatswap-staging → Settings → Database → ' +
      'direct connection string (port 5432). Export it and re-run; it is never printed or committed.',
  )
  process.exit(2)
}

try {
  execSync('psql --version', { stdio: 'ignore' })
} catch {
  console.error('REFUSING --apply: `psql` not found. Install postgresql-client, then re-run.')
  process.exit(2)
}

console.log(`applying ${files.length} migration(s) to host ${hostOf(url)} ...`)
let failed = 0
for (const f of files) {
  try {
    execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(MIGRATIONS, f.file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    console.log(`  ok  ${f.file}`)
  } catch (err) {
    failed += 1
    const tail = String(err?.stderr ?? err?.message ?? err)
      .split('\n')
      .slice(-3)
      .join('\n')
    console.error(`  FAIL ${f.file}:\n${tail}`)
    break
  }
}
if (failed) {
  console.error('stopped at first failure (ON_ERROR_STOP): fix staging, then re-run — applied files stay applied.')
  process.exit(1)
}
console.log('mirror complete: staging matches app/supabase/migrations/.')
