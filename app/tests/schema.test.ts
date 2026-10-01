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

  it('exists as a second migration, ordered after the init one', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql'))
    const { ordered, malformed, duplicateStamps } = orderMigrations(files)
    expect(malformed).toEqual([])
    expect(duplicateStamps).toEqual([])
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(ordered[0].file, 'schema.sql must stay the FIRST migration').toBe(
      '20260925000000_init.sql',
    )
    expect(ordered[ordered.length - 1].file).toBe(APPLIED)
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
