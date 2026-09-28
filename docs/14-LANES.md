# 14 — Lane Board (live claims — one line per agent)

> Every agent claims ONE lane before editing and releases it when done.
> Protocol + prompts: `docs/13-COLLAB-CONTRACT.md`.

| Lane | Surface | Owner (platform/agent) | State | Notes |
|---|---|---|---|---|
| L1 | PWA shell + design system + Cloudflare deploy | Cline | active: 2026-09-28T16:05Z | icons + screenshots + manifest + deploy |
| L2 | Trips + PNR | — | free | |
| L3 | Requests + matching | — | free | |
| L4 | Payments (Razorpay/PayPal/credit) | — | free | needs test keys |
| L5 | Swaps + chat + safety | — | free | |
| L6 | Groups + onboard | — | free | |
| L7 | Admin | — | free | |
| L8 | DB + schema | — | free | announce before edit |
| L9 | Infra + credits | — | free | |
| L10 | i18n (single writer) | — | free | 635 keys en+hi |

Lane states: `free` → `active: <agent, time>` → `done. <one-line summary>`.

## Requests (cross-lane needs)

- `<date> <lane> → <lane>: <what you need>` — owner replies with `ack` or `done`.

## Backlog (unclaimed, ready to pull)

1. L1: real app icons (current `icon-192/512` are placeholder PNGs), `screenshots/` for install UI, manifest `id/shortcuts/screenshots`.
2. L1: Cloudflare deploy run — `npx wrangler deploy` (keyless; secrets later).
3. L2–L7: design parity pass vs `designs/01-29.jpg` (`docs/05` mapping).
4. L7: admin CSV export already exists — verify against `designs/15-18,23,24`.
5. L9: Azure burn-down dry-runs (`app/azure/`), PostHog/Sentry key plumbing (env only).
6. L8: apply `app/azure/load/get-matches.spec-part*.sql` as one migration after review.
