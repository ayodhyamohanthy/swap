/* Schema invariants (AGENTS.md tech stack + docs/02-DATA-MODEL.md).
   Reads the migration off disk and asserts the security properties that must
   never regress: RLS on every table, explicit GRANTs, has_role() as SECURITY
   DEFINER, roles in a separate user_roles table, integer paise, and no column
   that could hold a plaintext PNR. */
/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readdirSync, readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import { BERTH_TYPES, CLASSES, QUOTAS, TICKET_STATUSES } from '@/lib/pnr'
import { CONFIRM_OPTIONS } from '@/lib/outcomes'
/* `staging-lib.mjs` imports nothing (docs/11 records what `node:fs` under the
   jsdom pool costs), so its decisions are importable here — and reusing its
   comment stripper is the point: a header comment that merely *mentions* a
   column or a CREATE would otherwise read as the schema doing it. */
import {
  mirrorFindings,
  orderMigrations,
  stripSqlComments,
} from '../scripts/staging-lib.mjs'

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

  /* docs/11-COLLAB.md calls the three representations of this schema
     "byte-consistent": `schema.sql` == the concatenation of `schema.part*.sql`
     == the migration. The assertion above covers migration == schema.sql, and
     nothing covered the other half — so a part could drift from `schema.sql`
     and the suite would stay green while the schema installed differently
     depending on which file someone happened to open. That is the whole point
     of calling the invariant mandatory.

     Measured before this was added, rather than assumed: the ten parts
     concatenate to exactly `schema.sql` (58,104 characters, sha256
     `c7fe6444…`), so this pins a property that already holds instead of
     changing one. It went in green.

     Only `schema.part*.sql` is enumerated. `migrations/` is deliberately NOT
     scanned, and since 2026-10-01 that is a standing invariant rather than an
     accommodation: migration #2 (`20261001000000_get_matches.sql`) exists, and
     `SCHEMA` above is only the FIRST one. `staging-lib.mjs` gives the reason at
     length — `schema.sql` is a frozen snapshot of the released schema and
     migrations extend past it, so the invariant that stays true is "parts
     assemble to `schema.sql`, and `schema.sql` is exactly the first migration",
     not "all migrations == schema.sql". Enumerating the directory against
     `schema.sql` would report drift the moment anyone adds migration #3, which
     is a guard failing on the very workflow it exists to protect. The directory
     IS read, for the properties that hold of every file in it, in the
     `get_matches is applied as migration #2` block at the end of this file. */
  it('is byte-identical to the concatenation of its parts', () => {
    const order = (file: string): [number, string] => {
      const parts = file.match(/^schema\.part(\d+)([a-z]\d*)?\.sql$/)
      if (!parts) throw new Error(`unexpected part name: ${file}`)
      return [Number(parts[1]), parts[2] ?? '']
    }
    const files = readdirSync(SUPABASE)
      .filter((file) => /^schema\.part\d+[a-z]?\d*\.sql$/.test(file))
      .sort((a, b) => {
        const [aMajor, aMinor] = order(a)
        const [bMajor, bMinor] = order(b)
        return aMajor - bMajor || aMinor.localeCompare(bMinor)
      })
    expect(files.length, 'no schema.part*.sql files found').toBeGreaterThan(0)
    const concatenated = files
      .map((file) => readFileSync(join(SUPABASE, file), 'utf8'))
      .join('')
    expect(
      concatenated,
      `schema.part*.sql is out of step with schema.sql: ${files.join(' ')}`,
    ).toBe(SCHEMA)
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

  it('grants anon nothing on any table — the two anon grants name no table', () => {
    /* Rule 13's database half: a signed-out device must read nothing. The
       only anon grants in this schema are `EXECUTE has_role()` (needed for
       the pre-sign-in role check) and `USAGE ON SCHEMA` (needed to resolve
       names); every table ends with an explicit REVOKE. The edit these catch
       is the plausible one: "let anon read match_cards so invites work
       signed out" — which would publish every open trip to the internet. */
    const sql = stripSqlComments(SCHEMA)
    expect(sql).not.toMatch(
      /grant\s+[^;]+?\son\s+table\s+[^;]+?\bto\s+[^\n;]*\banon\b/i,
    )
    const anonLines = sql.split('\n').filter((line) => /\banon\b/i.test(line))
    expect(anonLines.length).toBeGreaterThan(0)
    for (const line of anonLines) {
      const trimmed = line.trim()
      const known =
        /^GRANT EXECUTE ON FUNCTION public\.has_role\(uuid, app_role\) TO anon, authenticated, service_role;$/i.test(
          trimmed,
        ) ||
        /^GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;$/i.test(
          trimmed,
        ) ||
        /^REVOKE ALL ON TABLE public\.\w+ FROM PUBLIC, anon;$/i.test(trimmed)
      expect(known, `unexpected anon line in schema: ${trimmed}`).toBe(true)
    }
  })

  it('issues no RLS policy TO anon', () => {
    /* Policies here carry no TO clause at all (they bind by USING/WITH CHECK
       on auth.uid()), so any `TO anon` is a widening, not a style. Checked per
       statement, not whole-file: a single-file regex would span statements and
       blame the wrong policy. */
    const sql = stripSqlComments(SCHEMA)
    const policies = [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)]
    expect(policies.length).toBeGreaterThan(0)
    for (const [statement] of policies) {
      expect(statement, 'policy grants TO anon').not.toMatch(/\bto\s+anon\b/i)
    }
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

describe('a payment cannot be forged as captured (rule 2, docs/06)', () => {
  /* The same reasoning as the wallet test above, one table over. Money only
     moves because a payment is `paid`, and `apply_request_transition` locks a
     swap when it sees one. So the question is not "can a client change a
     payment's status" — `REVOKE UPDATE` already answers that — it is "can a
     client CREATE a payment that is already paid". Revoking UPDATE does not
     help: the status is supplied at insert time, so the policy that admits the
     row is the one that has to constrain it. */
  const paymentPolicies = [
    ...SCHEMA.matchAll(/CREATE POLICY\s+\w+\s+ON\s+public\.payments[\s\S]*?;/gi),
  ].map((m) => m[0])

  it('confines every client INSERT policy to the created status', () => {
    const clientInserts = paymentPolicies.filter(
      (p) => /\bFOR\s+INSERT\b/i.test(p) && /\bTO\s+authenticated\b/i.test(p),
    )
    expect(clientInserts.length, 'expected a payer-insert policy on payments').toBeGreaterThan(0)
    for (const policy of clientInserts) {
      expect(
        policy,
        'a client may only create a payment in its initial state — a client-insertable '
          + `'paid' row is a free swap lock and mints the acceptor's credit: ${policy}`,
      ).toMatch(/status\s*=\s*'created'/i)
    }
  })

  it('never lets an authenticated client UPDATE a payment', () => {
    /* Asserted because the reasoning above depends on it, and because the two
       together are the whole guarantee. */
    expect(SCHEMA).toMatch(/REVOKE\s+UPDATE\s+ON\s+TABLE\s+public\.payments\s+FROM\s+authenticated;/i)
  })

  it('leaves the status moves to service_role, which bypasses RLS', () => {
    const grantService = [...SCHEMA.matchAll(/GRANT\s+[^;]*ON\s+TABLE\s+public\.payments\s+TO\s+service_role;/gi)]
    expect(grantService.length).toBeGreaterThan(0)
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

/* Rule 2 / the core safety property, at the layer a passenger can actually
   reach: `swap_requests` has no UPDATE policy, so every client write goes
   through the SECURITY DEFINER RPC `apply_request_transition`, which is
   GRANTed to `authenticated`. That means a passenger could lock (and then
   confirm) their own swap for free unless locking itself demands evidence of
   captured money. This was a real hole; these assertions keep it shut. */
describe('a swap can only reach locked on captured money (rule 2)', () => {
  it('has one captured-payment predicate, and it is not world-callable', () => {
    const fn = SCHEMA.match(
      /create\s+(or\s+replace\s+)?function\s+public\.has_captured_payment[\s\S]*?\$\$;/i,
    )?.[0]
    expect(fn, 'has_captured_payment() not found').toBeTruthy()
    expect(fn).toMatch(/status\s*=\s*'paid'/i)
    expect(SCHEMA).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.has_captured_payment[\s\S]{0,120}?from\s+public/i,
    )
    expect(SCHEMA).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.has_captured_payment[\s\S]{0,120}?to\s+authenticated/i,
    )
  })

  it('also accepts a captured GROUP payment, which covers member swaps', () => {
    const fn = SCHEMA.match(
      /create\s+(or\s+replace\s+)?function\s+public\.has_captured_payment[\s\S]*?\$\$;/i,
    )?.[0] ?? ''
    expect(fn).toMatch(/pay\.group_id/i)
    expect(fn).toMatch(/r\.group_id/i)
  })

  it('guards every path into locked: both RPC definitions and the trigger', () => {
    /* Two RPC definitions (the second CREATE OR REPLACE wins) plus the
       BEFORE UPDATE trigger. Missing any one reopens the hole. */
    const guards = SCHEMA.match(/payment_required_for_lock/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(3)
    expect(SCHEMA).toMatch(
      /check_swap_request_transition\(\)[\s\S]{0,900}?has_captured_payment\(OLD\.id\)/i,
    )
  })

  it('exempts only the trusted server writer, never a passenger', () => {
    /* The exemption must be scoped to service_role and the call must be
       ANDed, so an authenticated uid can never satisfy its way past it. */
    expect(SCHEMA).toMatch(
      /auth\.role\(\)\s*<>\s*'service_role'[\s\S]{0,200}?has_captured_payment\(p_req\)/i,
    )
  })

  it('still lets the gateway webhook lock, because it marks paid first', () => {
    /* The exemption exists for exactly this: the webhook updates the payment
       to paid and only then moves the request, so the guard is satisfied. */
    expect(SCHEMA).toMatch(/service_role/i)
    const payments = SCHEMA.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.payments[\s\S]*?\);/i)?.[0] ?? ''
    expect(payments).toMatch(/status\s+pay_status/i)
    expect(payments).toMatch(/group_id/i)
  })
})

/* ------------------------------------------------------------------ *
 * The other half of the drift guard. The wallet_tx.kind test above
 * checks one column; these check the nine enums and the payments
 * target, which the local-first mirror also writes.
 * ------------------------------------------------------------------ */

/** Values of a Postgres `CREATE TYPE ... AS ENUM (...)`, sorted. */
function sqlEnum(name: string): string[] {
  const body = SCHEMA.match(
    new RegExp(`CREATE TYPE ${name} AS ENUM \\(([^)]*)\\)`, 'i'),
  )?.[1]
  expect(body, `enum ${name} not found in the migration`).toBeDefined()
  return (body as string)
    .split(',')
    .map((value) => value.trim().replace(/'/g, ''))
    .sort()
}

/** Quoted members of an exported TS union type, read from source. */
function tsTypeValues(source: string, name: string): string[] {
  const decl = source.match(
    new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?=\\n\\n|\\nexport |$)`),
  )
  expect(decl, `type ${name} not found`).toBeDefined()
  return [...(decl as RegExpMatchArray)[1].matchAll(/'([A-Za-z0-9_]+)'/g)]
    .map((match) => match[1])
    .sort()
}

const SRC = join(SUPABASE, '..', 'src')
const readSrc = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')
const REQUESTS_TS = readSrc('lib/requests.ts')
const STORE_TS = readSrc('lib/store.ts')
const SERVER_FUNCTIONS_TS = readSrc('server/functions.ts')
const SERVER_PAYMENTS_TS = readSrc('server/payments.ts')

describe('every enum the client writes equals the Postgres enum', () => {
  /* A value the app can produce but the column rejects is a local-first write
     the database refuses — the failure mode the wallet_tx.kind test guards,
     for the other enums. These were all in step when this test was added; it
     is here so they stay that way. */
  const cases: Array<[string, string, () => string[]]> = [
    ['travel_class', 'CLASSES (lib/pnr.ts)', () => [...CLASSES]],
    ['berth_type', 'BERTH_TYPES (lib/pnr.ts)', () => [...BERTH_TYPES]],
    ['ticket_status', 'TICKET_STATUSES (lib/pnr.ts)', () => [...TICKET_STATUSES]],
    ['quota', 'QUOTAS (lib/pnr.ts)', () => [...QUOTAS]],
    ['outcome', 'CONFIRM_OPTIONS (lib/outcomes.ts)', () => [...CONFIRM_OPTIONS]],
    ['request_status', 'RequestStatus (lib/requests.ts)', () => tsTypeValues(REQUESTS_TS, 'RequestStatus')],
    ['offer_status', 'OfferStatus (lib/requests.ts)', () => tsTypeValues(REQUESTS_TS, 'OfferStatus')],
    /* The server re-declares both; a server-only value the app never sends is
       still drift worth catching. */
    ['request_status', 'RequestStatus (server/payments.ts)', () => tsTypeValues(SERVER_PAYMENTS_TS, 'RequestStatus')],
    ['offer_status', 'OfferStatus (server/functions.ts)', () => tsTypeValues(SERVER_FUNCTIONS_TS, 'OfferStatus')],
  ]

  for (const [enumName, label, values] of cases) {
    it(`${enumName} == ${label}`, () => {
      expect(values().sort()).toEqual(sqlEnum(enumName))
    })
  }

  it('pay_status and pay_provider == the local PaymentRow', () => {
    const row = STORE_TS.match(/export interface PaymentRow \{([\s\S]*?)\n\}/)?.[1]
    expect(row, 'PaymentRow not found in lib/store.ts').toBeDefined()
    const field = (name: string): string[] => {
      const m = (row as string).match(
        new RegExp(`${name}:\\s*((?:'[a-z_]+'\\s*\\|\\s*)*'[a-z_]+')`),
      )
      expect(m, `PaymentRow.${name} union not found`).toBeDefined()
      return (m as RegExpMatchArray)[1]
        .split('|')
        .map((v) => v.trim().replace(/'/g, ''))
        .sort()
    }
    expect(field('status')).toEqual(sqlEnum('pay_status'))
    expect(field('provider')).toEqual(sqlEnum('pay_provider'))
  })
})

describe('a payment targets exactly one of request or group (docs/01)', () => {
  const payments = SCHEMA.match(
    /CREATE TABLE IF NOT EXISTS public\.payments[\s\S]*?\n\);/i,
  )?.[0] ?? ''

  it('keeps both targets as uuid foreign keys', () => {
    expect(payments).toMatch(/request_id uuid REFERENCES public\.swap_requests/i)
    expect(payments).toMatch(/group_id uuid REFERENCES public\.group_trips/i)
  })

  it('enforces the XOR at the database, not in the app', () => {
    expect(SCHEMA).toMatch(
      /payments_target CHECK \(\s*\(request_id IS NULL\) != \(group_id IS NULL\)\s*\)/i,
    )
  })

  /* The gap this used to carry is closed. The local-first mirror now has the
     same two nullable target columns the database has, and normalisePayment()
     rewrites rows written before the fix (which put a `grp_...` group id in
     request_id) so no already-paid traveller loses their payment row. Asserted
     here, next to the constraint it mirrors, so the two cannot drift: the
     mirror is a nullable pair, and both-neither is rejected at startPayment. */
  it('mirrors the same nullable pair in the local-first PaymentRow', () => {
    const store = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'store.ts'), 'utf8')
    const row = store.match(/export interface PaymentRow \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(row).toMatch(/^\s*request_id:\s*string \| null$/m)
    expect(row).toMatch(/^\s*group_id:\s*string \| null$/m)
    expect(store).toMatch(/function normalisePayment\(/)
  })
})

/* ------------------------------------------------------------------ *
 * Why matching is server-mediated, and must stay that way.
 *
 * part 7 drops every *_match_read policy and makes match_cards
 * security_invoker, so a client SELECT on the view returns only the
 * caller's OWN rows. That is the privacy property (rule 13) working,
 * not a bug — but it means the only way to see other travellers' open
 * trips is a vetted server-side function running with elevated rights,
 * which is exactly why get_matches() is SECURITY DEFINER — applied as migration
 * #2 on 2026-10-01, asserted at the end of this file.
 * Do NOT "fix" matching by re-adding a permissive policy: that would
 * hand every client every open booking on every train.
 * ------------------------------------------------------------------ */
describe('cross-user matching is server-mediated, never a client-wide read', () => {
  it('creates each *_match_read policy and then drops it', () => {
    const created = [...SCHEMA.matchAll(/CREATE POLICY (\w*_match_read) ON public\.(\w+)/gi)]
    expect(created.length).toBeGreaterThanOrEqual(3)
    for (const match of created) {
      expect(SCHEMA, `${match[1]} is created but never dropped`).toMatch(
        new RegExp(`DROP POLICY IF EXISTS ${match[1]} ON public\\.${match[2]}`, 'i'),
      )
    }
  })

  it('leaves bookings readable only by its owner', () => {
    const owner = SCHEMA.match(
      /CREATE POLICY bookings_owner ON public\.bookings[\s\S]*?;/i,
    )?.[0]
    expect(owner, 'bookings_owner policy not found').toBeTruthy()
    expect(owner).toMatch(/user_id = auth\.uid\(\)/i)
  })

  it('keeps match_cards security_invoker so a direct SELECT stays owner-only', () => {
    expect(SCHEMA).toMatch(
      /CREATE OR REPLACE VIEW public\.match_cards WITH \(security_invoker = true\)/i,
    )
  })
})

/* ------------------------------------------------------------------ *
 * get_matches() is APPLIED as migration #2 (2026-10-01), not a proposal.
 *
 * Why this block is here at all: for three days `get_matches()` was reviewed,
 * pinned and described as "load-bearing for the core feature" while existing
 * only as a file under app/azure/load/. Nothing failed. That is the failure
 * class this file exists to prevent — an unbuilt thing described as built, and
 * a built thing described as unbuilt, both of which survive every gate because
 * the gates only read what is on disk. `tests/azure-burndown.test.ts` pins the
 * proposal to its contract note; these pin the proposal to what actually
 * applies, so the chain note → proposal → migration cannot come apart.
 * ------------------------------------------------------------------ */
describe('get_matches is applied as migration #2, not left as a proposal', () => {
  const MIGRATIONS = join(SUPABASE, 'migrations')
  const APPLIED = '20261001000000_get_matches.sql'
  const APPLIED3 = '20261006000000_create_offer.sql'
  const APPLIED4 = '20261006010000_user_rows_on_signup.sql'
  const APPLIED5 = '20261006020000_chat_guard_phone_parity.sql'
  const APPLIED6 = '20261009000000_locked_berths_party_reveal.sql'
  const APPLIED7 = '20261009010000_chat_guard_evasion_parity.sql'
  const migration = readFileSync(join(MIGRATIONS, APPLIED), 'utf8')
  const proposal = readFileSync(
    join(import.meta.dirname, '..', 'azure', 'load', 'get-matches.spec-part2.sql'),
    'utf8',
  )
  /* Comments are stripped before anything asserts on SQL, because this
     migration's header discusses berth_no, pnr_hash and quota in order to
     explain why they are absent. Reading a comment as the schema doing
     something is the same trap `staging-lib.stripSqlComments` was written for,
     and L7 hit it once already. */
  const sql = stripSqlComments(migration)
  const norm = (s: string): string => stripSqlComments(s).replace(/\s+/g, ' ').trim()

  it('exists as ordered migrations after the init one', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql'))
    const { ordered, malformed, duplicateStamps } = orderMigrations(files)
    expect(malformed).toEqual([])
    expect(duplicateStamps).toEqual([])
    expect(files.length).toBeGreaterThanOrEqual(3)
    expect(ordered[0].file, 'schema.sql must stay the FIRST migration').toBe(
      '20260925000000_init.sql',
    )
    expect(ordered[1].file, 'get_matches stays migration #2').toBe(APPLIED)
    expect(ordered[2].file, 'create_offer stays migration #3').toBe(APPLIED3)
    expect(ordered[3].file, 'signup rows stay migration #4').toBe(APPLIED4)
    expect(ordered[4].file, 'chat-guard parity stays migration #5').toBe(APPLIED5)
    expect(ordered[5].file, 'the berth reveal stays migration #6').toBe(APPLIED6)
    expect(ordered[ordered.length - 1].file, 'chat-guard evasion parity is migration #7').toBe(
      APPLIED7,
    )
  })

  it('applies the reviewed proposal rather than an edited copy of it', () => {
    /* Two defects were corrected in the proposal (p_after timestamptz → uuid,
       and a "newest-first" promise the view cannot support) and a guard pins
       it to the contract note. If the applied copy were free to differ, that
       guard would keep passing while the thing that actually runs drifted. */
    expect(norm(migration)).toContain(norm(proposal))
  })

  it('returns only the match-safe columns — this is the one elevated read (rule 13)', () => {
    /* A SECURITY DEFINER body is the one place in this schema where a read
       escapes RLS, so it is where a privacy leak would be introduced.
       `match_cards` is already narrowed to pre-payment-safe fields; the
       function must read that view and nothing else. The edit these catch is
       the plausible one: "just add berth_no, we need it for sorting". */
    expect(sql).toMatch(/SELECT \* FROM public\.match_cards/i)
    for (const forbidden of [
      'berth_no',
      'pnr_hash',
      'label',
      'email',
      'phone',
      'locked_berths',
    ]) {
      expect(sql, `${forbidden} must not reach the match RPC`).not.toMatch(
        new RegExp(forbidden, 'i'),
      )
    }
  })

  it('is unreachable to anon and granted only to the two sanctioned roles', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_matches\(text, date, travel_class, uuid, int\) FROM PUBLIC;/i,
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_matches\(text, date, travel_class, uuid, int\) TO authenticated, service_role;/i,
    )
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i)
  })

  it('pins its search_path, so a caller cannot resolve match_cards elsewhere', () => {
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public/i)
  })

  it('stays a narrowing query — scoring and the other filters stay in the app', () => {
    /* docs/08 puts the filters and the ranking in rankMatches(). Two
       implementations of the same rules is how they start to disagree. */
    for (const keptInApp of [
      'segmentsOverlap',
      'max_requests_per_day',
      'women_only',
      'quota',
      'rankMatches',
    ]) {
      expect(sql, `${keptInApp} must not be reimplemented in the database`).not.toMatch(
        new RegExp(keptInApp, 'i'),
      )
    }
    expect(sql).toMatch(/train_no = p_train/i)
    expect(sql).toMatch(/journey_date = p_date/i)
  })

  it('keeps the staging mirror green with a second migration present', () => {
    /* The invariant staging-lib enforces is "parts assemble to schema.sql, and
       schema.sql is exactly the first migration" — adding migration #2 must
       not turn that into a blocking finding, or a guard starts failing on the
       workflow it exists to protect. */
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql'))
    const migrations = orderMigrations(files).ordered.map((m) => ({
      file: m.file,
      sql: readFileSync(join(MIGRATIONS, m.file), 'utf8'),
    }))
    const { findings } = mirrorFindings({
      migrations,
      canonical: {
        file: 'schema.sql',
        sql: readFileSync(join(SUPABASE, 'schema.sql'), 'utf8'),
      },
      parts: [],
      stray: [],
    })
    const blocking = findings.filter((f) => f.blocking)
    expect(
      blocking,
      blocking.map((f) => `${f.code}: ${f.detail}`).join('; '),
    ).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * create_offer() is migration #3 (2026-10-06): the requester-side write
 * that pairs migration #2's read. swap_offers carries no requester INSERT
 * policy (only SELECT) and no RPC created an offer — so the sanctioned read
 * had no sanctioned write. Same discipline as #2: static shape guards plus
 * named open questions, because both Supabase projects are uncreated and
 * nothing here has run against Postgres.
 * ------------------------------------------------------------------ */
describe('create_offer is the sanctioned offer write, and nothing else', () => {
  const MIGRATIONS = join(SUPABASE, 'migrations')
  const migration = readFileSync(
    join(MIGRATIONS, '20261006000000_create_offer.sql'),
    'utf8',
  )
  const sql = stripSqlComments(migration)

  it('runs elevated but pinned: DEFINER with a fixed search_path', () => {
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public/i)
  })

  it('is unreachable to anon and granted only to the two sanctioned roles', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_offer\(uuid, uuid, int\) FROM PUBLIC;/i,
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_offer\(uuid, uuid, int\) TO authenticated, service_role;/i,
    )
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i)
  })

  it('only the requester sends, and only from a searching request', () => {
    expect(sql).toMatch(/v_caller uuid := auth\.uid\(\)/i)
    expect(sql).toMatch(/v_req_requester IS DISTINCT FROM v_caller/i)
    expect(sql).toMatch(/v_req_status <>\s*'searching'/i)
  })

  it('keeps the rank inside 1..3 and inside the request choices', () => {
    expect(sql).toMatch(/p_rank < 1 OR p_rank > 3/i)
    expect(sql).toMatch(/array_length\(v_req_choices, 1\)/i)
  })

  it('re-checks the acceptor the way match_cards does: CNF, open, no child, no self', () => {
    expect(sql).toMatch(/v_acc_status <>\s*'CNF'/i)
    expect(sql).toMatch(/NOT v_acc_open/i)
    expect(sql).toMatch(/v_acc_user = v_caller/i)
  })

  it('refuses dead journeys and blocked pairs', () => {
    expect(sql).toMatch(/v_acc_date < CURRENT_DATE/i)
    /* The IF EXISTS prefix matters: `FROM public.blocks` alone also matches
       a neutered `IF FALSE AND EXISTS (...)`, which is exactly the edit that
       silently re-opens spam offers. */
    expect(sql).toMatch(/IF EXISTS \(\s*SELECT 1 FROM public\.blocks/i)
  })

  it('returns the open offer instead of duplicating it (free sends, double taps)', () => {
    expect(sql).toMatch(/AND status = 'sent'/i)
    expect(sql).toMatch(/RETURN v_existing/i)
  })

  it('returns one uuid and leaks no row: inputs are uuids, rank is an int', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.create_offer\(\s*p_request uuid, p_passenger uuid, p_rank int\s*\)\s*RETURNS uuid/i,
    )
    for (const forbidden of [
      'berth_no',
      'pnr_hash',
      'label',
      'email',
      'phone',
    ]) {
      expect(sql, `${forbidden} must not reach the offer RPC`).not.toMatch(
        new RegExp(forbidden, 'i'),
      )
    }
  })
})

/* ------------------------------------------------------------------ *
 * Migration #4 (2026-10-06): the two per-user rows a sign-up must create,
 * neither of which anything created.
 *
 * WHY THIS BLOCK EXISTS. (1) `match_cards` joins `profiles` with a plain JOIN,
 * so a booking whose owner has no `profiles` row is invisible to the only path
 * cross-user matching has — `get_matches()`. Part 1's comment claimed the row
 * is "Created on first Google sign-in" and nothing implemented it: zero
 * triggers on auth.users, zero function bodies writing to profiles, and
 * seed.sql writing profiles for two hardcoded demo uuids, which is why demo
 * data never showed it. (2) `settings` has the same shape and a second symptom:
 * `server/admin.ts:155` pauses an acceptor with an UPDATE, and an UPDATE
 * matching no row affects 0 rows and returns NO ERROR, so the operator action
 * reported success and did nothing.
 *
 * Both proven by execution 2026-10-06 against PostgreSQL 18.3 — get_matches()
 * returned 0 rows without the profiles rows and 2 with them (and a second
 * fixture showed the exclusion is per row), and the pause UPDATE affected 0
 * rows, then 1 once the settings row existed.
 *
 * The guards below are deliberately split in two. The first group pins what
 * migration #4 does. The second group pins the LINK — that the view still
 * depends on the row, and that the migration did not "fix" it by loosening the
 * join. Without the second group, replacing the INNER JOIN with a LEFT JOIN
 * would make every test here pass while re-introducing the blank-name match
 * card rule 13 forbids.
 * ------------------------------------------------------------------ */
describe('a sign-up creates the per-user rows that depend on it', () => {
  const MIGRATIONS = join(SUPABASE, 'migrations')
  const migration = readFileSync(
    join(MIGRATIONS, '20261006010000_user_rows_on_signup.sql'),
    'utf8',
  )
  const sql = stripSqlComments(migration)

  it('fires on the sign-up event, which is the only one that matters', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER on_auth_user_created\s+AFTER INSERT ON auth\.users\s+FOR EACH ROW EXECUTE FUNCTION public\.handle_new_user\(\);/i,
    )
    /* BEFORE would be wrong: auth.users has a generated default id, and a
       BEFORE trigger cannot rely on NEW.id being final. */
    expect(sql).not.toMatch(/BEFORE INSERT ON auth\.users/i)
  })

  it('runs elevated but pinned, and is callable by nobody', () => {
    /* SECURITY DEFINER because the trigger fires as whoever inserted the
       auth.users row (on Supabase, supabase_auth_admin), which has no business
       holding INSERT on public.profiles. Pinned search_path for the same reason
       migrations #2 and #3 pin theirs. */
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC;/i)
    /* A trigger function needs no EXECUTE grant — it is invoked by the trigger,
       not by callers. A GRANT here would be a second, reachable entry point to
       a SECURITY DEFINER body that writes a row on someone else's behalf. */
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.handle_new_user/i)
  })

  it('cannot fail a sign-up: the conflict arm swallows instead of raising', () => {
    /* The cost of being wrong here is asymmetric. A raise inside a trigger on
       auth.users turns a duplicate into "you cannot log in"; a stale profile
       row is a cosmetic problem. So DO NOTHING, never DO UPDATE, and never a
       RAISE. */
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i)
    expect(sql).not.toMatch(/ON CONFLICT \(id\) DO UPDATE/i)
    expect(sql).not.toMatch(/\bRAISE\b/i)
  })

  it('stores first name + initial and nothing more (rule 13)', () => {
    /* The initial is derived as the FIRST LETTER of the last token, so a full
       legal name from the identity provider cannot land in the column whole. */
    expect(sql).toMatch(/upper\(left\(v_parts\[array_length\(v_parts, 1\)\], 1\)\)/i)
    expect(sql).toMatch(/INSERT INTO public\.profiles \(id, first_name, last_initial\)/i)
    /* gender is nullable and Google does not reliably supply it; inferring it
       from a name would be inventing personal data. */
    expect(sql).not.toMatch(/\bgender\b/i)
    for (const forbidden of ['email', 'phone', 'pnr', 'berth_no']) {
      expect(sql, `${forbidden} must not be stored from the provider payload`).not.toMatch(
        new RegExp(forbidden, 'i'),
      )
    }
  })

  it('reads the name from the provider payload, with a fallback', () => {
    expect(sql).toMatch(/raw_user_meta_data\s*->>\s*'full_name'/i)
    expect(sql).toMatch(/raw_user_meta_data\s*->>\s*'name'/i)
  })

  it('creates the settings row the operator pause switch needs', () => {
    /* The second symptom of the same root cause. server/admin.ts:155 pauses an
       acceptor with `updates: [{ table: 'settings', key: 'user_id', patch:
       { paused: true } }]` — a Supabase UPDATE, which affects 0 rows and
       returns NO ERROR when the row is absent. So with no settings row,
       "pause this acceptor" reported success and did nothing. Verified by
       execution: 0 rows affected, then 1 once the row existed. */
    expect(sql).toMatch(
      /INSERT INTO public\.settings \(user_id\)\s+VALUES \(new\.id\)\s+ON CONFLICT \(user_id\) DO NOTHING;/i,
    )
    /* The column list must stay exactly (user_id). Every other column carries
       its default in the table definition, and a default restated here is a
       second copy of it — free to drift from the one the table owns, which is
       the trap migration #2's header records. */
    expect(sql, 'settings defaults belong to the table, not to this trigger').not.toMatch(
      /INSERT INTO public\.settings \([^)]*,[^)]*\)/i,
    )
  })

  it('keeps the derivation in exactly one place', () => {
    /* Migration #2's own header records what happens otherwise: an earlier draft
       repeated the clamp expression in a comment, a scripted mutation rewrote
       the COMMENT instead of the statement, and the suite stayed green on a
       mutation that never touched the schema. One copy, asserted. */
    const copies = sql.match(/regexp_split_to_array/gi) ?? []
    expect(copies.length, 'the name split must appear exactly once').toBe(1)
  })

  it('fixes the invariant at its source rather than loosening the view', () => {
    /* THE LINK GUARD. `match_cards` is defined in part 7 and this migration must
       not redefine it: a LEFT JOIN would make a profile-less traveller show as a
       blank name instead of vanishing, which hides the absence this migration
       removes and violates rule 13's "first name + initial". */
    expect(sql).not.toMatch(/CREATE OR REPLACE VIEW/i)
    expect(sql).not.toMatch(/match_cards/i)

    const view = readFileSync(join(SUPABASE, 'schema.part7.sql'), 'utf8')
    const viewSql = stripSqlComments(view)
    expect(
      viewSql,
      'match_cards must keep requiring a profiles row — this migration is its writer',
    ).toMatch(/JOIN public\.profiles pr ON pr\.id = b\.user_id/i)
    expect(viewSql, 'a LEFT JOIN here would silently re-open the defect').not.toMatch(
      /LEFT JOIN public\.profiles/i,
    )
  })
})

/* ------------------------------------------------------------------ *
 * The chat guard exists twice: `lib/chat-guard.ts` on the sender's device,
 * and `check_message_safety()` in the database. The database copy is the one
 * that decides what the RECEIVER sees, because `chat-sync.ts` reads
 * `messages.flagged_risky` off the row rather than re-running the check — so a
 * row stored clean is a warning that reaches nobody.
 *
 * `chat-safety-parity.test.ts` compares the two guards' WORD LISTS, and its own
 * header is honest that it "cannot verify the regex *shapes* … and leaves shape
 * to review". Shape was never reviewed, and it had drifted: the SQL pattern
 * demanded ten CONSECUTIVE digits while the TS one allows a separator after the
 * 5th, so `98765 43210` — how an Indian mobile number is written on every form
 * and business card in the country — was flagged on the sender's device and
 * stored clean. Measured against real Postgres 18.3, eight inputs diverged in
 * that direction; seven were this shape.
 *
 * These assertions execute the SHIPPED pattern text rather than a copy of it,
 * so a rewrite is re-evaluated instead of compared against a snapshot. Running
 * it as a JS RegExp is sound for this alternative specifically because every
 * construct in it (`[6-9]`, `{4}`, `[\s-]?`, `[^0-9]`) means the same thing in
 * both dialects. The `\y` word-boundary alternatives are Postgres-only and are
 * deliberately NOT extracted here — a JS RegExp would read `\y` as a literal
 * `y` and pass vacuously, which is the trap this file keeps having to avoid.
 * ------------------------------------------------------------------ */
describe('the database chat guard flags a phone number the way it is written', () => {
  const PHONE_LINE = SCHEMA.split('\n').find(
    (line) => line.includes('NEW.text ~*') && line.includes('[6-9][0-9]{4}'),
  )
  const source = PHONE_LINE?.match(/~\*\s*'([^']+)'/)?.[1] ?? ''
  const PHONE = new RegExp(source, 'i')

  it('extracts a phone alternative from the shipped schema', () => {
    expect(PHONE_LINE, 'no phone alternative found in the schema').toBeTruthy()
    expect(source.length, 'the phone alternative looks empty').toBeGreaterThan(20)
  })

  it('allows a separator between the 5th and 6th digit, as the TS guard does', () => {
    expect(source).toContain('[6-9][0-9]{4}[\\s-]?[0-9]{5}')
    /* The old shape, named so it cannot come back: ten consecutive digits is
       exactly what let `98765 43210` through. */
    expect(source).not.toContain('[6-9][0-9]{9}')
  })

  const flagged = [
    '9876543210',
    '98765 43210',
    '98765-43210',
    '+919876543210',
    '+91 9876543210',
    '+91 98765 43210',
    '0 98765 43210',
    '91 98765 43210',
  ]
  for (const text of flagged) {
    it(`flags ${JSON.stringify(text)}`, () => {
      expect(PHONE.test(text), `${text} must be flagged`).toBe(true)
    })
  }

  const clean = [
    'What time is your train?',
    'I am on coach B1, see you there',
    'Train 12951 on 2026-12-01, berth 41',
    'Reaching by 6',
    'My PNR is 1234567890',
    'A2 · 36',
  ]
  for (const text of clean) {
    it(`leaves ${JSON.stringify(text)} alone`, () => {
      expect(PHONE.test(text), `${text} must not be flagged`).toBe(false)
    })
  }

  it('over-flags a ten-digit PNR starting 6-9, and that is parity, not a bug', () => {
    /* Named so nobody "fixes" it on one side only. The TS pattern is a bare
       substring match with no boundaries, so it flags this too — the database
       copy has to be at least as strict as the TS one, and being stricter in a
       way that merely hides a message is the safe direction. */
    expect(PHONE.test('My PNR is 6234567890')).toBe(true)
  })

  it('keeps the newest guard migration identical to the baseline copy it replaces', () => {
    /* Migrations #2-#4 each ADDED an object, so the baseline (`schema.part*` →
       `schema.sql` → `init.sql`, one schema kept byte-identical three ways)
       could stay frozen at the init state and the migration was the whole
       story. This one MODIFIES an object init already defines, which changes
       the answer: `chat-safety-parity.test.ts` reads the BASELINE to assert the
       guard, so a migration-only fix would leave that test green while it read
       a superseded copy of the function — a test guarding something that is not
       what runs. Both are therefore updated, and this pins them together:
       change one and this fails until you change the other. */
    const extract = (text: string): string => {
      const clean = stripSqlComments(text)
      const start = clean.indexOf('CREATE OR REPLACE FUNCTION public.check_message_safety()')
      const end = clean.indexOf('END $$;', start)
      expect(start, 'the guard function must exist').toBeGreaterThanOrEqual(0)
      expect(end, 'the guard function must terminate').toBeGreaterThan(start)
      return clean.slice(start, end + 'END $$;'.length)
    }
    const baseline = extract(SCHEMA)
    /* Walk to the NEWEST migration carrying the guard instead of naming one:
       migration #7 changes the same function again, and a hard-coded path would
       quietly start comparing the baseline against a superseded copy — which is
       the exact failure this test exists to prevent. */
    const MIGRATIONS_DIR = join(SUPABASE, 'migrations')
    const GUARD = 'CREATE OR REPLACE FUNCTION public.check_message_safety()'
    const carriers = orderMigrations(
      readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')),
    )
      .ordered.map((m) => m.file)
      .filter((file) =>
        readFileSync(join(MIGRATIONS_DIR, file), 'utf8').includes(GUARD),
      )
    expect(carriers.length, 'a migration must carry the guard').toBeGreaterThan(0)
    const applied = extract(
      readFileSync(join(MIGRATIONS_DIR, carriers[carriers.length - 1]), 'utf8'),
    )
    expect(baseline.length, 'the extracted body looks too short to be the guard').toBeGreaterThan(
      300,
    )
    expect(applied, 'the migration must carry the same body as the baseline').toBe(baseline)
  })
})

/* ------------------------------------------------------------------ *
 * rule 13's exact-berth reveal — `locked_berths` (migration #6)
 *
 * The view shipped as a bare `security_invoker` view over `passengers`. Part 7
 * drops `passengers_match_read`, which leaves `passengers_owner` as the
 * caller's only surviving policy, so a `security_invoker` view returned each
 * party their OWN berth and dropped the peer in the join. Executed against
 * PostgreSQL 18.3: A saw {41}, B saw {52}, a stranger saw {} — the reveal was a
 * no-op for the only two people it exists for, and every guard in this file
 * passed while it was. These guards pin the SHAPE of the fix, because the shape
 * is what was wrong: only a SECURITY DEFINER body can raise its own rights, and
 * the tempting fix — re-add a broad `passengers` policy — would hand berth
 * numbers to every signed-in user, which is the leak rule 13 exists to stop.
 * ------------------------------------------------------------------ */
describe('locked_berths reveals both berths to the two parties, and nothing to anyone else', () => {
  const APPLIED6 = '20261009000000_locked_berths_party_reveal.sql'
  const migration = readFileSync(join(SUPABASE, 'migrations', APPLIED6), 'utf8')
  const sql = stripSqlComments(migration)

  /** The view statement alone, so no guard can be satisfied by the function. */
  const viewStmt = (text: string): string => {
    const clean = stripSqlComments(text)
    const start = clean.indexOf('CREATE OR REPLACE VIEW public.locked_berths')
    expect(start, 'the view must exist').toBeGreaterThanOrEqual(0)
    const end = clean.indexOf(';', start)
    expect(end, 'the view statement must terminate').toBeGreaterThan(start)
    return clean.slice(start, end + 1)
  }

  it('makes the view a thin wrapper, not a join that reads passengers as the caller', () => {
    const view = viewStmt(SCHEMA)
    expect(view).toMatch(/SELECT \* FROM public\.get_locked_berths\(\)/i)
    /* The join is the bug. If it returns to the view, the peer row is filtered
       by the caller's own RLS again and the reveal silently dies — the exact
       regression that would look correct in review. */
    expect(view, 'the view must not join passengers itself').not.toMatch(/JOIN/i)
    expect(view, 'the view must not read a base table itself').not.toMatch(/FROM public\.swap_/i)
    expect(view).toMatch(/WITH \(security_invoker = true\)/i)
  })

  it('does the reveal in a SECURITY DEFINER body that checks party membership itself', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_locked_berths\(\)/i)
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public/i)
    expect(sql).toMatch(/is_request_party\(r\.id, auth\.uid\(\)\)/i)
    /* Both bookings, or the peer is dropped and the reveal is a no-op again —
       this OR is the half of the fix that returns the OTHER person's berth. */
    expect(sql).toMatch(
      /p\.booking_id = r\.booking_id OR p\.booking_id = o\.acceptor_booking_id/i,
    )
    /* And only after payment. Dropping this filter would reveal berth numbers
       for requests that are still merely 'searching', which rule 13 forbids. */
    expect(sql).toMatch(/r\.status IN \('locked', 'confirmed', 'disputed'\)/i)
  })

  it('is unreachable to anon and granted only to the two sanctioned roles', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_locked_berths\(\) FROM PUBLIC;/i)
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_locked_berths\(\) TO authenticated, service_role;/i,
    )
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/i)
  })

  it('projects only coach and berth_no — nothing else from passengers', () => {
    /* This is the second elevated read in the schema, so it is the second place
       a privacy leak could be introduced. Rule 13 allows exactly these two
       berth fields after payment; everything else on `passengers` stays out. */
    for (const forbidden of [
      'pnr_hash',
      'label',
      'email',
      'phone',
      'quota',
      'is_child_no_berth',
      'berth_type',
      'board_code',
      'drop_code',
    ]) {
      expect(sql, `${forbidden} must not reach the reveal`).not.toMatch(new RegExp(forbidden, 'i'))
    }
    expect(sql).toMatch(/coach text, berth_no text/i)
  })

  it('keeps the migration byte-identical to the baseline block', () => {
    /* The anti-drift guard migration #5 also carries: `schema.sql` is what this
       file reads as "the schema", so a fixed function there plus a drifted
       migration would read as fixed while the thing that actually runs is not.
       Change one and this fails until you change the other. */
    const TAIL = 'GRANT SELECT ON TABLE public.locked_berths TO authenticated;'
    const extract = (text: string): string => {
      const clean = stripSqlComments(text)
      const start = clean.indexOf('CREATE OR REPLACE FUNCTION public.get_locked_berths()')
      const end = clean.indexOf(TAIL, start)
      expect(start, 'the reveal function must exist').toBeGreaterThanOrEqual(0)
      expect(end, 'the reveal block must terminate').toBeGreaterThan(start)
      return clean.slice(start, end + TAIL.length)
    }
    const baseline = extract(SCHEMA)
    const applied = extract(migration)
    expect(baseline.length, 'the extracted block looks too short to be the reveal').toBeGreaterThan(
      300,
    )
    expect(applied, 'the migration must carry the same block as the baseline').toBe(baseline)
  })
})
