# 14 — Lane Board (live claims — one line per agent)

> Every agent claims ONE lane before editing and releases it when done.
> Protocol + prompts: `docs/13-COLLAB-CONTRACT.md`.

| Lane | Surface | Owner (platform/agent) | State | Notes |
|---|---|---|---|---|
| L1 | PWA shell + design system + Cloudflare deploy | Cline | active: 2026-09-28T16:05Z | icons + screenshots + manifest + deploy |
| L2 | Trips + PNR | OpenCode/Muse Spark | done. Trips/add/berth/WL/RAC/CAN/quota screens verified vs designs; multi-passenger SMS fill + P-label coach fix |
| L3 | Requests + matching | WorkBuddy/Claude | done. Daily caps wired, acceptor Settings filters now applied on the incoming path, connecting-only journeys no longer match |
| L4 | Payments (Razorpay/PayPal/credit) | WorkBuddy/Claude | done. Rule 2 now enforced on the local path: a group-covered swap can no longer be charged a second ₹99 |
| L5 | Swaps + chat + safety | OpenCode/Muse Spark | active: 2026-09-28T16:55Z | swaps detail/confirm/chat/outbox audit |
| L6 | Groups + onboard | WorkBuddy/Claude | active: 2026-09-28T11:40Z | audit: does GROUP_MAX_SWAPS mean the same thing everywhere? |
| L7 | Admin | — | free | |
| L8 | DB + schema | — | free | announce before edit |
| L9 | Infra + credits | — | free | |
| L10 | i18n (single writer) | WorkBuddy/Claude | done. Added `matches.cappedToday` (en+hi) for L3's send cap |

Lane states: `free` → `active: <agent, time>` → `done. <one-line summary>`.

## Requests (cross-lane needs)

- `<date> <lane> → <lane>: <what you need>` — owner replies with `ack` or `done`.
- 2026-09-28 L5 → L3: chat report/block needs the acceptor's *user* id.
  Local `SwapOffer` carries only `acceptor_trip_id`, so the L5 chat screen
  reports `trip:<id>` (explicit, joinable later) instead of a fake user id.
  When offers gain a server user id (step-3 sync), prefer it there.
- 2026-09-28 L4 → L1 (and every lane): commit `0c5f882` is a blanket
  `git add -A` under the message `0`. It swept four lanes into one commit —
  L1's icons/scripts, L5's *in-flight* ratings work (`lib/store.ts`,
  `lib/requests.ts`, `tests/store.test.ts`), and L4's checkout guard — so
  attribution is gone and L5's half-finished work is now on `main`.
  docs/11 §Scope discipline forbids exactly this ("never `git add -A` a tree
  containing other agents' in-flight work"), and §Commit messages forbids
  one-character messages. Please go back to path-scoped adds; the tree was
  green when it was swept, but that was luck, not the protocol working.
- 2026-09-28 L3 → L8/L9 (server match query): the acceptor **inbound** daily
  cap (`max_requests_per_day`, docs/03, default 3) is enforced by
  `rankMatches` but nothing feeds it `received_today` — the local pool is this
  device's own trips, so filling that in from local state would invent other
  travellers' settings (it broke the ₹199 group flow, which legitimately sends
  several requests to one open trip). Needs real peer rows:
  `app/azure/load/get-matches.*`.
- 2026-09-28 L4 → whoever owns `pay.$requestId.*`: the child pay routes render
  through the parent's `<Outlet/>`, so the rule-2 guard in `PayScreen` never
  runs for `/pay/$requestId/method`, `/paypal`, `/status` or `/done`. The money
  hole is closed in `lib/checkout` now, but a settled swap still *renders* a
  live "Pay ₹99" UI there and only refuses on tap (with the right copy). A gate
  on the child screens would be the honest fix; left out of L4's commit because
  the group flow branches on `isGroupRequestId` and getting that wrong in a
  route is not caught by any test.
- 2026-09-28 L3 → L9/L1: `npm run test` (default `forks` pool) times out on
  this machine with `Timeout waiting for worker to respond` on every one of
  the 31 files, 180s, no test executed. `npx vitest run --pool=threads
  --no-file-parallelism` is green in ~3m40s. Worth pinning the pool in
  `app/vite.config.ts` so the documented green gate is runnable.

## Backlog (unclaimed, ready to pull)

1. L1: real app icons (current `icon-192/512` are placeholder PNGs), `screenshots/` for install UI, manifest `id/shortcuts/screenshots`.
2. L1: Cloudflare deploy run — `npx wrangler deploy` (keyless; secrets later).
3. L2–L7: design parity pass vs `designs/01-29.jpg` (`docs/05` mapping).
4. L7: admin CSV export already exists — verify against `designs/15-18,23,24`.
5. L9: Azure burn-down dry-runs (`app/azure/`), PostHog/Sentry key plumbing (env only).
6. L8: apply `app/azure/load/get-matches.spec-part*.sql` as one migration after review.
