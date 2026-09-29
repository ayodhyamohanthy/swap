# 16 — Exit Playbook (disaster recovery & vendor exit)

## Standing insurance
- Nightly: GitHub Actions workflow `seatswap-backup-prod`
  (.github/workflows/seatswap-backup.yml, cron 22:00 UTC = 03:30 IST)
  runs pg_dump of seatswap-prod → gzip → R2 bucket
  seatswap-backups-prod/seatswap-YYYY-MM-DD.sql.gz via the S3 API.
  (NOT a Cloudflare Worker — Workers cannot execute pg_dump.)
- Retention: 30 days via R2 lifecycle rule (set once in CF dashboard:
  bucket → Settings → Object lifecycle → delete after 30 days).
- Alert: ZeptoMail email to ALERT_EMAIL on any failed run; also enable
  GitHub's own workflow-failure notification.
- Quarterly drill: restore latest dump into seatswap-staging
  (`gunzip -c dump.sql.gz | psql $STAGING_DB_URL`); run the test suite
  against it. Log the drill in docs/DECISIONS.md.

## If Supabase becomes unviable
1. Restore latest R2 dump → Azure PostgreSQL Flexible Server (burst on
   Azure credits covers the transition window).
2. Point workers at the new DB (connection string via CF Hyperdrive).
3. Realtime: replace Supabase channels with polling first (ship fast),
   proper replacement later.
4. Auth is migrated LAST: export auth users via Supabase admin API;
   password-less Google OAuth re-links by email match.

Data at risk: max 24h. Code stays vanilla-Postgres-compatible because
all access goes through app/src/lib/ (AGENTS.md rule).

## If Cloudflare becomes unviable
Static PWA + workers redeploy to Azure Static Web Apps / Pages in a
disposable RG. DNS TTL kept at 300s to allow fast cutover.

## Never
- Never disable the backup workflow to "save minutes."
- Never store backups only inside the same vendor being backed up.
- Never commit SUPABASE_DB_URL or R2 keys — GH Actions secrets only.



