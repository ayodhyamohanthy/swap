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
| Azure for Startups | $5,000 | recheck vendor page (startup terms change) | Burn-down overflow + experiments only — same guardrail as student: prod stays Cloudflare (§1), no prod secret in Azure ever | Prod hosting, Postgres HA, SMS |
| GitHub Student Pack | — | while student | Copilot, POEditor Plus 1yr, LambdaTest, Polypane, Sentry/Honeybadger, Appfigures | — |
| Supabase Startup | ~Team 6mo | apply after Pack | Remove Free limits, zero rewrite | — |
| Play Store | $25 once | — | TWA via PWABuilder (optional) | Apple $99/yr — skip, PWA covers |
| Zoho Suite + Wallet | $2,200 wallet credits | 360 days from enable, non-transferable, non-refundable | Ops only: Mail, Desk, Cliq, Analytics, Creator, Catalyst (see §6) | Never app backend/DB/auth, never PNR or wallet data |

## 3. Azure $200 burn-down (ephemeral, delete RG by Dec 10 2026)

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

## 6. Zoho $1,000 wallet credits (ops only — never the app backend)

Zoho for Startups wallet: 55+ apps, credits valid **360 days** from enable,
locked to the super-admin account (non-transferable, no refunds, no cash).
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
on-device log today — the forwarder picks ONE analytics backend, Sentry
stays errors-only, and PII (PNR/full name/phone/email) never leaves the
device except as ids + amounts. No SMS anywhere (AGENTS.md 15).

| Job | Pick | Terms (verify before claim) | Why not the others |
|---|---|---|---|
| Product analytics + flags + experiments | **PostHog Cloud**, org `skipwait` | $50k startup credits / 12 mo (founded <2yr, raised <$5M, company-domain account, signed up after Jan 2023) + 1M events/mo free forever, no card. AI-tool bills (Desktop/Slack app/Replay Vision/PostHog AI/Inbox) are NOT credit-eligible since Sep 2026 — keep them off | Replaces Mixpanel + Statsig — one SDK, one bill, 950M-event headroom |
| Error + perf + uptime | **Sentry**, org `skipwait` (`skipwait.sentry.io`, human-confirmed 2026-09-30) | $5k startup credits / 12 mo (founded <2yr, raised <$5M, new payer) + solo-dev free tier. YC/a16z deal exists but does NOT stack — take one | Replaces Datadog/New Relic for v1 — Datadog bills per host, NR needs full-user seats |
| Messaging (receipts, credit-expiry, chart push) | **Zoho Mail + Web Push** (wallet §6) | Mail free 5 users; push unlimited free | **No Customer.io** — startup year-free (up to 12 mo, 30k profiles) needs <$10M raised + never-a-customer; you don't need Journeys/pipelines yet. Revisit only for lifecycle mail |
| Billing | **Razorpay + PayPal only** | Test mode free; live = per-txn fee | **No Chargebee** — recurring-MRR billing you don't have (₹99/₹199 are one-time) |
| Status / deploys / edge | **Cloudflare + GitHub** | $10k credits + Pages/Workers | Datadog (org `mayodhya` exists, human-confirmed 2026-09-30 — stays unused for v1) service-accounts + NR agents are ops-heavy for 1 person |

Backups (claim, do NOT dual-instrument): **Mixpanel Startup Plan** (1yr
free, 1B events/yr, founded <5yr, ≤$8M, new payer, must send data in 90
days; project `4032091`, human-confirmed 2026-09-30) and **Statsig Startup** ($50k/12 mo, 1B events, founded <5yr,
<$50M — best past 25k MAU; Developer 2M events/mo free covers you until
then; org `skipwait`, human-confirmed 2026-09-30). **New Relic Students** free tier stays standby — no agent yet.

Claim order: PostHog startup ($50k) → Sentry startup ($5k) →
Mixpanel/Statsig backups → Customer.io only if lifecycle mail becomes real.
studentoffers.co/tools is discovery only (Catalyst $250/6mo etc.) —
vendor pages are truth.

Guardrails: credits are org slugs (`skipwait`, `mayodhya`), never user
keys — DSNs/tokens as env only. Analytics meta = ids + amounts, never PNR.

## 8. Turning the PostHog credit on (built 2026-09-30, L9)

`lib/posthog.ts` forwards the events `lib/analytics.ts` has been recording on
-device since day one. Two conditions, **both** required, and neither is on by
default:

1. `VITE_POSTHOG_KEY` set in `wrangler.toml` `[vars]` — the project token
   (`phc_…`). It is a **public var, not a secret**: browser capture posts to a
   public write-only ingest endpoint, so the value belongs in the shipped
   bundle in the same way the Supabase anon key does. The old `POSTHOG_KEY`
   entry in the secrets block was misleading — a `wrangler secret` of that
   name would never reach the browser code that reads it, so the forwarder
   would sit inert and look configured.
2. The traveller turns on **Settings → Share anonymous usage data**. Absent
   means off; there is no configuration that enables this for everyone. A
   credit is not a mandate.

Until both, `posthogKey()` is `''` and nothing is queued or sent. The bundle
is not byte-for-byte unchanged — the forwarder's own code is in it, ~2 KB with no
SDK — so the honest claim is behavioural, not byte-level: no request is made and
no event leaves the device.

**What can leave:** the 23 event names, a random per-install uuid as
`distinct_id`, and allow-listed meta (`train_no`, `class`, amounts, counts,
fixed enums). **What cannot:** PNR, name, phone, email, ticket photo, and any
free text — enforced by `scrub()`'s key allow-list plus a value check, both
mutation-checked. Replay and session recording are off and should stay off
(§7: not credit-eligible). `admin_action` / `user_blocked` are never sent —
they are staff behaviour with an operator's reason attached, not product usage.

**Identity is a random localStorage uuid, not the Supabase auth id**, so
clearing site data separates the two and a shared device does not join two
people's records. The cost: signed-out and signed-in activity for the same
person are not linked.

Two things to know if you extend it:
- Vite replaces `import.meta.env.VITE_X` **textually**. A lookup by name
  (`readEnv('VITE_POSTHOG_KEY')`) typechecks, tests and builds, then returns
  `undefined` in production. Found by grepping the built asset for the literal
  `VITE_POSTHOG_KEY`; pinned by a test.
- Rows are removed from the queue only on a successful send, so an offline
  device accumulates rather than losing its funnel.


