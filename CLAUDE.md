# SeatSwap — read this first (all AI agents, all models)

This repo is shared by multiple coding agents on different models and
platforms. Follow `docs/11-COLLAB.md` + `docs/12-INFRA-CREDITS.md`.

1. Read `AGENTS.md` (product rules — never break), then
   `docs/01-PRD.md` … `docs/12-INFRA-CREDITS.md` in order.
2. `designs/*.jpg` is the visual reference; `AGENTS.md` wins on conflict.
3. Session start: `git pull --rebase`, `git status --short`, hot-file check
   `find app/src app/tests app/locales -newermt '-15 min' -type f`.
4. Infra: Cloudflare ($10k) serves `app/dist/client`, Supabase is the DB.
   No WorkOS. Azure $200 (exp Dec 16 2026) is burn-down only — see
   `docs/12-INFRA-CREDITS.md` + `app/azure/README.md`.
5. Green rule: `typecheck + test + build` must pass before commit.
   One topic per commit, never `git add -A`.
