# 17 — Production Path (workstreams W1–W8, credit-funded, lane-ready)

> Commit this file to the swap repo as `docs/17-PRODUCTION-PATH.md`.
> Closes the gaps in `docs/15-AUDIT.md` §2 using ONLY products already in
> the `docs/12-INFRA-CREDITS.md` ledger (plus free tiers). Ordered so an
> agent that reads `agents.md` §0 and finds these on the Backlog can
> execute without asking. Every workstream ends with the four local
> gates: `npm run typecheck` → `npm run test` → `npm run build` →
> `npm run collab-check` (workspace `seatswap-app`).
>
> **Human-only steps are marked 🔑** — they need Ayu's accounts and
> cannot be done by an agent. Everything else is agent work.

## Zero-charge guarantee (read first — every vendor, every phase)

Rule: **every product in this plan is either (a) funded by a credit in
docs/12 §2 or (b) a free tier with NO card on file.** A vendor that has
no card cannot bill you — worst case it pauses/throttles, which is
recoverable. Before wiring any vendor, verify its spend guard:

| Product | Why it can't charge | Guard to set 🔑 |
|---|---|---|
| Cloudflare (Workers, DNS, KV, Queues, R2, Cron) | $10k startup credits | Billing → notification at 50/80% of credits |
| Supabase | Free tier, **no card required** — hard limits pause the project, never bill | Stay on Free plan; do NOT add a card; enable usage-cap emails |
| Sentry `skipwait` | $5k credits + solo-dev free tier | Set spend cap to $0 beyond credits; on-demand budget = $0 |
| PostHog `skipwait` | $50k credits + 1M events/mo free forever | Billing limit $0 beyond credits; keep AI add-ons off (not credit-eligible) |
| GitHub Actions | Student Pack minutes | Spending limit $0 (then it stops, not bills) |
| Razorpay / PayPal | No subscription — per-transaction fees deducted from the payment itself, never charged to a card | Test mode until KYC; no card needed |
| Azure (fallback only, §W1-alt) | $5k Microsoft for Startups subscription | Budget + alerts at 50/80/100% on the RG (docs/12 §3 discipline) |
| Zoho (ops only) | $2,200 wallet | Wallet is prepaid — cannot overdraw |

If a workstream would require a product outside this table, it does not
ship — add a Backlog row and flag Ayu instead.

## Phases (do not wire everything at once)

- **Phase 0 — turn the lights on**: W1 (Supabase live) + W4 (Sentry/PostHog keys)
- **Phase 1 — the service runs itself**: W2 (cron, queues, push sender) + W5 (CI)
- **Phase 2 — money**: W3 (Razorpay/PayPal live + webhooks)
- **Phase 3 — hold the quality line**: W6 (E2E + budgets + a11y) + W7 (headers)
- **Phase 4 — hygiene**: W8 (lane-board archive, docs cross-refs)

---

## W1 — Database goes live (fixes B1, M6) — credit: $0 (Supabase Free, no card) with Azure $5k fallback

**Why Supabase Free and not a paid/credited DB first:** the schema
(`app/supabase/schema.sql`, ~56KB) is written for Supabase Postgres with
RLS + `has_role()` + Google OAuth + Storage + Realtime as one unit.
Free tier covers launch comfortably (500MB DB, 50k MAU auth, 1GB
storage) at **$0 with no card on file — it pauses at limits, it cannot
bill**. Rewriting now to spend credits would burn weeks to avoid a bill
that cannot happen. Credits are the *scale* path, not the launch path.

1. 🔑 Create Supabase project `seatswap` (region `ap-south-1`) on the
   **Free plan — do not enter a card anywhere**. Enable Google OAuth,
   apply `app/supabase/schema.sql` via the SQL editor or
   `supabase db push`. Record key *names* in docs/12 §8.
2. 🔑 Cloudflare: add zone `toyoufromme.website` (already on the $10k
   credits for DNS/CDN/WAF), route the Worker to it, keep workers.dev as
   staging. Set Worker secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   (public pair also as `VITE_*` build vars), `SERVICE_ROLE_KEY`
   (secret, Worker only — docs/16 §7.2).
3. Agent: `lib/supabase.ts` reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
   with the keyless no-op preserved — keyless build stays green and
   local-first (it is the offline/demo path forever, not scaffolding).
4. Agent: sync layer — `outbox.ts` drains to Supabase when keys + session
   exist; local store hydrates from Supabase on sign-in; conflict rule:
   server wins on rows the server owns (payments, credits), device wins
   on drafts.
5. Agent: **RLS policy tests.** A vitest suite that runs only when a
   `SUPABASE_TEST_URL` is present (keyless = skipped, suite stays
   green): as user A, attempt to read user B's PNR/trip/payment rows —
   assert denial; assert `has_role()` gates every admin RPC.
6. DoD: two different browsers with two Google accounts see each other's
   open-to-swap rows on the same train+date+class (backlog 6 closes);
   RLS suite green; keyless build unchanged (verify by diffing bundle).

### W1-alt — Azure Postgres migration (credit-funded scale path; PLANNED, not now)

Trigger: Supabase Free limits actually bitten (DB > 400MB sustained, or
auth MAU near 50k, or the pause hits during real usage). Then — and only
then — spend the **$5,000 Microsoft for Startups** credit:

- **Azure Database for PostgreSQL Flexible Server** (own RG, budget +
  alerts per docs/12 §3 discipline; never the $200 student credit).
  The schema is standard Postgres — tables/constraints port as-is.
- What must be rebuilt (why this is the fallback, not the default):
  RLS-as-auth becomes Worker-enforced authorization; Google OAuth moves
  to a Worker-side OAuth flow (session in KV); Storage → **R2** (already
  credit-covered); Realtime → 10s polling of edge-cached boards
  (docs/12 §4 already assumes this shape at scale).
- Keep `lib/supabase.ts`'s data-access surface thin so the swap is a
  driver change, not an app rewrite — that thinness is enforced by the
  W1.4 sync-layer boundary and is the migration insurance.
- 🔑 Estimated runway: smallest burstable tier ≈ $15–30/mo ⇒ the $5k
  credit funds years of it. Decision + numbers go to docs/12, ledger
  conventions apply.

## W2 — The service runs itself (fixes B3, M5) — credit: Cloudflare $10k

1. Agent: Cron Triggers on the Worker for the 5 jobs in
   `src/server/jobs.ts` (expire, auto-confirm 12h, chart_prepared,
   credit-expiry, group-cover release). Each job: idempotent, logs
   counts to telemetry, safe to double-fire (docs/16 §7.5).
2. Agent: Queues for chart-time fan-out (docs/12 §4): producer on cron,
   consumer batches web-push sends.
3. Web push sender: 🔑 mint one VAPID key pair (public in `VITE_*`,
   private as Worker secret). Agent: Worker sender using the standard
   Web Push encryption; subscription rows already modelled in the
   schema; per-user notification prefs respected.
4. Agent: keep `lib/job-sweep.ts` as the degraded-mode path; add a test
   that server job and device sweep produce identical state from the
   same fixture (docs/16 §7.6).
5. DoD: a locked swap with no answer auto-confirms 12h post-journey with
   NO device open; a chart-prepared push arrives on a real phone.

## W3 — Money goes live (fixes B2) — credit: none needed (per-txn fees only)

1. 🔑 Razorpay: complete KYC (needs incorporation/bank), stay in test
   mode until approved. PayPal: business account for international.
   Secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
   `PAYPAL_CLIENT_SECRET`) → Worker secrets only.
2. Agent: expose `/api/public/webhooks/razorpay` + `/paypal` on the
   deployed Worker; `server/webhooks.ts` already verifies signatures —
   add the idempotency store (KV: processed event ids, TTL 90 days) and
   the replay test (same payload twice ⇒ one state change, two 200s).
3. Agent: reconciliation job (W2 cron): payments `pending` > 30min are
   re-checked against the gateway API; mismatches → activity_log +
   telemetry event, never silent.
4. Amount rule already enforced (server computes from request row) —
   add the test that a tampered client amount is ignored.
5. DoD: one real ₹99 UPI payment in Razorpay test mode locks a swap
   end-to-end through the live webhook; replayed webhook is a no-op;
   rule 6 path (swap didn't happen → ₹99 to credit) exercised.

## W4 — Eyes open: Sentry + PostHog (fixes M1, M2) — credits: $5k Sentry + $50k PostHog

1. 🔑 In org `skipwait`: create Sentry project **`seatswap-web`** and
   PostHog project **`seatswap`** (shared-tools rule, docs/16 §10).
   Claim startup credits per docs/12 §7 claim order. Set
   `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` as build
   vars.
2. Agent: wire `@sentry/react` in the entry — init ONLY if DSN present
   (keyless no-op), `beforeSend` runs the same `scrubMeta` scrubber,
   release = git SHA injected at build, sourcemaps uploaded by a script
   (manual until W5 CI runs it), sampled tracing at 10%.
3. Agent: error boundary at the route root that reports and renders the
   offline-friendly fallback, never a white screen.
4. Agent: event taxonomy doc `docs/18-EVENTS.md`: the funnel is
   `pnr_added → request_sent → request_accepted → paid → swap_confirmed`
   plus `matches_viewed` (already instrumented, L3). Properties: ids +
   amounts + counts only — no PNR, name, phone, email (pinned by test).
5. DoD: an intentional test error appears in Sentry with a readable
   stack (sourcemap applied); the 5-step funnel renders in PostHog from
   a staging walkthrough; keyless build makes zero vendor requests
   (network-tab assertion in the capture harness).

## W5 — CI unblocked (fixes M3) — credit: GitHub Student Pack / Cloudflare

1. 🔑 Fix Actions billing (Student Pack grants minutes; set a spending
   limit of $0 so it can never charge). If it stays blocked: Cloudflare
   Workers Builds runs the same four gates on push (already credit-
   covered).
2. Agent: `green.yml` runs the exact local gates — no drift between
   laptop-green and CI-green. Add: locales banned-word grep and the W6
   bundle budget once they exist.
3. Pipeline target: PR → gates + preview deploy (workers.dev); main →
   production deploy + Sentry release + sourcemap upload.
4. DoD: a PR shows a green check and a preview URL; a red gate blocks
   merge; `main` deploy tags a Sentry release.

## W6 — QA hardening (fixes M4, m2–m4) — credit: Student Pack (LambdaTest, Polypane)

1. Agent: **Playwright suite** (new dev dep — free) for the docs/04
   flows: add PNR → request → accept (two contexts) → pay (test mode) →
   berth reveal → confirm. Runs keyless against the local build for the
   local-first path; a second project runs against staging when keys
   exist. Viewports: 360 and 1440. Include: offline mode (context
   `offline: true`) renders Trips + Swap summary; axe scan per screen
   with zero serious/critical violations.
2. Agent: **bundle budget** in `verify-dist.mjs`: Home-route first-load
   JS ≤ 200KB gzip; fail the build over budget. (`app/scripts/**` is
   L9's lane — claim it or request.)
3. Agent: Lighthouse CI (or the PWA assertions of it) against the built
   `dist/cf`: installable, no console errors, performance ≥ 85 mobile.
4. 🔑/optional: LambdaTest (Student Pack) for one real-device Android
   pass per release; Polypane for the 360→1440 sweep during dev.
5. DoD: `npm run test:e2e` green locally; budget enforced (prove by
   inflating a chunk and watching it fail); axe clean.

## W7 — Headers & CSP (fixes m1) — credit: Cloudflare (already covered)

1. Agent: author `_headers` explicitly: CSP allowing self + Supabase +
   `checkout.razorpay.com` + PayPal JS + PostHog/Sentry ingest, HSTS
   (after the custom domain is stable), nosniff, frame-ancestors 'none',
   strict-origin-when-cross-origin. `sw.js` no-cache; `assets/*`
   immutable (already the docs/12 rule).
2. Agent: `verify-dist.mjs` asserts the headers file exists and carries
   the CSP + HSTS lines (a header claim without a verifier is a silent
   regression — docs/16 §6.4).
3. DoD: securityheaders.com grade A on the production domain; Razorpay
   checkout still opens (CSP is where payment integrations break —
   test the pay flow after every CSP change).

## W8 — Repo hygiene (fixes m5)

1. Agent: move done-lane prose from `docs/14-LANES.md` to
   `docs/14-LANES-ARCHIVE.md`; the board keeps one line per lane +
   state. Update the hooks' lane parser only if its format assumptions
   change (they read docs/14 at run time — test first).
2. Agent: cross-reference block in `README.md` and `agents.md` §0 step 3:
   read order becomes `docs/11 → 12 → 13 → 16 (standards) → 15 (state) →
   17 (backlog source)`.
3. DoD: `docs/14` under 15KB; `collab-check` and both hooks still green
   against the new format (run their tests).

---

## Ready-to-paste Backlog rows (for `docs/14-LANES.md` Backlog)

1. W1.3–W1.6 Supabase client + sync + RLS tests (needs 🔑 W1.1–2 first)
2. W4.2–W4.5 Sentry wiring + error boundary + docs/18-EVENTS.md (needs 🔑 W4.1)
3. W2.1–W2.2 Cron + Queues on the Worker (needs W1)
4. W2.3–W2.4 Push sender + parity test (needs 🔑 VAPID pair)
5. W6.1 Playwright flows + axe (no keys needed — start any time)
6. W6.2–W6.3 bundle budget + Lighthouse assertions (L9 surface)
7. W7 headers/CSP + verifier (no keys needed — start any time)
8. W3.2–W3.4 webhook idempotency + reconciliation (needs W1; live keys 🔑)
9. W8 lane-board archive (no keys needed)
10. W1-alt Azure Postgres migration plan — PARKED until a Free-tier
    limit is actually hit (needs 🔑; spends the $5k startup credit)

## Env classification (the past defect's antidote — keep current)

| Var | Class | Lives in |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | public build-time | build env / CI |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_SENTRY_DSN` | public build-time | build env / CI |
| `VITE_VAPID_PUBLIC_KEY` | public build-time | build env / CI |
| `SERVICE_ROLE_KEY` | secret | Cloudflare Worker secret only |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | secret | Worker secret only |
| `PAYPAL_CLIENT_SECRET` | secret | Worker secret only |
| `VAPID_PRIVATE_KEY` | secret | Worker secret only |
| `SENTRY_AUTH_TOKEN` (sourcemap upload) | secret | CI secret only |

Never list a `VITE_*` var as a wrangler secret (a client bundle cannot
read one — the exact defect L9 found and fixed) and never the reverse.

## What NOT to add (decided; do not relitigate without new facts)

- No SMS/OTP vendor (agents.md 15) — push + Updates list only.
- No Chargebee (no recurring MRR), no Customer.io yet (docs/12 §7),
  no Datadog/New Relic agents (per-host/seat pricing, 1-person ops).
- No second analytics SDK — Mixpanel/Statsig stay claimed-but-parked.
- No D1/SQLite rewrite of the schema; Postgres is fixed. Launch DB is
  Supabase Free (no card = no bill); the credit-funded scale path is
  W1-alt (Azure $5k), not a paid Supabase plan.
- No WorkOS (breaks RLS + `has_role()` — already evaluated).
- Never add a card to a vendor that runs on a free tier — the
  zero-charge table at the top of this file is the contract.
