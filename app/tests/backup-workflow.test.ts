/* L9's backup/staging scaffolding guards (docs/10 items 2+3) — the runs that
   need real keys cannot execute here, so this pins everything around them:
   the workflow file's shape, its secrets-by-name discipline, the mirror
   script's refusal behavior, and the env-var paperwork agents.md demands.

   Deliberately string-based, not YAML-parsed: no yaml library ships with
   this repo, and adding one to test a single file would itself need a
   vendor decision. The strings below are load-bearing contract points
   (cron time, secret names, pipefail, bucket), not formatting. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const read = (rel: string): string =>
  readFileSync(join(import.meta.dirname, '..', '..', rel), 'utf8')

const WORKFLOW = '.github/workflows/seatswap-backup.yml'
const MIRROR = 'app/scripts/staging-mirror.mjs'
const ENV_EXAMPLE = 'app/.env.example'

const SIX_SECRETS = [
  'SUPABASE_DB_URL',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
  'ALERT_EMAIL',
  'ZEPTOMAIL_TOKEN',
] as const

describe('seatswap-backup.yml: the nightly backup contract', () => {
  const yml = read(WORKFLOW)

  it('runs nightly 22:00 UTC and on manual dispatch', () => {
    expect(yml).toContain("cron: '0 22 * * *'")
    expect(yml).toContain('workflow_dispatch')
  })

  it('names all six secrets and values none of them', () => {
    for (const name of SIX_SECRETS) {
      expect(yml).toContain(`\${{ secrets.${name} }}`)
    }
    // Secret-shaped literals must never appear in the file.
    expect(yml).not.toMatch(/AKIA[0-9A-Z]{16}/)
    expect(yml).not.toMatch(/-----BEGIN [A-Z ]+-----/)
    // Every env: value is a secrets.* / github.* reference or a shell var.
    for (const line of yml.split('\n')) {
      const m = /^\s+[A-Z_]+:\s+(.+)$/.exec(line.trimEnd())
      if (!m || /^(name|run|uses|if|env|jobs|steps|on|schedule|runs-on|timeout-minutes)$/.test(line.trim().split(':')[0])) continue
      const value = m[1].trim()
      if (value === '' || value === '|' || value.startsWith('#')) continue
      expect(value, `env value must be a reference, not a literal: ${line.trim()}`).toMatch(
        /^(\$\{\{\s*(secrets|github)\.[^}]+\}\}|"s3:\/\/[^"]+"|`[^`]+`)$/,
      )
    }
  })

  it('cannot silently ship an empty dump (pipefail in every run block)', () => {
    // pg_dump | gzip without pipefail exits 0 on an empty dump — so the
    // assertion counts blocks, not the file: dropping it from one block
    // while three others keep it must still fail.
    const blocks = yml.split(/(?=^\s+run: \|)/m).filter((b) => /run: \|/.test(b))
    expect(blocks.length).toBeGreaterThanOrEqual(4)
    for (const block of blocks) {
      expect(block).toContain('set -euo pipefail')
    }
    expect(yml).toContain('if: failure()')
    expect(yml).toContain('api.zeptomail.com')
  })

  it('writes date-stamped keys into the documented bucket', () => {
    expect(yml).toContain('s3://seatswap-backups-prod/seatswap-$(date -u +%F).sql.gz')
  })
})

describe('staging-mirror.mjs: simulated keys stay simulated', () => {
  const src = read(MIRROR)

  it('reads the staging URL from the environment, never from a literal', () => {
    expect(src).toContain('process.env.SUPABASE_DB_URL_STAGING')
    expect(src).not.toMatch(/postgresql:\/\/[^'"\s]*:[^'"\s]*@/)
  })

  it('refuses --apply on missing or simulated values with the key path', () => {
    expect(src).toContain('REFUSING --apply')
    expect(src).toContain('example|changeme|placeholder')
    expect(src).toContain('Settings → Database')
  })

  it('never prints the URL and stops at the first failed migration', () => {
    expect(src).toContain('hostOf(')
    expect(src).toContain('ON_ERROR_STOP')
  })

  it('the env paperwork exists (agents.md env rule)', () => {
    const example = read(ENV_EXAMPLE)
    expect(example).toContain('SUPABASE_DB_URL_STAGING')
    const ledger = read('docs/12-INFRA-CREDITS.md')
    expect(ledger).toContain('| SUPABASE_DB_URL_STAGING |')
  })
})
