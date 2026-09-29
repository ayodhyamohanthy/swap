# 12 — Infrastructure & Credits Ledger

## §0 Prime directive
NEVER build persistent infrastructure on expiring credits. Build on
generous free tiers, keep data portable, hold expiring credits as burst
capacity and insurance. Credit expiry must only ever degrade us to
"free tier," never to "broken."

## §1 Fixed stack (agents may not change this)
- Web: TanStack Start + React 19 + Vite 7 + Tailwind v4, PWA via
  vite-plugin-pwa. Mobile-first; TWA for Play Store later.
- Data: Supabase Postgres + Auth (Google) + RLS + Realtime.
- Edge: Cloudflare Workers Static Assets, Cron Triggers, Queues, R2.
- Payments: Razorpay (domestic), PayPal (international).
- Email: Zoho ZeptoMail (transactional only).
- Observability: PostHog (analytics + flags), Sentry (errors).
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
| Zoho        | $2,200 wallet              | ZeptoMail, Desk, Analytics  | WIRED     | app runtime/backend          |
| Razorpay    | standard                   | domestic payments           | WIRED     | international                |
| PayPal      | standard                   | international payments      | WIRED     | domestic (fees)              |
| Azure       | $5,000 startup (expiring)  | one-shot batch in disposable RGs; DR landing zone | RESERVE | anything persistent |
| Chargebee   | free to $1M revenue        | subscriptions / credit packs| RESERVE   | one-off swap charges         |
| Customer.io | startup program            | lifecycle campaigns         | RESERVE   | transactional email          |
| Mixpanel    | live project, no SDK       | analytics fallback          | BENCH     | —                            |
| Statsig     | account only               | flags fallback              | BENCH     | —                            |
| Datadog     | svc acct "mayodhya"        | infra APM if ever on Azure  | BENCH     | client-side PWA              |
| New Relic   | via student pack           | —                           | UNCLAIMED | —                            |
| Student Pack| domain (Namecheap/Name.com), Copilot Pro, DO $200, Azure $100 | domain → Cloudflare DNS | PARTIAL | persistent infra on DO/Azure |

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
Nightly cron (Cloudflare Worker `seatswap-backup-prod`) runs pg_dump →
R2 bucket `seatswap-backups-prod`, 30-day retention. Restore drill and
full vendor-exit steps: docs/16-EXIT-PLAYBOOK.md. Max acceptable data
loss: 24h.

## §6 Chargebee activation trigger
Activate ONLY when a recurring plan or credit-pack SKU exists. It sits
on top of Razorpay/PayPal as gateways — nothing gets ripped out.

## §7 Azure discipline
Resource groups named <app>-<purpose>-<expiry> (e.g. seatswap-exp-dec16),
deleted after the job. Student credits ($200/$100) same rule. Nothing
persistent, ever.

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
| ZEPTOMAIL_TOKEN | worker secret | Zoho ZeptoMail |
| R2 binding: BACKUPS | wrangler.toml binding | CF bucket seatswap-backups-prod |
Rule: client bundles can ONLY read VITE_-prefixed vars. Worker secrets
live in wrangler secrets. Any var not in this table is a bug.
