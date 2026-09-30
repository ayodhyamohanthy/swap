# 18 — Azure Postgres migration plan

**STATUS: PROPOSAL — NOT AUTHORISED. No code may be written from this
document until the amendment in §1 is applied by Ayu.**

Written at Ayu's request (`build . lets use azure over supabase`, answer:
"Azure Postgres for prod"). Every number below was measured on
`4bc13ea`, not estimated.

---

## §1 The gate: the amendment must land first

`agents.md` currently says, verbatim:

> - STACK IS FIXED: TanStack Start + React 19 + Vite + Tailwind v4,
>   Supabase (DB/auth/realtime), Cloudflare (hosting/cron/queues/R2).
>   **Never swap, never add a database, never "migrate to" anything.**
> - NEVER build persistent infrastructure on expiring credits (docs/12 §0).

`docs/12` §1 is titled **"Fixed stack (agents may not change this)"** and
§7 ends **"Nothing persistent, ever… Milestone unlocks change the ledger,
never the stack."**

`agents.md` §0 makes changing a non-negotiable rule a **must-ask** item.
So the amendment is not a formality to route around — it is the
precondition. Four edits are required, and they are the largest rule
change in this repo's history:

| File | Line today | Becomes |
|---|---|---|
| `agents.md` | `STACK IS FIXED: … Supabase (DB/auth/realtime) … Never swap, never add a database, never "migrate to" anything.` | name Azure Postgres as the production DB; keep "never add a *second* database" |
| `docs/12` §1 | `Data: Supabase Postgres + Auth (Google) + RLS + Realtime.` | `Data: Azure Database for PostgreSQL Flexible Server + Auth (Google, Worker-side OAuth) + RLS + polling.` |
| `docs/12` §2 | Azure row: status `RESERVE`, Never-for **"anything persistent"** | status `WIRED`; Never-for becomes the narrow list that still applies |
| `docs/12` §7 | `Nothing persistent, ever.` | the resource-group/expiry discipline stays; the blanket ban is scoped |

**§0 (the prime directive) is the one I would not rewrite.** It reads:

> NEVER build persistent infrastructure on expiring credits… Credit
> expiry must only ever degrade us to "free tier," never to "broken."

Putting production data on a credit that expires **2027-06-14** is in
direct tension with that sentence. It can be reconciled, but only by
naming the reverse migration in writing — §6 does that — not by deleting
the sentence.

**The smaller alternative, stated because it costs nothing:** `docs/17`
§W1-alt already documents this exact migration as a *parked fallback*
with an explicit trigger, and line 231 records it as "PARKED until a
Free-tier limit is actually hit (needs 🔑)". Taking that path requires
**no amendment at all**, because Supabase stays the production stack and
Azure stays the documented exit. If the goal is "we have a real Azure
path", that already exists. If the goal is "production runs on Azure",
that is §1's four edits.

---

## §2 What is actually coupled (measured, not assumed)

| Surface | Size | Where |
|---|---|---|
| `getSupabase()` call sites | **43**, in 11 files | `server/functions.ts` 8, `server/jobs.ts` 7, `lib/session.ts` 6, `lib/chat-sync.ts` 5, `lib/safety.ts` 4, `server/webhooks.ts` 3, `lib/push.ts` 3, `server/payments.ts` 2, `server/admin.ts` 2, `routes/chat.$id.tsx` 2, `lib/supabase.ts` 1 |
| PostgREST queries (`.from(`) | **37** | inside the above |
| **Supabase auth calls** | **10, in 5 files** | `.auth.getUser()` ×6 (`session.ts:98`, `push.ts:106`, `push.ts:124`, `chat.$id.tsx:109`, `server/admin.ts:29`, `server/functions.ts:290`), `.auth.signInWithOAuth()` `session.ts:158`, `.auth.signOut()` `session.ts:170`, `.auth.getSession()` `session.ts:180`, `.auth.onAuthStateChange()` `session.ts:197` |
| `.rpc(` calls | **0** | — |
| Realtime usage | **0** | no `.channel(`, no `.subscribe(`, no `postgres_changes` anywhere in `app/src` |
| Storage usage | **0** | no `.storage.from(` anywhere in `app/src` |
| `schema.sql` | **58,830 bytes** | 43 `CREATE POLICY`, 69 `auth.uid(` occurrences (53 lines), **4 `auth.role()`**, 10 `SECURITY DEFINER` functions, 7 `CREATE TRIGGER` |
| `CREATE ROLE` / `CREATE SCHEMA` / `CREATE EXTENSION` | **0 / 0 / 0** | see §3 |
| `DEFAULT` function calls | 40 — `now()` ×25, `gen_random_uuid()` ×15 | no `uuid_generate_v4()`, so no `uuid-ossp` |

**The auth surface is 10 call sites, and 5 of them are in one file.**
That is the single most important number here: `lib/session.ts` is the
chokepoint, and the migration is mostly a *data* job, not an auth job.

---

## §3 The one idea that changes the size of the job

`schema.sql` contains **zero role DDL, zero schema DDL and zero extension
DDL**. It assumes Supabase has already provisioned the `auth` schema and
the three roles `anon` / `authenticated` / `service_role` — and it relies
on exactly two functions from that schema, `auth.uid()` (69 uses) and
`auth.role()` (4 uses).

That means **all 43 RLS policies port byte-identically** if we supply
those two functions and those three roles ourselves. We do not rewrite
43 policies of security logic by hand — which is precisely where an
authorisation bypass would be introduced.

`app/azure/sql/00-compat.sql` (new file, applied **before** the
migration):

```sql
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
    THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
```

The two-source `coalesce` matches what PostgREST/Supabase do, so a token
issued by either path resolves the same way.

Then the API layer sets identity **inside the same transaction as the
query**:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',  $uid, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
  -- … the query …
COMMIT;
```

`set_config(name, value, true)` is the parameterised form of `SET LOCAL`.
That detail matters: `SET LOCAL x = $1` does **not** accept a bind
parameter in the extended query protocol, so the naive spelling fails at
runtime with a syntax error. This is the difference between this being
implementable and being a day of debugging.

`jobs.ts` needs no special case: its 7 service-role sites become
`SET LOCAL ROLE service_role`, which carries `BYPASSRLS`.

**The shim must live in `app/azure/sql/`, never in `schema.sql` or the
parts.** `tests/schema.test.ts` enforces that `schema.sql` == the
concatenation of `schema.part*.sql` == `migrations/20260925000000_init.sql`,
byte for byte. The shim is Azure-only and would break that invariant —
and it would also make the schema un-installable on Supabase, which is
the reverse migration in §6.

---

## §4 Workstreams

**A1 — Data access (the bulk).** 37 PostgREST queries become SQL behind
the API layer. The repo already mandates this shape: *"Data access goes
through the query layer in `app/src/lib/` — never scatter raw `supabase.`
calls in components."* That rule is what makes this a driver change
rather than an app rewrite, and `lib/supabase.ts` is the single
chokepoint to replace. 22 sites are server-side (`functions` 8, `jobs` 7,
`webhooks` 3, `payments` 2, `admin` 2); 21 are client-side (`session` 6,
`chat-sync` 5, `safety` 4, `push` 3, `chat.$id` 2, `supabase` 1).

**A2 — Auth (10 call sites).** Replace `lib/session.ts`'s five
`client.auth.*` calls with a Worker-side Google OAuth flow and a
session in KV (this is `docs/17` §W1-alt's own proposal). The six
`.auth.getUser()` sites collapse into one `getSessionUser()`. The one
genuinely new piece of client plumbing is an equivalent of
`onAuthStateChange`.

*Provider choice:* **Worker-side Google OAuth, self-issued session JWT.**
It adds **no vendor**, so `docs/12` §2 needs no new row, and it preserves
`agents.md` rule 8 (Google-only sign-in) and rule 15 (no SMS/OTP) by
construction. Entra External ID is the alternative and would federate
Google, but it is a new vendor needing a ledger row and WIRED status, and
it makes rule 8 a federation setting rather than an implementation fact.

**A3 — API layer.** Stand in for PostgREST: one endpoint shape over
`app/src/server/*`, with the §3 transaction wrapper as its only
privileged path.

**A4 — Backups and exit.** `docs/12` §5's nightly `pg_dump` → R2 workflow
already targets a **different vendor from the database**, which is
exactly what `docs/16`'s "Never store backups only inside the same vendor
being backed up" requires. It survives the migration with its secret
renamed. The `.github/workflows/seatswap-backup.yml` file named in
`docs/12` §5 and `docs/16` does not exist yet — `.github/workflows/`
currently holds only `green.yml` — so this is unfinished work either way.

---

## §5 The named risk

**The load-bearing assumption is that the identity GUC and the query run
in one explicit transaction.** If the HTTP layer issues each statement as
its own implicit transaction, `SET LOCAL` evaporates before the query
runs, `auth.uid()` returns null, and **every RLS policy silently denies**
— fail-closed, so it breaks loudly rather than leaking. The dangerous
inverse is a pooler that hands the transaction to a connection which
already carries a *previous* request's `service_role` setting; that is
fail-open and would need `RESET ALL` on checkout.

**Spike before any of §4 is built:** through Cloudflare Hyperdrive (or
whatever pooler we pick), assert three things — (1) `auth.uid()` inside
the transaction returns the caller's id, (2) it returns null outside it,
(3) two concurrent requests with different identities never observe each
other's role. If (3) fails, the fallback is a direct connection or a
transaction-mode pooler, not a rewrite of the 43 policies.

---

## §6 Cost, and the exit that §0 requires

- Smallest burstable Azure Postgres Flexible Server ≈ **$15–30/mo**
  (`docs/17` §W1-alt's own figure), so the **$5,000** base tranche
  (exp **2027-06-14**) covers years of it. Milestone-unlocked credits are
  **not guaranteed** and must not be planned against.
- **This is a separate subscription from the $200 student credit**
  (exp Dec 16 2026), which `app/azure/README.md` scopes to ephemeral
  one-shot jobs with a delete-by-Dec-10 rule. The two must not be
  confused, and `docs/12` §7's example RG name `seatswap-exp-dec16`
  refers to the student one.
- §0 requires that expiry degrades us to **"free tier," never to
  "broken."** On Azure that means the deployment must stay
  **continuously re-importable into Supabase free tier**: no
  Azure-proprietary features, the `auth` shim isolated in
  `app/azure/sql/` (§3), and the R2 dumps verified to restore. The
  reverse migration is `docs/16`'s four steps run backwards, and it is
  the only thing that makes §0 survivable.
- `docs/17` requires a **🔑 human step**: a budget with alerts at
  50/80/100% on the resource group before any resource is created.
- Spend guards: nothing here creates a resource. Every script under
  `app/azure/` is dry-run safe and refuses network by construction.

---

## §7 What we do **not** have to build

`docs/17` §W1-alt's "what must be rebuilt" list over-states the job.
Measured:

- **"Storage → R2"** — there is **no Storage usage** in `app/src` (0
  `.storage.from(`). Nothing to migrate.
- **"Realtime → 10s polling"** — there is **no Realtime usage** in
  `app/src` (0 `.channel(`, 0 `.subscribe(`). Nothing to migrate.
- **"The schema is standard Postgres — tables/constraints port as-is"** —
  true, and stronger than stated: **no `CREATE EXTENSION` anywhere.** The
  40 function defaults are `now()` (×25) and `gen_random_uuid()` (×15);
  `gen_random_uuid()` has been PostgreSQL **core since 13** and needs no
  `pgcrypto`, and `uuid_generate_v4()` (which *would* need `uuid-ossp`)
  is not used at all. Every Azure Flexible Server version is ≥13, so
  there is no extension to install.
- **RLS-as-auth becoming "Worker-enforced authorization"** — not
  necessary. §3 keeps RLS and ports all 43 policies unchanged. Doing it
  the other way means re-deriving 43 policies of security logic in
  TypeScript, which is a strictly larger and strictly riskier job.

---

## §8 Recommendation

1. **Apply §1's amendment, or take the smaller alternative.** Do not
   build anything until one of the two is chosen; `agents.md` §0 is
   unambiguous that this is Ayu's call, not an agent's.
2. **If the answer is "migrate", build §3's shim and run §5's spike
   first.** The spike is cheap and it decides whether the 43 policies
   port unchanged or whether this becomes a rewrite. Everything else
   depends on its result.
3. **Keep `docs/12` §0 unamended.** Name the reverse migration instead.

## §9 Ledger rows this plan would require (for Ayu to write)

- `docs/12` §1 Data line — Azure Postgres replaces Supabase as prod DB.
- `docs/12` §2 Azure row — `RESERVE` → `WIRED`; "Never for" narrowed.
- `docs/12` §2 — a new row if a new auth vendor is chosen (Entra
  External ID). **Not needed** under the §4-A2 recommendation.
- `docs/12` §7 — "Nothing persistent, ever" scoped to the student credit.
- `docs/12` §8 — `AZURE_DB_URL` (worker secret), `AZURE_DB_URL` for GH
  Actions (backups), and the OAuth/JWT signing key.
- `docs/12` §2.1 — the 2027-06-14 row's action changes from "run any
  planned batch/DR drills" to "reverse migration drill", because after
  the migration that date is a production continuity risk, not a
  housekeeping date.
