# 15 — Full-Stack Audit (grounded in `main` @ `882ebcf`, 2026-09-29)

> Commit this file to the swap repo as `docs/15-AUDIT.md`.
> What the repo is today, what is missing for production, file-cited.
> Companion files: `docs/16-BEST-PRACTICES.md` (the standards every lane
> follows) and `docs/17-PRODUCTION-PATH.md` (gap-closure plan mapped to
> the credit ledger in `docs/12-INFRA-CREDITS.md`).
> This file states facts; docs/16 states rules; docs/17 states work.

## 0. One-paragraph verdict

SeatSwap is a **local-first, keyless, fully-tested product shell with no
live backend**. The frontend, domain logic, payments UI, PWA shell, i18n,
job sweeps and admin surface are built and deployed
(https://seatswap.ayodhya-711.workers.dev) with ~850 tests across ~58
files and an enforced collaboration protocol. What separates it from
production is **not code volume — it is keys and wiring**: no Supabase
project is connected (`.env` absent by design), Sentry is config-only
(SDK not initialised), the PostHog forwarder is keyless no-op, GitHub
Actions is billing-blocked, Cloudflare Cron/Queues are not deployed, and
payment webhooks have no live endpoint. Grade: **A− as an engineered
codebase, C as a running service.** The highest-impact work is Phase 0–1
of `docs/17`. **Cost note:** the entire launch path in docs/17 is
zero-charge — every vendor is either credit-funded (docs/12 §2) or a
no-card free tier (Supabase Free cannot bill; it pauses at limits). The
credit-funded scale path for the database is docs/17 §W1-alt (Azure $5k).

## 1. What exists (verified, do not rebuild)

| Surface | Evidence | State |
|---|---|---|
| Product spec | `docs/01-PRD.md` … `docs/10-BUILD-PLAN.md`, `SeatSwap-build-spec.pdf`, `designs/*` | Complete; screens designed |
| Agent protocol | `agents.md` §0 bootstrap, `docs/11`, `docs/13`, `docs/14-LANES.md`, `.githooks/pre-commit` + `prepare-commit-msg`, `app/scripts/collab-check.mjs`, `lane-board.mjs` | Enforced at commit time; lane board live |
| App shell / PWA | `app/vite.config.ts` (vite-plugin-pwa), `app/scripts/postbuild.mjs` + `verify-dist.mjs`, manifest with `id`, 2 shortcuts, 2 real screenshots (IHDR-verified), maskable icon, live workers.dev deploy | **Done (L1).** Installable; SPA fallback via `not_found_handling` |
| Design system | `docs/07-DESIGN-SYSTEM.md`, semantic Tailwind tokens, Inter/Plus Jakarta/Noto Devanagari via fontsource, 360→1440 responsive rule (agents.md 12a) | Done; parity passes captured per-screen (L2/L3/L4 lane notes) |
| Domain logic | `app/src/lib/`: `matching.ts`, `requests.ts`, `groups.ts`, `money.ts` (integer paise), `settle.ts`, `outcomes.ts`, `pnr.ts`, `safety.ts`, `chat-guard.ts` (Hinglish+Devanagari+leet evasion, 100% P/R on 54-msg corpus in `app/azure/safety-corpus.json`) | Built and mutation-tested |
| Payments | `lib/checkout.ts`, `pay-sdk.ts`, `pay-access.ts`, `payments.ts`; receipt arithmetic derived from lines (L4 pass 3); Razorpay + PayPal + credit paths; `server/webhooks.ts` with signature verify | Built, **test-mode/local only** — no live endpoint, no gateway secrets |
| Server fns | `app/src/server/admin.ts`, `jobs.ts`, `webhooks.ts`; boundary validators (uuid checks) after the identity-validator fix | Built, **inert without `SERVICE_ROLE_KEY`** |
| Jobs | `lib/job-sweep.ts` + `<JobRunner/>` in `__root` (expire, auto-confirm 12h, chart_prepared on-device); 5 server jobs in `server/jobs.ts` awaiting Cron | On-device path live; server path not deployed |
| Database | `app/supabase/schema.sql` (~56KB), RLS on every table, `user_roles` + `has_role()` security-definer | Schema written, **no Supabase project connected** |
| Telemetry | `lib/analytics.ts` (no-network on-device log), `lib/telemetry.ts` (ONE forwarder: PostHog `/capture/`, `scrubMeta` PII scrubbing, keyless = zero requests) | Forwarder shipped keyless; **no keys claimed** |
| Error tracking | `VITE_SENTRY_DSN` plumbed in `telemetry.ts` | **Config only — SDK not wired** (known, deliberate) |
| i18n | `app/locales/en.json`, `hi.json`, banned-word tests (`tests/locales.test.ts`), 22-language structure, Azure translator draft pipeline (`app/azure/translator-draft.mjs`, drafts only, POEditor + native review gate) | en+hi live |
| Tests | ~850 tests / ~58 files, vitest 4, jsdom + Testing Library; house discipline: mutation-check every guard, capture-based design parity, assert claims not code shape | Strong. **Unit/integration only — no browser E2E** |
| CI | `.github/workflows/green.yml` | **Billing-blocked** (jobs 0 steps, 3s). All 4 gates run locally instead |
| Azure credits | `app/azure/` burn-down harness (`no-net.mjs` preload, before/after digest, `--scan`, DRYRUN-OK token last), budget checklist, k6 load plan (`load/get-matches.*`, NOT APPLIED) | Disciplined; nothing spent |

## 2. Gaps (severity-ranked)

### Blockers — the product cannot serve two real users without these
| # | Gap | Evidence | Fix (docs/17 workstream) |
|---|---|---|---|
| B1 | **No live backend.** No Supabase project; no `.env`; device is system of record (docs/08). Two phones cannot see each other's requests — matching runs against the device's own local pool (L3 lane note: "the local pool is the device's own trips"; backlog 6 missing-peer-rows) | `lib/supabase.ts` keyless; `wallet_tx` INSERT-policy note in commit `7660feeb` | W1 |
| B2 | **Payments not live.** No gateway secrets, no reachable webhook URL, Razorpay unactivated (KYC prerequisite) | `server/webhooks.ts` built but undeployed | W3 |
| B3 | **Server jobs not scheduled.** Auto-confirm, credit expiry, ₹199 group-cover release depend on `SERVICE_ROLE_KEY` + Cloudflare Cron | commit `7660feeb` states the server wrappers are inert | W2 |

### Major — production-grade blockers, not launch blockers
| # | Gap | Evidence | Fix |
|---|---|---|---|
| M1 | Sentry SDK not initialised; production errors would be invisible | `telemetry.ts` DSN-only by design | W4 |
| M2 | PostHog key unclaimed; zero product analytics | docs/12 §7 claim order #1 | W4 |
| M3 | CI billing-blocked; the green rule exists only on laptops | `green.yml` 3s failures, 0 steps | W5 |
| M4 | No browser E2E: docs/10 step 14 QA is manual; capture harnesses exist per-lane but there is no standing Playwright suite | lane notes describe ad-hoc CDP captures | W6 |
| M5 | Web push has no sender: `lib/push.ts` is client-side only; no VAPID pair, no Worker sender | agents.md 15 (push is the only channel) | W2 |
| M6 | Custom domain not live (`CNAME` file exists; serving from workers.dev) | `CNAME`, docs/12 §1 | W1 |

### Minor — polish
| # | Gap | Fix |
|---|---|---|
| m1 | No CSP/security-headers audit (a `_headers` file ships; content unaudited) | W7 |
| m2 | No bundle-size budget in `verify-dist.mjs` (it verifies artefacts, not size) | W6 |
| m3 | No a11y assertion layer (axe) despite the 360px discipline | W6 |
| m4 | No Lighthouse CI record; installability verified manually | W6 |
| m5 | `docs/14-LANES.md` is ~124KB — slow for every agent's mandatory read; archive done-lane prose | W8 |

## 3. What is genuinely good — do not "improve"

- **Keyless no-op pattern** (`telemetry.ts`, `app/azure/*`): a missing key
  produces zero requests and zero storage. Keep this shape for every new
  vendor.
- **The green rule + hooks**: typecheck + full suite + build + collab-check
  before commit; `pre-commit` blocks other lanes' active files;
  subject-line attribution enforced. This caught real regressions — never
  bypass with `--no-verify`.
- **Mutation-checked tests**: tests are proven to fail when the guard
  breaks. The `splitReceipt` bug survived a test that asserted the wrong
  value — the fix (derive total from lines) is the pattern to copy.
- **Capture-based design parity**: screenshot the *built* screen, don't
  read the JSX. The `?date=2026` invite-link bug was invisible in JSX.
- **Money as integer paise** everywhere; totals derived, never stated.
- **One forwarder** rule: `analytics.ts` on-device, `telemetry.ts` the only
  module that talks to a vendor. Do not add a second SDK path.
- **Boundary validation** with database-shaped answers (uuid checks give
  the same answer Postgres would).
- **`app/azure/` spend discipline**: dry-run first, digests, no prod
  secrets in Azure, ever.

## 4. Scorecard

| Dimension | Grade | One line |
|---|---|---|
| Code quality | A | Strict TS, small modules, derived-not-stated invariants |
| Test depth | A− | Mutation-checked units; no E2E, no a11y layer |
| QA process | B+ | Manual 360/430/768/1440 checks; capture harness ad-hoc |
| UI/UX parity | A− | Per-screen parity passes with honest "deliberately not matched" notes |
| Frontend arch | A | Local-first store, outbox, job-sweep, offline-aware |
| Backend | C | Written but not running: no DB, no cron, no live webhooks |
| Observability | D | Both vendors keyless; prod errors invisible |
| CI/CD | D | Billing-blocked; local gates only |
| Security | B | RLS + `has_role()` + signature verify designed; CSP unaudited; nothing exposed yet because nothing is live |
| Docs/protocol | A+ | The multi-agent system is the repo's standout asset |

## 5. Shared-tools reality (SkipWait ↔ SeatSwap)

The PostHog org `skipwait`, Sentry org `skipwait`, Zoho wallet, Cloudflare
account, Azure subscriptions and the GitHub Student Pack are **shared
across multiple products**. The audit found no cross-contamination yet
(nothing is wired), which makes now the moment to fix the convention —
see `docs/16-BEST-PRACTICES.md` §10 (one org, one *project per product*,
`seatswap-*` naming, separate DSNs/keys, per-product credit lines in
docs/12). Never point two products at one PostHog project or one Sentry
DSN: the event streams and the quota burn become unattributable.
