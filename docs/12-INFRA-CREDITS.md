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
| Supabase Startup | ~Team 6mo | apply after Pack | Remove Free limits, zero rewrite | — |
| Play Store | $25 once | — | TWA via PWABuilder (optional) | Apple $99/yr — skip, PWA covers |

## 3. Azure $200 burn-down (ephemeral, delete RG by Dec 10 2026)

Lives in `app/azure/` — scripts are dry-run safe with no keys.
Prod secrets stay in Cloudflare + Supabase. No prod secret in Azure ever.

- `translator-draft.mjs`: `en.json` 635 leaves → `tmp/<code>.json` drafts.
  ~$3.48 for 21 langs. NEVER write `app/locales/`. POEditor + native
  review first (`tests/locales.test.ts` fails on banned words).
- `safety-corpus.json` + `safety-eval.mjs`: 60-msg eval. Known gap —
  shipped `chat-guard.ts` regex is English-only (Hindi + spaced evasion
  unflagged). Fold wins into regex + tests, keep runtime free.
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
