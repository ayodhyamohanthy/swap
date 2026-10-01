# 12 — Infrastructure & Credits Ledger

## §0 Prime directive
NEVER build persistent infrastructure on expiring credits. Build on
generous free tiers, keep data portable, hold expiring credits as burst
capacity and insurance. Credit expiry must only ever degrade us to
"free tier," never to "broken."

## §1 Fixed stack (agents may not change this)
- Web: TanStack Start + React 19 + Vite 7 + Tailwind v4, PWA via
  vite-plugin-pwa. Mobile-first (contract: docs/17-MOBILE-FIRST.md);
  TWA for Play Store later.
- Data: Supabase Postgres + Auth (Google) + RLS + Realtime.
- Edge: Cloudflare Workers Static Assets, Cron Triggers, Queues, R2.
- Payments: Razorpay primary, domestic AND international. PayPal is an
  explicit fallback for international payers. (Amended 2026-10-02 by Ayu —
  §1 previously read "Razorpay (domestic), PayPal (international)", which
  contradicted §2's ledger row and the Razorpay-primary build-plan item.)
- Email: Zoho ZeptoMail (transactional only).
- Observability: PostHog (analytics + flags), Sentry (errors).
- Backups: GitHub Actions nightly pg_dump → R2 (docs/16). NOT a
  Cloudflare Worker — Workers cannot execute the pg_dump binary.
- CI: GitHub Actions. Repo must keep CI green in the cloud, not just
  on laptops.

## §2 Vendor ledger
Status meanings — WIRED: SDK/API allowed in code. RESERVE: claimed,
activation requires Ayu moving the row to WIRED. BENCH: account exists,
fallback only, no SDK. UNCLAIMED: do not claim without a need.

| Vendor      | Credit / plan              | Job (this app)              | Status    | Never for                    |
|-------------|----------------------------|-----------------------------|-----------|------------------------------|
| Cloudflare  | $10,000                    | hosting, cron, queues, R2   | WIRED     | databases (no D1 rewrite)    |
| Supabase    | free ×2 (prod + staging); Startup 6mo Pro unclaimed | DB, auth, realtime, storage | WIRED | public-asset CDN |
| PostHog     | skipwait $50k + 1M ev/mo free | analytics + feature flags | WIRED     | error tracking               |
| Sentry      | skipwait $5k + Student Pack 50k err/mo | errors (web + worker) | WIRED | analytics                    |
| Zoho        | $2,200 wallet, exp 2027-06-11 | ZeptoMail, Desk, Analytics | WIRED    | app runtime/backend          |
| Razorpay    | standard; domestic + international | payments PRIMARY (both) | WIRED    | —                            |
| PayPal      | standard                   | international fallback      | WIRED     | new flows (default Razorpay) |
| Azure       | $5,000 exp 2027-06-14; unlocks to $150k on milestones (NOT guaranteed) | one-shot batch in disposable RGs; DR landing zone | RESERVE | anything persistent |
| Chargebee   | free to $1M revenue        | subscriptions / credit packs| RESERVE   | one-off swap charges         |
| Customer.io | startup program            | lifecycle campaigns         | RESERVE   | transactional email          |
| Mixpanel    | live project, no SDK       | analytics fallback          | BENCH     | —                            |
| Statsig     | account only               | flags fallback              | BENCH     | —                            |
| Datadog     | svc acct "mayodhya" (us5)  | infra APM if ever on Azure  | BENCH     | client-side PWA              |
| New Relic   | via student pack           | —                           | UNCLAIMED | —                            |
| Student Pack| domain (Namecheap/Name.com), Copilot Pro, DO $200, Azure $100 | domain → Cloudflare DNS | PARTIAL | persistent infra on DO/Azure |

## §2.1 Expiry calendar (review monthly; alerts 90 days before each)
| Date       | What expires                    | Action before expiry                       |
|------------|---------------------------------|--------------------------------------------|
| 2027-06-11 | Zoho $2,200 wallet              | spend down on Desk/Analytics if surplus    |
| 2027-06-14 | Azure $5,000 (base tranche)     | run any planned batch/DR drills before this|
| rolling    | Student Pack per-offer expiries | claim domain NOW (first-come)              |
Milestone-unlocked Azure credits ($150k program) arrive with their own
expiry windows — record each unlock here as a new row when it lands.

## §3 One job, one tool
Analytics = PostHog. Errors = Sentry. Email = ZeptoMail. Exactly one
SDK per job ships in the client bundle. Overlapping vendors sit on the
bench, not in package.json.

## §4 Environments
- seatswap-prod (Supabase) + seatswap-web-prod (CF Worker)
- seatswap-staging (Supabase, 2nd free project) + seatswap-web-staging
- Agents develop against staging. Prod credentials never appear in CI
  logs or .env files committed to git.

"Develop against staging" is enforced, not merely stated: `collab-check`
refuses a tracked file whose Supabase URL is not the staging ref recorded
below, and `resolveSupabaseTarget` refuses prod unless it is an explicit
opt-in. The host in a Supabase URL is the project REF (a random slug) and
never the project name, so this table is the only place a ref can be tied
to an environment — record it the moment the project exists. Until then
every `*.supabase.co` literal in tracked source is "unknown" and refused,
which is the correct answer while neither project has been created.

| Env     | Supabase project | Project ref (URL host) | Created |
|---------|------------------|------------------------|---------|
| staging | seatswap-staging | — none yet             | TODO (Ayu) |
| prod    | seatswap-prod    | — none yet             | TODO (Ayu) |

Provisioning staging is one command for the human step and fully checked
around it: `node app/scripts/staging-dry-run.mjs`. It is $0 and has no
`fetch` at all — `tests/staging-lib.test.ts` runs it under
`app/azure/no-net.mjs` and asserts zero recorded calls — and it verifies
the migrations still mirror `schema.sql` before printing the create call,
the ordered `psql` apply, and where to record the ref. Do NOT use
`supabase db push` from the repo root: the CLI resolves `supabase/` from
the project root, and the root's holds one stale file and no `migrations/`,
so it would provision an empty database.

## §4.1 Domain & DNS
The app serves from `https://seatswap.ayodhya-711.workers.dev/`. The custom
domain below is the one build-plan item 4 wires — and **docs/10 lists that name
under "Placeholders to replace"**, so it is expected to change. That is the
reason it is recorded here once instead of in every file that needs it: a name
scheduled for replacement, written down all over this repo with nothing checking
the copies agree, drifts silently on the day it is swapped, and a `zone_name`
that disagrees with the zone Cloudflare actually holds fails `wrangler deploy`
at the worst moment.

The two path tables below ARE the count, and that is deliberate: recording the
name here and in `docs/DECISIONS.md` added two more files holding it, so any
number written into this paragraph is already behind by the time it is written.
A count in prose cannot be checked; the dry run scans the tree and fails on a
file that is in neither table, so the number is measured on every run instead.

This section is the only source of truth. `scripts/domain-lib.mjs` parses it and
`node app/scripts/domain-dry-run.mjs` measures the world against it.

| Key | Value |
|-----|-------|
| domain | toyoufromme.website |
| status | placeholder |
| dns-ttl | 300 |
| zone-must-be-on | cloudflare |
| serving-now | seatswap.ayodhya-711.workers.dev |

Required records once the zone is on Cloudflare. TTL is `dns-ttl` above —
300s, per docs/16-EXIT-PLAYBOOK, so a cutover or an exit propagates in minutes
rather than a day. Node's resolver does not expose TTL, so the dry run reads it
from `dig +noall +answer` when `dig` exists and reports TTL as *unverified*
rather than guessing when it does not.

| Record | Type | Value |
|--------|------|-------|
| toyoufromme.website | A / AAAA | proxied to the worker (Cloudflare orange cloud) |
| www.toyoufromme.website | CNAME | toyoufromme.website |

Every tracked path that names the domain, so a swap is checked everywhere it
was written. `config` files are held to the exact value (they are what a
machine reads); `doc` files are only required to still mention it (prose
describes, it does not configure).

| Path | Kind |
|------|------|
| CNAME | config |
| app/wrangler.toml | config |
| app/azure/README.md | doc |
| app/tests/qa-placeholders.test.ts | doc |
| docs/10-BUILD-PLAN.md | doc |
| docs/16-BEST-PRACTICES.md | doc |
| docs/17-PRODUCTION-PATH.md | doc |

Four tracked files name the domain and are deliberately NOT in that table. This
is a table and not prose because the dry run reads it: it scans the whole repo
for the name and fails on any file that appears in NEITHER list, so an
incomplete ledger is a red run rather than a quiet gap. A path excluded here is
a promise that the name in it is allowed to go stale.

| Excluded path | Why |
|---------------|-----|
| docs/12-INFRA-CREDITS.md | this ledger — it is the source of the value, not a copy of it |
| docs/DECISIONS.md | append-only log — prior lines are never edited, so a name recorded there stays as it was written |
| .workbuddy-ai/memory/2026-09-29.md | dated measurement log — it records what DNS and GitHub Pages said that day, and rewriting it would falsify the record rather than update a config |
| lovable build/seatswap-build-pack/docs/10-BUILD-PLAN.md | vendored copy of the handoff build pack; nothing reads it |

`app/tests/qa-placeholders.test.ts` is in the table for the opposite reason from
everything else in it: it asserts the domain is ABSENT from `app/src/**` and
from the locale catalogs, so nothing bakes a planned hostname into the client
bundle. Listing it here says that file must be edited when the domain changes —
and it must, because its check is a hardcoded `/toyoufromme/i` regex. Swap the
name in this table and that test keeps passing while checking nothing: the new
domain would be absent from the bundle because it is nowhere in the source at
all, not because the guard held. That is a request, not a fix this lane can
make: the file is not in docs/13's ownership map at all (added by commit
`72628db`, whose entire message is the character `0`), so no lane is obliged to
act on it, which is the same "dead surface" class `collab-check`'s Check 9 was
just written to catch.

**The gate, re-measured rather than trusted.** `dig NS toyoufromme.website`
returned `dns1.registrar-servers.com` / `dns2.registrar-servers.com` at
2026-10-01T13:40Z — still NameCheap's defaults, so the zone is NOT on
Cloudflare and the `routes` line in `app/wrangler.toml` cannot be attached
("zone not found"). This confirms L1's 2026-09-29 measurement rather than
assuming it still holds; move the zone's nameservers to Cloudflare and re-run
the dry run, which is the thing that tells you the deploy is now possible.
Until then the workers.dev URL above is the live app and `wrangler deploy`
must not gain an uncommented `routes`.

Two consequences worth recording next to the facts:

- **The root `CNAME` is inert.** Only GitHub Pages reads it, and that site was
  deleted on 2026-09-29 (see the comment in `app/wrangler.toml`). It is kept
  because it is the domain's one other machine-readable record and because
  deleting it is a decision about whether Pages ever returns — not a cleanup an
  agent should make silently. It also appears in no lane's ownership map
  (docs/13), so nothing guards it.
- **Item 3's alert sender depends on this item.** The backup workflow alerts
  from `alerts@seatswap.invalid`, a placeholder that can never verify because
  `.invalid` is reserved. ZeptoMail rejects an unverified sending domain, so
  the real sender is `alerts@<domain>` for whichever domain Ayu settles on —
  which means the nightly backup's failure alert stays undeliverable until this
  item closes, and GitHub's own workflow-failure notification is the only
  backstop.

## §5 Backups & exit
Nightly GitHub Actions workflow `seatswap-backup-prod`
(.github/workflows/seatswap-backup.yml, cron 22:00 UTC = 03:30 IST)
runs pg_dump of seatswap-prod → gzip → R2 bucket seatswap-backups-prod
via the S3 API. 30-day retention via R2 lifecycle rule. ZeptoMail alert
on failure. Restore drill and full vendor-exit steps:
docs/16-EXIT-PLAYBOOK.md. Max acceptable data loss: 24h.

## §6 Chargebee activation trigger
Activate ONLY when a recurring plan or credit-pack SKU exists. It sits
on top of Razorpay/PayPal as gateways — nothing gets ripped out.

## §7 Azure discipline
Resource groups named <app>-<purpose>-<expiry> (e.g. seatswap-exp-dec16),
deleted after the job. Student credits ($200/$100) same rule. Nothing
persistent, ever. Runway is long (exp 2027-06-14) and may grow via the
$150k milestone program, but unlocks are NOT guaranteed — §0 still
applies in full. Milestone unlocks change the ledger, never the stack.
Run every burn-down step through `burndown-dry-run.mjs` first ($0 by
construction — see app/azure/README.md). NEVER write `app/locales/` from
a burn-down script; translator drafts go to `app/azure/tmp/` for POEditor
+ native review.

## §8 Env var → vendor key map (the ONLY place this mapping lives)
| Var | Read by | Source |
|-----|---------|--------|
| VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY | client | Supabase project settings (per env) |
| SUPABASE_SERVICE_ROLE_KEY | worker secret only | Supabase — NEVER client, NEVER VITE_ |
| VITE_POSTHOG_KEY / VITE_POSTHOG_HOST | client | PostHog org "skipwait", project "SeatSwap" |
| VITE_SENTRY_DSN | client | Sentry org "skipwait", project seatswap-web |
| SENTRY_DSN_WORKER | worker secret | Sentry project seatswap-worker |
| RAZORPAY_KEY_ID (VITE_ for checkout id) / RAZORPAY_KEY_SECRET (worker) | split | Razorpay dashboard |
| PAYPAL_CLIENT_ID / PAYPAL_SECRET | worker | PayPal developer |
| ZEPTOMAIL_TOKEN | worker secret + GH Actions secret | Zoho ZeptoMail |
| R2 binding: BACKUPS | wrangler.toml binding | CF bucket seatswap-backups-prod |
| SUPABASE_DB_URL | GH Actions secret only | Supabase → direct connection string (port 5432) — backups only |
| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT | GH Actions secrets | CF → R2 API token scoped to seatswap-backups-prod |
| ALERT_EMAIL | GH Actions secret | Ayu's ops inbox |

Rule: client bundles can ONLY read VITE_-prefixed vars. Worker secrets
live in wrangler secrets. GH Actions secrets live in repo Settings →
Secrets → Actions. Any var not in this table is a bug.



