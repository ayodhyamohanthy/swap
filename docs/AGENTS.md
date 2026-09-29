# AGENTS.md — Single Source of Truth

This is the ONLY instruction file. CLAUDE.md, GEMINI.md, .cursorrules and
all others are one-line pointers here. If any file contradicts this one,
this one wins and the other file is a bug — fix it.

## Read order (mandatory, before writing any code)
1. This file
2. docs/12-INFRA-CREDITS.md — infrastructure truth + vendor whitelist
3. docs/14-LANES.md — claim your lane before touching files
4. docs/10-BUILD-PLAN.md — find your next task

## Commands from Ayu
- "build" / "continue" → open docs/10-BUILD-PLAN.md, find the FIRST
  unchecked [ ] item in YOUR lane, implement it fully, check it off [x]
  in the same commit. Never start a checked item or another lane's item.
- If no unchecked item exists in your lane → say so and stop. Do not
  invent work.
- Ambiguity → make the smallest reasonable choice, record it in
  docs/DECISIONS.md (append-only), keep moving. Never stall on input.

## Definition of done — no partial credit
1. `npm run typecheck` clean
2. `npm run test` — full suite passes
3. `npm run build` — includes verify-dist, must be green
4. `npm run collab-check` clean
5. One topic per commit. NEVER `git add -A`. Subject ≥ 10 chars,
   form `feat(x): ...`, `fix(x): ...`, or `L#: ...`.

## Hard rules
- STACK IS FIXED: TanStack Start + React 19 + Vite + Tailwind v4,
  Supabase (DB/auth/realtime), Cloudflare (hosting/cron/queues/R2).
  Never swap, never add a database, never "migrate to" anything.
- VENDOR WHITELIST: only vendors marked WIRED in docs/12 §2 may appear
  in code, package.json, or config. RESERVE/BENCH vendors require Ayu
  moving the row to WIRED first. An agent never adds a vendor.
- NEVER build persistent infrastructure on expiring credits (docs/12 §0).
- Mobile-first PWA. /designs is truth for UI. Responsive at all widths.
- Privacy: pnr_hash + last4 only. PII never leaves the device
  (telemetry.ts scrubMeta). No emails/names/PNRs in logs or analytics.
- Data access goes through the query layer in app/src/lib/ — never
  scatter raw `supabase.` calls in components (keeps us portable).
- Naming for any new external resource: docs/15-NAMING.md
  (<app>-<surface>-<env>). App slug: `seatswap`.
- Env vars: add to app/.env.example in the same commit that introduces
  them, with a comment naming the vendor + where the value lives
  (docs/12 §8). Client-readable vars MUST be VITE_-prefixed. Worker
  secrets are NEVER readable by the client bundle — do not pretend
  otherwise (this bug already happened once).

## Disaster / exit thinking
- Nightly pg_dump → R2 is our insurance (docs/16-EXIT-PLAYBOOK.md).
  Never disable or "simplify away" the backup cron.
