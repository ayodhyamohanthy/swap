# SeatSwap — read this first (all AI agents, all models)

This repo is shared by multiple coding agents on different models and
platforms. Follow `docs/11-COLLAB.md`, `docs/13-COLLAB-CONTRACT.md` and
`docs/14-LANES.md` (claim ONE lane before editing).

1. Read `AGENTS.md` (product rules — never break), then
   `docs/01-PRD.md` … `docs/14-LANES.md` in order.
2. `designs/*.jpg` is the visual reference; `AGENTS.md` wins on conflict.
3. Session start: `git pull --rebase`, `git status --short`, hot-file check
   `find app/src app/tests app/locales -mmin -15 -type f`.
4. Claim your lane in `docs/14-LANES.md`, touch only that lane's files.
   Need something outside it? Add a `request:` line and stop.
5. Infra: Cloudflare ($10k) serves `app/dist/client`, Supabase is the DB.
   No WorkOS. Azure $200 (exp Dec 16 2026) is burn-down only — see
   `docs/12-INFRA-CREDITS.md` + `app/azure/README.md`.
6. Only student/startup-credit or free products. Never add a paid
   dependency, SMS or paid OTP (AGENTS.md 15).
7. Green rule: `typecheck + test + build` (`npm run verify`) must pass before
   commit. One topic per commit, path-scoped, never `git add -A`.

