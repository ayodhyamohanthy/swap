# 12 — Infra & Credits (READ THIS — applies to every agent, every model)

> Single source of truth for hosting, credits, and what NOT to build.
> `AGENTS.md` rules still win on product. This file wins on infra.

## 1. Production stack (fixed — do not "improve")

- PWA shell: `app/dist/client/` on **Cloudflare Workers Static Assets**
  ($10k startup credits, already have). Domain `toyoufromme.website`
  (`CNAME` at repo root). Cache: `assets/* 1y immutable`, `sw.js no-cache`.
- Backend: **Supabase** Postgres + Google Auth + RLS + Storage + Realtime.
  Schema: `app/supabase/schema.sql` (~56KB). Never rewrite to D1/SQLite.
- Server logic: TanStack Start `createServerFn`; webhooks `/api/public/*`
  with signature verify (`app/src/server/webhooks.ts`). Cron + Queues on
  Cloudflare for the 5 jobs in `app/src/server/jobs.ts`.
- Push: Web Push/VAPID only. No SMS/OTP (AGENTS.md 15).
- Auth: Supabase Google OAuth only. **No WorkOS** (evaluated, rejected —
  breaks RLS + `has_role()` for zero gain).

## 2. Credits inventory (expiry is real)

| Credit | Amount | Expires | Use for | Never for |
|---|---|---|---|---|
| Cloudflare Startups | $10,000 | 1 yr / exhausted | Workers, Static Assets, DNS/CDN/WAF, Cron, Queues, R2, KV | Registrar (pay full) |
| Azure student | $200 | **Dec 16 2026** | One-shot burn-down only (see §3) | Prod hosting, Postgres HA, SMS |
| GitHub Student Pack | — | while student | Copilot, POEditor Plus 1yr, LambdaTest, Polypane, Sentry/Honeybadger, Appfigures | — |
| PostHog Cloud `skipwait` | $50,000 startup credits / 12 mo **+ 1M events/mo free forever** | 12 mo from claim | Product analytics, flags, experiments (§7 pick #1) | AI-tool add-ons (Desktop, Slack app, Replay Vision, PostHog AI, Inbox) — not credit-eligible |
| Sentry `skipwait` | $5,000 startup credits / 12 mo **+ solo-dev free tier** | 12 mo from claim | Errors + perf only (§7 pick #2) | A second error vendor — Datadog/NR bill per host/seat |
| Azure Microsoft for Startups | $5,000 | **not the student credit** — separate subscription, own expiry | The same one-shot jobs as §3, with 25× the headroom | Prod hosting, Postgres HA, SMS |
| Supabase Startup | ~Team 6mo | apply after Pack | Remove Free limits, zero rewrite | — |
| Play Store | $25 once | — | TWA via PWABuilder (optional) | Apple $99/yr — skip, PWA covers |
| Zoho Suite + Wallet | $2,200 wallet credits | 360 days from enable, non-transferable, non-refundable | Ops only: Mail, Desk, Cliq, Analytics, Creator, Catalyst (see §6) | Never app backend/DB/auth, never PNR or wallet data |

## 3. Azure $200 burn-down (ephemeral, delete RG by Dec 10 2026)

Two Azure credits exist and they are **not** one budget: the $200 student
subscription (expires Dec 16 2026 — this section's Dec-10 delete-by rule) and
the $5,000 Microsoft for Startups subscription (separate RG, own expiry).
Budget each separately and never let one job draw on the student credit "for
now"; the cheap, deletable discipline below is what makes the bigger credit
safe to spend later.

Lives in `app/azure/` — scripts are dry-run safe with no keys.
Prod secrets stay in Cloudflare + Supabase. No prod secret in Azure ever.

- `burndown-dry-run.mjs`: **run this first.** Executes every burn-down script
  in its no-spend mode with `fetch` replaced (`no-net.mjs` preload), Azure keys
  stripped from the child env, and a before/after content digest proving nothing
  outside `app/azure/tmp/` changed. Fails if a new `.mjs` appears in `app/azure/`
  without a no-spend invocation. Green = `total spend: $0.00`.
- `translator-draft.mjs`: `en.json` → `tmp/<code>.json` drafts, one language per
  run. **Cost and size: run the dry run for the current numbers** (~$0.20/lang,
  under $5 for all 21) — they move every time a lane adds a string, which is
  why they are not written down here. NEVER write `app/locales/`. POEditor +
  native review first (`tests/locales.test.ts` fails on banned words).
- `safety-corpus.json` + `safety-eval.mjs`: 54-message eval scored against the
  **shipped** `chat-guard.ts`, not a copy of it — a mirror is available only
  behind an explicit `--mirror` and labels its own output. Current: 34 TP /
  20 TN / 0 FP / 0 FN (100% precision and recall), every label classified.
  The guard is **not** English-worded: it carries Hinglish + Devanagari word
  lists, spelled-out digits and spaced/leet evasion squishing, and the eval
  scores it on all of them. The real gap is corpus breadth, not rule coverage.
  Fold any wins back into the guard's own tests; keep runtime free.
- `load/get-matches.*`: partial indexes + paginated `get_matches()` RPC
  proposal + k6 plan for hot-train (12951+date+3A). NOT APPLIED.
- `budget/checklist.md`: RG `seatswap-exp-dec16`, budget $200,
  alerts 50/80/100%.

## 4. Scale rule (lakhs)

Match scope never crosses `train_no + journey_date + class` — shard by
that. Edge caches hot boards 10s; phone pages ≤20 rows; writes drain via
Queues. See `app/azure/README.md` quick start + §3 spend order.

## 5. Before you touch infra

1. `git pull --rebase`, `git status --short`, hot-file check (docs/11).
2. Never `git add -A`. One topic per commit. Green rule: typecheck +
   full tests + build before commit.
3. Read `app/azure/README.md` if your task spends Azure credits.

## 6. Zoho wallet credits (ops only — never the app backend)

Zoho for Startups wallet: 55+ apps, **$2,200** wallet credits (amount
confirmed by Ayu 2026-09-29; this heading previously said $1,000 while §2
said $2,200 — §2 is the ledger, keep them in step), valid **360 days** from
enable, locked to the super-admin account (non-transferable, no refunds, no
cash).
Workplace/Mail has a per-app cap — plan Mail separately.

Spend it on running the company, NOT serving the PWA:

- **Mail (custom domain `toyoufromme.website`)** — receipts, `SS-#####`
  confirmations, credit-expiry reminders. Free tier covers 5 users; wallet
  covers the paid jump when support@ volume grows.
- **Desk** — the human side of disputes (`docs/04-D`, `disputes` table).
  Copy rule: "We'll look at both sides and reply as soon as we can. Your
  money is held safely meanwhile." (AGENTS.md 7). Free 3 agents is enough
  at launch; wallet funds Standard when tickets spike.
- **Cliq + Cliq Taz** — 1-person ops alerts: paid-swap spikes, webhook
  failures, chart-time fan-out. Replaces paid PagerDuty.
- **Analytics** — `docs/01` success metrics dashboard (PNRs added ·
  requests · acceptances · paid · confirmed · first-on-train rate ·
  shares/swap · repeat · credit redeemed). Reads *aggregates* only.
- **Creator (low-code, optional)** — internal admin forms (manual credit
  adjust with reason, block review). Never a second user DB — it POSTs to
  the same Supabase RPCs the app uses.
- **Catalyst (serverless, optional)** — cron-shaped helpers (credit-expiry
  mailer, receipt PDF render via SmartBrowz). Free tier + trial covers it;
  wallet only if you exceed. PWA + API stay on Cloudflare + Supabase.

Banned in Zoho: full PNRs (store `pnr_last4` only, docs/08), full names,
phone/email export, ticket photos, wallet balances per user. Zoho sees
`SS-#####` receipt numbers + aggregates — never the DB rows.

## 7. Student + startup offer matrix (verified Sep 2026 — amounts change, recheck vendor page before claiming)

Rule: **one tool per job.** `app/src/lib/analytics.ts` is a no-network
on-device log, and `app/src/lib/telemetry.ts` is the ONE forwarder: PostHog
gets the events, Sentry stays errors-only, and PII (PNR/full name/phone/
email) never leaves the device except as ids + amounts — enforced in
`scrubMeta`, not merely promised in this comment. No SMS anywhere
(AGENTS.md 15).

| Job | Pick | Terms (verify before claim) | Why not the others |
|---|---|---|---|
| Product analytics + flags + experiments | **PostHog Cloud**, org `skipwait` | $50k startup credits / 12 mo (founded <2yr, raised <$5M, company-domain account, signed up after Jan 2023) + 1M events/mo free forever, no card. AI-tool bills (Desktop/Slack app/Replay Vision/PostHog AI/Inbox) are NOT credit-eligible since Sep 2026 — keep them off | Replaces Mixpanel + Statsig — one SDK, one bill, 950M-event headroom |
| Error + perf + uptime | **Sentry**, org `skipwait` | $5k startup credits / 12 mo (founded <2yr, raised <$5M, new payer) + solo-dev free tier. YC/a16z deal exists but does NOT stack — take one | Replaces Datadog/New Relic for v1 — Datadog bills per host, NR needs full-user seats |
| Messaging (receipts, credit-expiry, chart push) | **Zoho Mail + Web Push** (wallet §6) | Mail free 5 users; push unlimited free | **No Customer.io** — startup year-free (up to 12 mo, 30k profiles) needs <$10M raised + never-a-customer; you don't need Journeys/pipelines yet. Revisit only for lifecycle mail |
| Billing | **Razorpay + PayPal only** | Test mode free; live = per-txn fee | **No Chargebee** — recurring-MRR billing you don't have (₹99/₹199 are one-time) |
| Status / deploys / edge | **Cloudflare + GitHub** | $10k credits + Pages/Workers | Datadog service-accounts + NR agents are ops-heavy for 1 person |

Backups (claim, do NOT dual-instrument): **Mixpanel Startup Plan** (1yr
free, 1B events/yr, founded <5yr, ≤$8M, new payer, must send data in 90
days) and **Statsig Startup** ($50k/12 mo, 1B events, founded <5yr,
<$50M — best past 25k MAU; Developer 2M events/mo free covers you until
then). **New Relic Students** free tier stays standby — no agent yet.

Claim order: PostHog startup ($50k) → Sentry startup ($5k) →
Mixpanel/Statsig backups → Customer.io only if lifecycle mail becomes real.
studentoffers.co/tools is discovery only (Catalyst $250/6mo etc.) —
vendor pages are truth.

**Accounts Ayu holds** (2026-09-29, user-supplied; vendor pages still rule on
amounts and expiry). This is what backlog 5 was waiting on: the orgs now
exist, so the plumbing below is real work rather than a hypothetical key.

- PostHog Cloud org **`skipwait`** — claim order #1 → implemented.
- Sentry org **`skipwait`** (`skipwait.sentry.io`) — claim order #2 → config
  wired; the transport is deliberately not written (see below).
- Mixpanel project `4032091` / view `4528315` / board `skipwait` — backup.
- Statsig org **`skipwait`** — backup.
- Datadog, US5, service accounts under `mayodhya` — **standby, no agent**.
- New Relic — **standby, no agent** (its student tier is already free).
- Cloudflare $10,000, Azure $5,000 for Startups, Zoho $2,200, GitHub Student
  Pack — amounts live in §2.

**Held but deliberately not adopted** — recorded so nobody re-litigates it:
Mixpanel and Statsig are *backups*, and each would be a second SDK feeding a
second set of numbers that can disagree with `activity_log`; Datadog and New
Relic bill per host or per seat to watch a one-person ops surface; Chargebee
prices recurring subscriptions and every payment here is one-time (₹99,
₹199); Customer.io is lifecycle mail, and the only lifecycle mail that exists
is receipts + credit-expiry reminders, which Zoho Mail already sends. A free
credit is not a reason to adopt a tool — the trigger in the table is, and
none of these has fired yet.

**Implemented 2026-09-29 (L9):** `app/src/lib/telemetry.ts` reads
`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` / `VITE_SENTRY_DSN`, validates them
(a DSN that cannot be parsed reports as *not* enabled, so a typo cannot
swallow every error silently), scrubs PII out of every payload, and posts one
`/capture/` request per event. With no key set it does **nothing at all** — no
request, no storage write — so the keyless build and every keyless gate are
byte-for-byte unchanged. `lib/analytics.ts` calls it and the on-device log
stays the record either way. Sentry is config only: a hand-rolled envelope is
a protocol nobody here can verify without a DSN and an account, and shipping
an unverifiable transport is worse than shipping none. Flags/experiments
still need the PostHog SDK and are not started.

Guardrails: credits are org slugs (`skipwait`, `mayodhya`), never user
keys — DSNs/tokens as env only, and §8 says where each one lives. Analytics
meta = ids + amounts, never PNR.

## 8. Where each key lives (client values are build-time, not secrets)

A static-assets Worker serves a bundle Vite already inlined, so
`wrangler secret put` cannot reach the browser: a secret there is a runtime
binding with no reader. That is why the PostHog project key and the Sentry
DSN are `VITE_*` **build-time** variables — set in the build environment
(`.env.local` locally, the hosting build vars in prod, Settings → Environment
in Freebuff) — and why they are no longer listed among the secrets in
`app/wrangler.toml`.

| Key | Lives in | Public? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build env + Supabase dashboard | public — RLS is the control, never the key |
| `VITE_VAPID_PUBLIC_KEY` | build env | public (the private half is a secret) |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | build env | **public by design** — it ships in every posthog-js bundle |
| `VITE_SENTRY_DSN` | build env | **public by design** — a write-only ingest address |
| `RAZORPAY_*`, `PAYPAL_*`, `VAPID_PRIVATE_KEY` | `wrangler secret put` + Supabase secrets | secret — never in the repo, never in a bundle |
| PostHog *personal API* key, Sentry *auth token* (queries, release upload) | CI secret store | secret — server-side only, never a `VITE_` var |

- Never commit a key, and never give a credential a `VITE_` prefix: Vite
  inlines those into the bundle, so `VITE_RAZORPAY_KEY_SECRET` would be a
  published secret. `tests/telemetry.test.ts` fails on any `VITE_*` name
  containing SECRET / PRIVATE / TOKEN / PASSWORD / WEBHOOK.
- Keyless is the default and the shipped state: with none of these set, every
  gate passes and the app runs local-first (§5, `app/azure/README.md`).
- Adding a key is an env change, never a code change. If a var is missing, the
  answer is Settings → Environment, not a fallback in the source.

