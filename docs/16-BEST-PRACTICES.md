# 16 — Best Practices (code · test · QA · UI · UX · frontend · backend)

> Commit this file to the swap repo as `docs/16-BEST-PRACTICES.md`.
> These are the standards every lane follows, distilled from what has
> already *worked* in this repo (the audit in `docs/15` cites the
> incidents) plus what production requires. `agents.md` rules still win
> on product; `docs/12` wins on infra spend. This file wins on **how**.
>
> **Portable by design**: §1–§9 are product-agnostic and may be copied
> into any sibling product repo (e.g. SkipWait). §10 exists *because*
> the tool accounts are shared across products.

## 1. Code

1. **TypeScript strict, no `any` at boundaries.** A value entering from
   the network, storage, or a route param is `unknown` until validated.
   Validators give the same answer the database would (uuid, CHECK-shaped)
   — see `server/admin.ts` after the identity-validator fix.
2. **Derive, don't state.** Any figure that can be computed from its
   parts must be (`splitReceipt` total = sum of lines). A stated total
   and a computed total will eventually disagree; only one bug class
   survives if the total is derived.
3. **Money is integer paise.** ₹99 = 9900. No floats, no `toFixed`
   arithmetic, format only at render.
4. **One module, one job.** `analytics.ts` logs on-device; `telemetry.ts`
   is the ONE network forwarder; `chat-guard.ts` owns risky-message
   rules. New capability = new module, not a flag on an old one.
5. **Keyless no-op is mandatory for every vendor.** Missing key ⇒ zero
   network requests, zero storage writes, identical UX. The build must
   stay green and shippable with no `.env` at all.
6. **A string that leaves the device must be built by a function**, not
   assembled in JSX — functions are assertable (`inviteLink()`,
   `splitTrainDate()`). The `?date=2026` bug is the standing reason.
7. **Copy through i18n only** (`app/locales/*.json`). Two audiences =
   two keys (`share.body` for the viewer vs `share.message` for the
   recipient). Run the banned-word test before commit.
8. **No new dependencies without cause.** Every dep is a supply-chain and
   bundle cost. Free/student/startup-credit products only (agents.md §0).

## 2. Tests

1. **A test must fail when the guard breaks — prove it.** After writing a
   test, mutate the guard (invert the condition, restore the old code)
   and watch the test fail; record the mutation in the commit message.
   A test that passes both ways is documentation, not a test.
2. **Assert the claim, not the code shape.** Test what the user/receipt/
   URL actually gets, with values the app really passes (the old
   `splitReceipt` test passed 6900 — a value the app never passes).
3. **Fixtures mirror production semantics.** Each group member gets its
   own acceptor; caps are hit in the order production hits them.
4. **Success tokens print last.** A machine-readable "OK" that can appear
   on a failing run is worse than none (`DRYRUN-OK` incident). Assert the
   *absence* of the token on failure paths.
5. **Full suite before every commit** — never a filtered run. Flaky
   drop-outs under machine load are retried and the load documented, not
   ignored.
6. **New logic ships with its tests in the same commit.** The two
   share-sheet defects landed untested in a commit titled `0`; the hooks
   now block that, and this rule is why.

## 3. QA

1. **Evidence over opinion.** "It looks fine on my screen" is not done.
   Done = captured at 360 / 430 / 768 / 1440 with no horizontal scroll
   and no clipped text (agents.md 12a).
2. **Capture the built app, not the JSX.** Use the CDP capture pattern
   from L1/L3: navigate the real build, wait for `location.pathname` +
   non-empty `<main>`, refuse byte-identical screenshots, verify decoded
   content (colour counts, brand colour presence).
3. **Design parity notes are honest.** When a design detail is
   deliberately not matched, say so and say why (no station dictionary,
   no peer rows) — inventing data to match a picture is a defect.
4. **Every flow in `docs/04-FLOWS.md` end-to-end** on a 360px viewport,
   offline included, before a release tag (docs/10 step 14).
5. **Grep gates**: banned words (locales test), raw hex in components,
   `git add -A` (blocked by hook), PII fields in telemetry payloads.
6. **Accessibility floor**: every interactive element has an accessible
   name; touch targets ≥ 44px; contrast ≥ 4.5:1 for text; focus visible;
   the app is operable with a keyboard on desktop widths. Add an axe
   pass to the capture harness (docs/17 W6) rather than a manual list.

## 4. UI

1. **Designs win on layout and wording; agents.md wins on rules.** If an
   image disagrees with a non-negotiable rule, the rule wins (banned
   words, 3 tabs, price).
2. **Semantic tokens only** — no raw hex in components (docs/07).
3. **State-truthful copy.** A screen must not make an unconditional claim
   that is only sometimes true ("● Live", "Fewer people here yet…").
   Copy branches on state or stays state-neutral.
4. **Every money figure names what it measures.** Method + amount must be
   the same transaction ("₹49 paid · Razorpay", never the gross next to
   the method that took less).
5. **Empty, loading, error, offline states are part of the screen**, not
   afterthoughts. A screen is not "done" with only its happy path.

## 5. UX

1. **The user's next action is always visible** at 360px without
   scrolling on decision screens (accept, pay, confirm).
2. **Never dead-end.** Zero matches → share/invite path; payment failed →
   retry + what happens to the money; offline → cached Trips + Swap
   summary still render (docs/08).
3. **Trust is copy + timing**: pay only after acceptance, exact berths
   only after payment, "money held safely" during disputes — the UX
   *is* the trust model; wording changes are product changes.
4. **Local-first, sync-later**: PNR entry works signed out; sign-in is
   asked only at first send/accept (rule 8). Never move the sign-in wall
   earlier for implementation convenience.

## 6. Frontend

1. **The store is the single source of truth on-device** (`lib/store.ts`
   + `use-store.ts`); routes render from it, mutations go through it,
   `outbox.ts` queues what must reach the server, `job-sweep.ts` applies
   time-based rules. New features join this cycle; they do not fetch ad
   hoc.
2. **Route-level code splitting** for heavy, rarely-first screens
   (admin, on-board coach view). Budget: first-load JS of the Home route
   ≤ 200KB gzip — encode in `verify-dist.mjs` (docs/17 W6).
3. **Offline is a feature**: NetworkFirst for pages, precached shell,
   Trips + Swap summary readable in airplane mode. Any new screen that a
   passenger needs *on the train* must state its offline behaviour.
4. **PWA artefacts are verified at build time** (`verify-dist.mjs` reads
   the manifest, IHDRs, `sw.js`). Extend the verifier when you extend
   the manifest — a manifest claim without a verifier line is a future
   silent regression.

## 7. Backend

1. **RLS is the security boundary, server functions are convenience.**
   Every table: RLS on, explicit GRANTs, policies tested (docs/17 W1
   adds pgTAP-style policy tests). Never check admin on the client;
   `has_role()` security-definer only.
2. **`SERVICE_ROLE_KEY` lives in Cloudflare Worker secrets only.** Never
   in `VITE_*`, never in Azure, never in a file. The past defect —
   client keys listed as wrangler secrets — is the mirror image; keep
   the env classification table (docs/17 §Env) current.
3. **Every state transition writes `activity_log`** (agents.md
   conventions) — server-side, in the same transaction as the change.
4. **Webhooks: verify signature, then idempotency, then work.** Store
   processed event ids; a replayed webhook must be a no-op with a 200.
   Razorpay/PayPal will replay — this is normal, not an attack.
5. **Jobs are idempotent and observable.** Cron double-fires; a job run
   twice must change nothing the second time. Every run logs counts
   (rows expired, credits minted) to telemetry.
6. **The device job-sweep stays** after server cron ships — it is the
   degraded-mode path (docs/08: device is a system of record). Server
   and device applying the same rule must produce the same result.

## 8. Performance (Indian networks are the baseline)

1. Test on throttled 3G; interactive Home < 5s on 3G, < 2s on 4G.
2. Fonts: preload the two UI faces, `font-display: swap`, subset
   Devanagari.
3. Images/screenshots compressed at build; icons are the only raster
   assets the shell ships.
4. Telemetry flushes on idle/`visibilitychange`, never blocking render
   or navigation.
5. Match-board queries stay inside the `train_no + journey_date + class`
   shard (docs/12 §4); pagination ≤ 20 rows on phone screens.

## 9. Security & privacy

1. PII floor: other users see first name + initial, class, coach, berth
   *type* before payment; exact berths after payment only (rule 13).
2. `pnr_last4` is the only PNR form that leaves the device for ops
   tooling; full PNR never enters Zoho, PostHog, or Sentry
   (`scrubMeta` enforces; tests pin it).
3. Headers: CSP (self + Supabase + gateway checkout domains + PostHog/
   Sentry ingest), HSTS, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin` — shipped via the
   `_headers` file and asserted in `verify-dist` (docs/17 W7).
4. Admin routes render nothing sensitive before the server confirms
   `has_role('admin')`; the client check is UX, not security.
5. Payment amounts are computed server-side from the request row; the
   client never posts a price.

## 10. Shared tools across products (READ — this account hosts multiple products)

The same vendor accounts serve SeatSwap, SkipWait and future products.
The rule is **one org, one project per product**:

| Tool | Org/account | This product uses | Never |
|---|---|---|---|
| PostHog Cloud | org `skipwait` | project **`seatswap`** (own API key in `VITE_POSTHOG_KEY`) | Send events to another product's project |
| Sentry | org `skipwait` | project **`seatswap-web`** (own DSN) | Share a DSN between products |
| Cloudflare | one account, $10k credits | Worker `seatswap`, zone `toyoufromme.website` | Reuse another product's Worker/zone/KV namespace |
| Supabase | per-product **project** | project `seatswap` | One database for two products |
| Zoho | one wallet (§6 of docs/12) | Mail/Desk/Analytics tagged `SS-` | Mixing another product's tickets into SeatSwap views |
| Azure | student $200 + Startups $5k | RG `seatswap-exp-*` per docs/12 §3 | A shared RG across products |
| GitHub | one account, Student Pack | this repo's Actions minutes | — |

Conventions that make sharing safe:

1. **Names carry the product**: `seatswap-*` for every Worker, RG, Sentry
   project, PostHog project, KV namespace, queue, cron trigger.
2. **Keys are per-product**: a key minted for SeatSwap goes in this
   repo's deployment env only; record the *name* (never the value) in
   `docs/12` §8's key map.
3. **Credits are a shared pool — ledger every claim** in `docs/12` §2
   with the product that consumed it, so the other product's plan stays
   honest.
4. **Event taxonomies never merge**: SeatSwap events are prefixed by
   nothing (its own project is the namespace); if a tool forces one
   project, prefix `seatswap_` — but prefer separate projects.
5. **This docs pattern is the shareable asset**: when standing up a
   sibling product, copy `docs/11/13/14/16` and `agents.md` §0, then
   write product-specific `01–10`. Do not copy `docs/12` numbers — each
   product's ledger reflects what it may spend.
