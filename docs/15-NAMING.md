# 15 — Naming Convention (multi-app, shared orgs)

Pattern: <app>-<surface>-<env>. App slug for this repo: `seatswap`.
Shared orgs (skipwait etc.) host multiple apps — the slug prefix is how
we troubleshoot at 2am. A resource name alone must identify app, layer,
and environment.

- Cloudflare: workers seatswap-web-{prod,staging}, seatswap-backup-prod;
  queue seatswap-jobs-prod; KV seatswap-cache-prod; R2 seatswap-backups-prod
- Supabase: projects seatswap-prod, seatswap-staging. Never share a DB
  across apps.
- PostHog: one org, separate project per app → "SeatSwap"
- Sentry: projects seatswap-web, seatswap-worker; environment tag
  prod/staging
- Zoho: Desk department "SeatSwap", Analytics workspace "SeatSwap"
- Azure: RG <app>-<purpose>-<expiry> e.g. seatswap-exp-dec16
- GitHub: workflows named seatswap-ci
- Receipts: SS-##### (other apps get their own 2-letter prefix)
- Env vars: vendor-standard names in code; the org/project mapping
  lives ONLY in docs/12 §8.



