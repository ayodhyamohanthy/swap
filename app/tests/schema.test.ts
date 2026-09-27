/* Schema invariants (AGENTS.md tech stack + docs/02-DATA-MODEL.md).
   Reads the migration off disk and asserts the security properties that must
   never regress: RLS on every table, explicit GRANTs, has_role() as SECURITY
   DEFINER, roles in a separate user_roles table, integer paise, and no column
   that could hold a plaintext PNR. */
/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
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

describe('credit cannot be minted by a passenger (rules 3-6)', () => {
  /* The wallet ledger is the only thing that makes "acceptor earns Rs 50" and
     "failed swap becomes Rs 99 credit" true. If a client can write it directly,
     any signed-in user can insert amount_paise = 99999999 and print credit. */
  const walletPolicies = [
    ...SCHEMA.matchAll(/CREATE POLICY\s+\w+\s+ON\s+public\.wallet_tx[\s\S]*?;/gi),
  ].map((m) => m[0])

  it('has no INSERT policy for the authenticated role', () => {
    const insertToClient = walletPolicies.filter(
      (p) => /\bFOR\s+INSERT\b/i.test(p) && /\bTO\s+authenticated\b/i.test(p),
    )
    expect(insertToClient, 'wallet_tx must not be client-writable').toHaveLength(0)
  })

  it('grants the client SELECT but never INSERT on the ledger', () => {
    const authGrants = [...SCHEMA.matchAll(/GRANT\s+[^;]*ON\s+TABLE\s+public\.wallet_tx\s+TO\s+authenticated;/gi)]
    expect(authGrants.length, 'expected an authenticated grant on wallet_tx').toBeGreaterThan(0)
    for (const g of authGrants) {
      expect(g[0].toUpperCase()).not.toContain('INSERT')
      expect(g[0].toUpperCase()).toContain('SELECT')
    }
  })

  it('still lets the passenger read their own wallet', () => {
    const read = walletPolicies.find((p) => /\bFOR\s+SELECT\b/i.test(p))
    expect(read, 'wallet_tx needs an owner-read policy').toBeDefined()
    expect(read).toContain('auth.uid()')
  })

  it('keeps the store ledger kinds and the SQL CHECK in step', () => {
    /* app/src/lib/store.ts WalletTx.kind must equal the column CHECK exactly.
       A drift means the local-first wallet writes rows the database rejects. */
    const sqlKinds = SCHEMA.match(
      /kind\s+text\s+NOT\s+NULL\s+CHECK\s*\(kind\s+IN\s*\(([^)]*)\)\)/i,
    )?.[1]
    expect(sqlKinds, 'wallet_tx.kind must have a CHECK').toBeDefined()
    const inSql = (sqlKinds as string)
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort()
    const store = readFileSync(join(SUPABASE, '..', 'src', 'lib', 'store.ts'), 'utf8')
    const inStore = (
      store.match(/kind:\s*((?:'[a-z_]+'\s*\|\s*)*'[a-z_]+')/)?.[1] ?? ''
    )
      .split('|')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort()
    expect(inStore).toEqual(inSql)
  })
})

describe('part 7 hardening (privacy, money, transitions, safety)', () => {
  it('never lets the client UPDATE a payment row', () => {
    expect(SCHEMA).toMatch(/DROP POLICY IF EXISTS payments_payer ON public\.payments/i)
    expect(SCHEMA).toMatch(/CREATE POLICY payments_payer_read/i)
    expect(SCHEMA).toMatch(/CREATE POLICY payments_payer_create/i)
    expect(SCHEMA).toMatch(/REVOKE UPDATE ON TABLE public\.payments FROM authenticated/i)
  })

  it('hides raw PNR hashes and berth numbers behind safe views', () => {
    expect(SCHEMA).toMatch(/DROP POLICY IF EXISTS profiles_match_read/i)
    expect(SCHEMA).toMatch(/DROP POLICY IF EXISTS bookings_match_read/i)
    expect(SCHEMA).toMatch(/DROP POLICY IF EXISTS passengers_match_read/i)
    expect(SCHEMA).toMatch(/CREATE OR REPLACE VIEW public\.match_cards WITH \(security_invoker = true\)/i)
    expect(SCHEMA).toMatch(/CREATE OR REPLACE VIEW public\.locked_berths WITH \(security_invoker = true\)/i)
    expect(SCHEMA).toMatch(/GRANT SELECT ON TABLE public\.match_cards TO authenticated/i)
    expect(SCHEMA).toMatch(/GRANT SELECT ON TABLE public\.locked_berths TO authenticated/i)
  })

  it('enforces webhook idempotency at the database', () => {
    expect(SCHEMA).toMatch(/CREATE UNIQUE INDEX.*payments_provider_ref_uidx/si)
  })

  it('constrains wallet amounts and expiry per kind (rules 3-6)', () => {
    expect(SCHEMA).toMatch(/wallet_tx_amount_check/i)
    expect(SCHEMA).toMatch(/wallet_tx_expiry_check/i)
    expect(SCHEMA).toMatch(/expires_at[\s\S]{0,80}12 months/i)
  })

  it('guards request/offer transitions with triggers (docs/03)', () => {
    expect(SCHEMA).toMatch(/check_swap_request_transition/i)
    expect(SCHEMA).toMatch(/check_swap_offer_transition/i)
    expect(SCHEMA).toMatch(/REVOKE DELETE ON TABLE public\.swap_requests FROM authenticated/i)
    expect(SCHEMA).toMatch(/REVOKE DELETE ON TABLE public\.swap_offers FROM authenticated/i)
  })

  it('keeps confirmations and chat creation parties-only', () => {
    expect(SCHEMA).toMatch(/confirmations_self_write[\s\S]{0,200}is_request_party/si)
    expect(SCHEMA).toMatch(/CREATE POLICY chats_party_create/i)
  })

  it('flags risky messages and rate-limits senders server-side', () => {
    expect(SCHEMA).toMatch(/check_message_safety/i)
    expect(SCHEMA).toMatch(/messages_safety_guard/i)
  })
})
