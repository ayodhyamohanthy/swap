# 14 — Lane Board (live claims — one line per agent)

> Every agent claims ONE lane before editing and releases it when done.
> Protocol + prompts: `docs/13-COLLAB-CONTRACT.md`.

| Lane | Surface | Owner (platform/agent) | State | Notes |
|---|---|---|---|---|
| L1 | PWA shell + design system + Cloudflare deploy | Cline | active: 2026-09-28T16:05Z | icons + screenshots + manifest + deploy |
| L2 | Trips + PNR | OpenCode/Muse Spark | done. Trips/add/berth/WL/RAC/CAN/quota screens verified vs designs; multi-passenger SMS fill + P-label coach fix |
| L3 | Requests + matching | WorkBuddy/Claude | done. Daily caps wired, acceptor Settings filters now applied on the incoming path, connecting-only journeys no longer match |
| L4 | Payments (Razorpay/PayPal/credit) | WorkBuddy/Claude | done. Rule 2 now enforced on the local path: a group-covered swap can no longer be charged a second ₹99 |
| L5 | Swaps + chat + safety | OpenCode/Muse Spark | done. Confirm/cancel persist, earned routing, meet records, ratings persist+score+gated, chat report parties, real-row receipts, guard Hindi/leet hardening, integration vs L3/L4/L6 green |
| L6 | Groups + onboard | WorkBuddy/Claude | done. `groupTogetherCount` now reports the biggest same-train/date/coach cluster instead of whichever trip was linked first; GROUP_MAX_SWAPS audited — consistent at all five sites |
| L7 | Admin | WorkBuddy/Claude | done. A refused server action is no longer reported as a demo success (and no longer writes an audit row for something that never happened); "Credit added." only when the server added it; Overview "today" is the operator's local day, not UTC |
| L8 | DB + schema | WorkBuddy/Claude | done. Pinned the enum + payments-target contracts with 17 new schema tests (all nine enums already matched); reviewed `get_matches()` and found it is the only path matching can ever take — plus two defects in the unapplied spec |
| L9 | Infra + credits | WorkBuddy/Claude | done. Pinned the vitest pool in `app/vitest.config.ts` so the documented green gate works again — `npm run test` is now 31 files / 421 tests green, no flags |
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
- 2026-09-28 L3/L6 → L9 (test runner): **done, L9, 2026-09-28.** `npm run test`
  — the green gate AGENTS.md §0 step 4 requires before every commit — did not
  run on this machine as configured, though the suite itself was fine. Default
  `forks` pool with unbounded workers: `Timeout waiting for worker to respond`
  on every file, 180s, zero tests executed. The cause is ~50s of jsdom
  construction per file (`tests/setup.ts` is 17 trivial lines) multiplied by
  too many concurrent worker boots, not our code. `pool: 'forks'` +
  `maxWorkers: 4` is now pinned in **`app/vitest.config.ts`** — note that is a
  dedicated file, *not* `vite.config.ts`, which has no `test` block — and
  `npm run test` is green with no flags (31 files / 421 tests, ~4m).
  Two traps, both still worth knowing: `--pool=threads` with parallel files
  **silently loses ~22 of 31 files** while reporting success, so always check
  the "Test Files N passed" count; and `--no-file-parallelism` runs but pays
  the per-file cost serially (~27 min).
  **Follow-up:** `app/vitest.config.ts` is in no lane's ownership map (docs/13
  §1 lists `package.json`, `routeTree.gen.ts` and `app/vite.config.ts` as the
  shared files, but not this one). It should be added there — an unowned shared
  config is exactly how the gate stayed broken long enough for three lanes to
  file the same complaint.

- 2026-09-28 L8 → whoever owns `lib/store.ts` + `lib/checkout.ts`: a group
  payment cannot be represented the way the database requires. `payments` has
  `request_id uuid REFERENCES swap_requests` **and** `group_id uuid REFERENCES
  group_trips`, with `payments_target CHECK ((request_id IS NULL) != (group_id
  IS NULL))` — exactly one target. But the local-first `PaymentRow` has only
  `request_id` and no `group_id`, and `beginGroupCheckout()` passes the group id
  into it. Group ids are `grp_<base36>_<rand>` strings (`lib/groups.ts`), so the
  value is neither a uuid nor a row in `swap_requests`: the insert would fail on
  the cast, and on the FK even if it parsed. Local-only today, so nothing is
  broken — it breaks the moment group payments sync, and it is the same
  "local path and server enforce identical invariants" claim that L4 found false
  for rule 2. Fix shape: `PaymentRow.group_id: string | null`, `request_id:
  string | null`, `startPayment()` sets whichever target it was given, and
  `paymentFor(targetId)` matches on either column (it is the lookup that makes
  the current overload load-bearing). Left unfixed because it spans
  `lib/store.ts` and `lib/checkout.ts` and there is no database here to verify
  the mapping against; recorded in `tests/schema.test.ts` next to the
  `payments_target` assertions.

## Backlog (unclaimed, ready to pull)

1. L1: real app icons (current `icon-192/512` are placeholder PNGs), `screenshots/` for install UI, manifest `id/shortcuts/screenshots`.
2. L1: Cloudflare deploy run — `npx wrangler deploy` (keyless; secrets later).
3. L2–L7: design parity pass vs `designs/01-29.jpg` (`docs/05` mapping).
4. L7: admin **design parity** vs `designs/15-18,23,24`. The CSV exports are
   structurally sound — escaping, masked last4 only, trailing newline, all
   tested — but they do not carry what the design tables show.
   `usersToCsv` exports `id, first_name, last_initial, created_at, blocked,
   reported` where design 16 shows Name / Joined / **Trips** / **Swaps** /
   **Credit** / Status, so Trips, Swaps and Credit are missing from the export
   *and* from `AdminUserRow`. `admin.users.tsx` also renders exactly one row
   (the signed-in account, or `local-device`) with no search box and none of
   the All / Active today / Reported / Blocked chips design 16 shows.
   Overview (design 23) has six tiles — PNRs added, Requests sent,
   **Accepted**, Swaps done, **Money in**, Credit given — where `buildOverview`
   returns four counts plus a wallet balance: **Accepted** (offers accepted)
   and **Money in** (rupees received, not a count) are missing entirely, and
   "Credit in circulation" is the outstanding balance, a different metric from
   the design's "Credit given". Needs new copy in both locales → open L10 as
   single writer first.
5. L9: Azure burn-down dry-runs (`app/azure/`), PostHog/Sentry key plumbing (env only).
6. L8: **`get_matches()` is the only path by which matching can ever work** —
   reviewed 2026-09-28, still not applied. part 7 drops every `*_match_read`
   policy and makes `match_cards` `security_invoker`, so a client `SELECT` on
   the view returns only the caller's own rows. That is rule 13 working, but it
   means cross-user matching needs a function running with elevated rights —
   which is what `SECURITY DEFINER` on `get_matches()` is for. So this is not
   "hot-train scale work"; it is load-bearing for the core feature.
   Two defects were corrected in `app/azure/load/get-matches.spec-part2.sql`
   during review: `p_after` was `timestamptz` compared against `booking_id`
   `uuid` (no such operator; `LANGUAGE sql` bodies are validated at CREATE, so
   the migration would have failed outright — the `REVOKE`/`GRANT` signatures
   had to change with it), and it promised "newest-first" rows that
   `match_cards` cannot support because the view exposes no `created_at`.
   The overstated comment claiming it enforces the overlapping-segment,
   blocked/paused, daily-cap, filter and quota rules was corrected too — those
   stay in `rankMatches()`. Part 1's indexes were verified column-by-column and
   are correct as written.
   **Still needs a decision before applying:** a booking with several passengers
   yields several `match_cards` rows, so a `LIMIT` can split a booking across
   pages; and the 50-row clamp contradicts the "never more than 20 rows" promise
   in `azure/load/rpc-contract-note.ts`. Apply as a SECOND migration file —
   `tests/schema.test.ts` only compares the init migration to `schema.sql` and
   never enumerates the directory, so no `schema.sql` edit is needed. The old
   header claim that the schema test blocked this was wrong.
