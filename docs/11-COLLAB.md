# 11 — Multi-Agent Collaboration Protocol

Several coding agents (different models, different platforms) work in this repo
at the same time. This file is mandatory preparation alongside docs/01-10.
Ignoring it has already caused lost work and red builds.

## Session start (every session, no exceptions)
1. `git pull --rebase` before touching anything.
2. `git status --short` — know what is uncommitted and whose it might be.
3. Hot-file check: `find app/src app/tests app/locales -newermt '-15 min' -type f`
   lists files another agent is editing RIGHT NOW. Do not touch them, do not
   rename them, do not delete them — even if they look like dead code or break
   your plan. Pick non-overlapping files or wait.

## Scope discipline
- One topic per commit. Never `git add -A` a tree containing other agents'
  in-flight work, and never commit files you did not author or verify.
- Untracked files belong to someone: leave `??` entries alone unless you
  created them. Never `git rm` a file another agent just wrote.
- If you must fix someone else's red code to unblock the tree, keep the fix
  minimal and type-only where possible, and say so in the commit message.

## Green rule
Commit only when ALL of these pass: `npm run typecheck`, `npm run test`
(full suite, workspace `seatswap-app`), `npm run build`. A red tree blocks
every agent, so a red commit is the worst possible commit.

## Commit messages
Descriptive, conventional, scoped — e.g.
`feat(pay): credit-use toggle threaded to checkout` or
`fix(schema): party check on confirmations insert`.
Never single-character or empty messages; future agents (and you) use history
to attribute files.

## Generated / mirrored files (always update together)
- `app/src/routeTree.gen.ts` regenerates on `vite dev`/`vite build`. Never
  hand-edit it; run the build and commit the result with the routes change.
- `app/supabase/schema.sql`, `app/supabase/migrations/20260925000000_init.sql`
  and `app/supabase/schema.part*.sql` must stay byte-consistent
  (`schema.sql` == concat of parts == migration). `tests/schema.test.ts`
  enforces part of this.
- `app/locales/en.json` + `hi.json` must keep identical key sets
  (`tests/locales.test.ts` enforces it; `t()` is strictly typed).

## Hard-won repo conventions (do not regress)
- Tests run under jsdom: Node builtins must come via
  `process.getBuiltinModule('node:…')`, never a bare `import 'node:…'`
  (Vite externalization mangles it). See `tests/setup.ts`.
- `validateSearch` with defaults makes `search` REQUIRED on every `<Link>`
  to that route — update all callers when you add one.
- Money is integer paise everywhere; every state transition writes an
  `activity_log` row; credit values are fixed per kind (5000/9900).
- Banned words and the exact dispute line are enforced by `tests/copy.test.ts`
  and `tests/locales.test.ts` — run the suite, don't guess.

## Conflict recovery
`git pull --rebase`, resolve, then re-run typecheck + tests + build before
committing. If two agents built the same feature differently, keep the one
that satisfies more of docs/01-10 and delete the orphan in the same commit.
