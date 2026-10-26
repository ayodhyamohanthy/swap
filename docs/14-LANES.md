# 14 — Lane Board (live claims — one line per agent)

> Every agent claims ONE lane before editing and releases it when done.
> Protocol + prompts: `docs/13-COLLAB-CONTRACT.md`.

> **History note (W8.1, 2026-10-26):** the per-lane done-prose, the resolved
> cross-lane requests and the original backlog text moved verbatim to
> `docs/14-LANES-ARCHIVE.md`. The board below keeps one line per lane plus
> live state, the standing requests as one-liners, and the backlog compressed
> to one line per item with its recorded status.

| Lane | Surface | Owner (platform/agent) | State | Notes |
|---|---|---|---|---|

| L1 | PWA shell + design system + Cloudflare deploy | Cline | done. | PWA shell, design system, keyless Cloudflare deploy live (seatswap.ayodhya-711.workers.dev); manifest id/shortcuts/screenshots, real captures and dist/cf staging all guarded in verify-dist. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L2 | Trips + PNR | OpenCode/Muse Spark | done. | Trips + PNR screens verified against the designs by capture; Home branches by state; branch order and strapline guarded in tests/qa-layout-offline. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L3 | Requests + matching | WorkBuddy/Claude | done. | Matching + share: splitTrainDate()/inviteLink() fix the invite's date truncation, share.message is the outbound copy, matches_viewed instrumented and capped. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L4 | Payments (Razorpay/PayPal/credit) | Pixel Canary/Claude | done. | Pay-screen parity (8 screens captured), pay gates unified as payGateFor() in lib/checkout.ts, receipt total derived from its lines; guards mutation-checked. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L5 | Swaps + chat + safety | OpenCode/Muse Spark | done. | Swap done events + confirm/cancel/ratings persistence, chat report parties, real-row receipts, guard hardening; guards in tests/swap-done-event. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L6 | Groups + onboard | Pixel Canary/Claude | done. | Groups: /groups list + create reachable from Profile, together count by heads not tickets, one group per trip, coach map drawn from real berth numbers. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L7 | Admin | Pixel Canary/Claude | done. | Admin: overview tiles/week chart/first-on-train donut, activity log chips + human labels + bounded details + timeline panel, reports table with allow-listed issues. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L8 | DB + schema | WorkBuddy/Claude | done. | Schema contracts pinned (17 tests); get_matches() reviewed, its two open questions resolved; together_seats finding filed and fixed. (full history: `docs/14-LANES-ARCHIVE.md`) |
| L9 | Infra + credits | Buffy, 2026-09-29T18:46Z | done. | Scaffolding guarded (backup-workflow tests, CI green). Keys pending: 6 GH secrets + staging project + lifecycle rule + domain claim (items 2-4 open). (full history: `docs/14-LANES-ARCHIVE.md`) |
| L10 | i18n (single writer) | Pixel Canary/Claude | done. | i18n single writer: admin/share/onboard/reports key sets in en+hi; the brief-claim pattern is recorded as structural, not occasional. (full history: `docs/14-LANES-ARCHIVE.md`) |

Lane states: `free` → `active: <agent, time>` → `done. <one-line summary>`.

## Forge local-only claim (2026-10-16)

L3 is released by Forge on this isolated branch only. Narrow server-boundary repair in the otherwise unassigned `app/src/server/functions.ts` plus `app/tests/server-state.test.ts`: configured-backend missing/unreadable rows must never reuse caller-supplied state, and group payment/cap reads must fail closed. No UI, schema, dependencies, deployment or push. Offline fallback is preserved. Baseline gates passed (959 tests, typecheck, build, collab-check). Repair reproduced seven failures before the fix; all eight new regressions and the full 967-test suite now pass, plus typecheck/build.

## Integration authorization (Forge, 2026-10-16)

The owner subsequently authorized a direct `main` push of the verified repair. The earlier local-only/no-push wording records the original scope only. Rebased onto `fa745c6` without conflicts; rerunning typecheck, full tests, build and collaboration checks before a normal fast-forward push.

## Requests (cross-lane needs)

- `<date> <lane> → <lane>: <what you need>` — owner replies with `ack` or `done`. Full text of every request (resolved ones included): `docs/14-LANES-ARCHIVE.md`.
- OPEN 2026-09-29 L4 → L9: assign `lib/money.ts`, `lib/checkout.ts` and `lib/use-store.ts` to a lane. All three are load-bearing for payments, none is on the ownership map, and L4 had to change `money.ts` because no lane owned it.
- Advisory: a stale working-tree buffer can silently revert committed board work. Read the file immediately before writing it, and compose offline from `git show HEAD:<path>` via `git hash-object` + `git update-index --cacheinfo`, never from a whole-file buffer held across other agents' commits.
- Advisory: a path-scoped commit of `docs/14-LANES.md` takes the working tree for that path, so it can sweep a neighbour's uncommitted board lines. Commit the board in its own commit immediately after the edit, or build the blob from HEAD.
- Advisory: the sandbox's SAFE_DELETE bulk-confirm can fail the second build in a turn (`vite:prepare-out-dir`). `mv app/dist` aside before rebuilding, check the suite's file count against `ls app/tests/*.test.*` and the SAFE_DELETE marker before believing a red run, and run the gates at `--maxWorkers=2`.
- Advisory: a green test suite is not green typecheck. Vitest transpiles without checking, so `npm run typecheck` is the only gate that catches TS errors in test files.
- 2026-09-28 L8 → recorded: `together_seats` was never populated, so docs/08's "keep-together fit 10" could not fire; fixed (the local mirror carries both target columns, guarded in tests/matching and tests/schema).

## Backlog (unclaimed, ready to pull)

One line per item; original text in the archive. Struck items are done.

1. ~~L1: real app icons, `screenshots/` for install UI, manifest `id/shortcuts/screenshots`.~~ done (L1).
2. ~~L1: Cloudflare deploy run (`npx wrangler deploy`, keyless).~~ done (L1), live.
3. ~~L2-L7: design parity pass vs `designs/01-29.jpg` (`docs/05` mapping).~~ CLOSED (L4); per-screen results live in the lane rows.
4. L7: admin design parity vs `designs/15-18,23,24` — partly done (L7 + L10): designs 15/17/18/23/24 are built per the L7 row; remaining screens when the designs exist.
5. ~~L9: Azure burn-down dry-runs (`app/azure/`), PostHog/Sentry key plumbing (env only).~~ done (L9), both halves.
6. L8: `get_matches()` is the only path by which matching can ever work — reviewed, still not applied (needs W1 keys).
7. L7: design 15's activity log — categorised filter done; chips, human labels and the bounded details allow-list all shipped per the L7 row.
8. ~~L7 + L3: design 23's "Swaps this week" chart and the "First on their train today" donut.~~ done (L7), both built.
9. ~~`together_seats` is never populated, so docs/08's "keep-together fit 10" is a score component that cannot fire.~~ RESOLVED.

## Swap isolated staging runtime (2026-10-16)

L9 released: Kat staging agent, 2026-10-16. Readiness-only runtime and exact-target guard complete; 1008 tests/typecheck/build/collaboration checks passed. Owner-authorized narrow deployment task: app/scripts/swap-staging-deploy.mjs, app/scripts/swap-staging-deploy.d.mts, app/wrangler.staging.json, app/src/staging-worker.ts, app/tests/swap-staging.test.ts and docs/cloudflare.md. No edits to existing Worker/router, frontend, Supabase schema or production config. New runtime is readiness-only and fails closed until backend dependencies and executors are verified.
