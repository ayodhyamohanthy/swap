/* Schema invariants (AGENTS.md tech stack + docs/02-DATA-MODEL.md).
   Reads the migration off disk and asserts the security properties that must
   never regress: RLS on every table, explicit GRANTs, has_role() as SECURITY
   DEFINER, roles in a separate user_roles table, integer paise, and no column
   that could hold a plaintext PNR. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SUPABASE = join(import.meta.dirname, '..', 'supabase')
const MIGRATION = join(SUPABASE, 'migrations', '20260925000000_init.sql')
const SCHEMA = readFileSync(MIGRATION, 'utf8')

/** `create table public.foo (` / `create table if not exists public.foo (` */
function tableNames(sql: string): string[] {
  const names: string[] = []
  for (const match of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi,
  )) {
    names.push(match[1])
  }
  return names
}

const TABLES = tableNames(SCHEMA)

describe('the migration exists and is the shipped schema', () => {
  it('has a runnable migration file', () => {
    expect(SCHEMA.length).toBeGreaterThan(1000)
  })

  it('is byte-identical to schema.sql', () => {
    expect(SCHEMA).toBe(readFileSync(join(SUPABASE, 'schema.sql'), 'utf8'))
  })

  it('declares every expected table', () => {
    expect(TABLES.length).toBeGreaterThan(10)
    for (const table of [
      'profiles',
      'user_roles',
      'bookings',
      'passengers',
      'swap_requests',
      'swap_offers',
      'payments',
      'wallet_tx',
      'activity_log',
    ]) {
      expect(TABLES, `missing table ${table}`).toContain(table)
    }
  })
})

describe('row level security is on everywhere', () => {
  it('enables RLS on every table', () => {
    for (const table of TABLES) {
      const pattern = new RegExp(
        `alter\\s+table\\s+(?:if\\s+exists\\s+)?public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
        'i',
      )
      expect(pattern.test(SCHEMA), `RLS not enabled on ${table}`).toBe(true)
    }
  })

  it('has at least as many RLS policies as tables', () => {
    const policies = SCHEMA.match(/create\s+policy/gi)?.length ?? 0
    expect(policies).toBeGreaterThanOrEqual(TABLES.length)
  })
})

describe('privileges are explicit (AGENTS.md: explicit GRANTs)', () => {
  it('revokes the default privileges from anon', () => {
    expect(SCHEMA).toMatch(/revoke\s+all\s+on\s+table[\s\S]*?from\s+public,\s*anon/i)
  })

  it('grants authenticated access per table', () => {
    const grants = SCHEMA.match(/grant\s+[^;]+?\s+on\s+table\s+public\.\w+\s+to\s+authenticated/gi)
    expect(grants?.length ?? 0).toBeGreaterThan(5)
  })
})

describe('admin role checks are server-side only', () => {
  it('keeps roles in a separate user_roles table', () => {
    expect(TABLES).toContain('user_roles')
    /* No role column on profiles — that is how client checks creep in. */
    expect(SCHEMA).not.toMatch(/alter\s+table\s+public\.profiles\s+add\s+column\s+is_admin/i)
  })

  it('defines has_role() as SECURITY DEFINER', () => {
    expect(SCHEMA).toMatch(/create\s+(or\s+replace\s+)?function[\s\S]{0,200}?has_role/i)
    const fn = SCHEMA.match(/create\s+(or\s+replace\s+)?function[\s\S]*?has_role[\s\S]*?\$\$/i)
    expect(fn?.[0], 'has_role() definition not found').toBeTruthy()
    expect(fn?.[0]).toMatch(/security\s+definer/i)
  })

  it('restricts is_staff to the server via search_path pinning', () => {
    expect(SCHEMA).toMatch(/is_staff/i)
    expect(SCHEMA).toMatch(/set\s+search_path/i)
  })
})

describe('money is integer paise', () => {
  it('stores amounts in *_paise integer columns', () => {
    for (const column of ['amount_paise', 'credit_used_paise']) {
      expect(SCHEMA, `missing ${column}`).toMatch(new RegExp(`${column}\\s+int`, 'i'))
    }
  })

  it('never uses a float or numeric money column', () => {
    expect(SCHEMA).not.toMatch(/amount\s+(float|double\s+precision)/i)
  })
})

describe('privacy: no plaintext PNR column (rule 13)', () => {
  it('stores only a hash and a last4', () => {
    expect(SCHEMA).toMatch(/pnr_hash\s+text/i)
    expect(SCHEMA).toMatch(/pnr_last4\s+(text|varchar)/i)
  })

  it('has no bare pnr column anywhere', () => {
    const bare = SCHEMA.match(/\bpnr\s+(text|varchar|char)/i)
    expect(bare?.[0]).toBeUndefined()
  })

  it('does not store another user\'s phone, email or full name', () => {
    for (const column of ['phone', 'email', 'full_name']) {
      expect(SCHEMA, `unexpected ${column} column`).not.toMatch(
        new RegExp(`^\\s*${column}\\s+`, 'im'),
      )
    }
  })
})

describe('Google-only sign-in (rule 8)', () => {
  it('has no phone OTP, SMS OTP or password columns', () => {
    for (const banned of ['otp', 'otp_code', 'password', 'phone_number']) {
      expect(SCHEMA, `found ${banned}`).not.toMatch(
        new RegExp(`^\\s*${banned}\\s+`, 'im'),
      )
    }
  })
})
