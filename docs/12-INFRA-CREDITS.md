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
- Payments: Razorpay (domestic), PayPal (international).
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
| SUPABASE_DB_URL_STAGING | local env + GH Actions secret | Supabase seatswap-staging → direct connection string (port 5432) — schema mirror (app/scripts/staging-mirror.mjs) + restore drills only |
| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT | GH Actions secrets | CF → R2 API token scoped to seatswap-backups-prod |
| ALERT_EMAIL | GH Actions secret | Ayu's ops inbox |

Rule: client bundles can ONLY read VITE_-prefixed vars. Worker secrets
live in wrangler secrets. GH Actions secrets live in repo Settings →
Secrets → Actions. Any var not in this table is a bug.



