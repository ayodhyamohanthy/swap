# 15 — Naming Convention (multi-app, shared orgs)

Pattern: <app>-<surface>-<env>. App slug for this repo: `seatswap`.
Shared orgs (skipwait etc.) host multiple apps — the slug prefix is how
we troubleshoot at 2am. A resource name alone must identify app, layer,
and environment.

- Cloudflare: workers `seatswap` — the name `app/wrangler.toml` actually
  deploys, and the one serving https://seatswap.ayodhya-711.workers.dev.
  docs/12 §4 and this line previously named `seatswap-web-{prod,staging}` as
  the intended prod/staging pair; see "Open divergences" below. Queue
  `seatswap-jobs-prod`; KV `seatswap-cache-prod`; R2 bucket
  `seatswap-backups-prod` (the nightly backup destination, docs/12 §5).
- Supabase: projects seatswap-prod, seatswap-staging. Never share a DB
  across apps.
- PostHog: one org, separate project per app → "SeatSwap"
- Sentry: projects seatswap-web, seatswap-worker; environment tag
  prod/staging
- Zoho: Desk department "SeatSwap", Analytics workspace "SeatSwap"
- Azure: RG <app>-<purpose>-<expiry> e.g. seatswap-exp-dec16
- GitHub: workflows `green` (CI) and `seatswap-backup-prod` (the nightly
  pg_dump, docs/12 §5). Both are the `name:` in the file, not the filename.
- Receipts: SS-##### (other apps get their own 2-letter prefix)
- Env vars: vendor-standard names in code; the org/project mapping
  lives ONLY in docs/12 §8.

## Corrections, 2026-10-03 (L3)

Requested 2026-09-30 by L9 and addressed to "whoever owns docs/15-NAMING.md" —
which is nobody, since this file is in no lane's surface (docs/13 §1). Three
days later it was still open and still addressed to nobody, so re-filing it was
not progress. Each claim was checked against the artefact that would have to
agree with it, not against the sentence next to it.

1. **`seatswap-backup-prod` was filed as a Cloudflare worker.** It is not one
   and must not be: `.github/workflows/seatswap-backup.yml` carries
   `name: seatswap-backup-prod`, and docs/12 §1 says backups are "NOT a
   Cloudflare Worker — Workers cannot execute the pg_dump binary". So the one
   name in that list which cannot be a worker was listed as one, and anyone
   provisioning from this doc would have gone looking for a worker that must
   not exist. Moved to the GitHub line, where it is the workflow.
2. **"GitHub: workflows named `seatswap-ci`" named a workflow that has never
   existed.** The two workflows are `green` and `seatswap-backup-prod`. The
   same wrong name appears in docs/10 item 1. `green.yml` was deliberately NOT
   renamed to match: a required status check is keyed on the reported check
   name, so matching the docs could silently stop a merge gate from being
   satisfiable. **The docs follow the workflow here, not the other way round.**
3. **Checked and found correct, so left alone:** `SS-#####` matches
   `receiptNumber()` (`app/src/lib/payments.ts:239`, `` `SS-${n}` ``, comment
   naming `SS-10482`); the Supabase pair, the PostHog/Zoho org names, the Azure
   `<app>-<purpose>-<expiry>` shape and the docs/12 §8 pointer are all
   consistent with the files that hold them.

## Open divergences — recorded, not resolved

**The deployed worker is `seatswap`; two documents name `seatswap-web-{prod,staging}`.**
`app/wrangler.toml:5` is `name = "seatswap"`, and that is what serves the live
URL, while docs/12 §4's environment table and this file's Cloudflare line name
the `-web-{env}` pair. These are not necessarily in conflict — the shipped
deploy is keyless and may be a placeholder ahead of a named prod/staging pair —
but nothing in the repo says which, so the difference is written down here
rather than silently harmonised. **Not resolved here because renaming a worker
changes its public URL**, which is L1's surface (`app/wrangler.toml`) and
touches the domain work in docs/12 §4.1. Note also that `seatswap-web` is
already the name of the **Sentry project** (docs/12 §8, docs/16:187,
docs/17:139), so the `-web` surface reads differently depending on the vendor —
which is exactly the ambiguity `<app>-<surface>-<env>` exists to prevent.
