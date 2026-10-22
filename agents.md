# AGENTS.md — Single Source of Truth

This is the ONLY instruction file. CLAUDE.md, GEMINI.md, .cursorrules and
all others are one-line pointers here. If any file contradicts this one,
this one wins and the other file is a bug — fix it.

## Read order (mandatory, before writing any code)
1. This file
2. docs/12-INFRA-CREDITS.md — infrastructure truth + vendor whitelist
3. docs/14-LANES.md — claim your lane before touching files
4. docs/10-BUILD-PLAN.md — find your next task

Collision check (mandatory, before touching files — another agent may be
mid-edit): `find app/src app/tests app/locales -mmin -15 -type f` (BSD-safe
form; never `-newermt`, which macOS `find` rejects and which fails silent
by listing nothing).

## Commands from Ayu
- "build" / "continue" → open docs/10-BUILD-PLAN.md, find the FIRST
  unchecked [ ] item in YOUR lane, implement it fully, check it off [x]
  in the same commit. Never start a checked item or another lane's item.
- If no unchecked item exists in your lane → say so and stop. Do not
  invent work.
- Ambiguity → make the smallest reasonable choice, record it in
  docs/DECISIONS.md (append-only), keep moving. Never stall on input.

## Founder standing rules (Ayu, Oct 16 2026)
1. SESSION-START SYNC: at the start of every session, before acting, read
   the founder's decisions and rules for this project: this file (Hard
   rules + this section), docs/DECISIONS.md (append-only log), and the
   vendor whitelist (docs/12 §2). The whole team stays in sync on
   decisions; nobody acts on a stale picture of them.
2. MERITOCRACY: if you see a better approach than a recorded decision,
   always recommend it, with evidence — and ask Ayu. He takes the call.
   Never override a recorded decision on your own.
3. CURRENT DECISIONS LIST: this file's Hard rules + this section +
   docs/DECISIONS.md are the live list. When Ayu rules on something new,
   record it here (or append to DECISIONS.md) in the same commit that
   acts on it.
4. PROOF, NOT WORDS (Ayu, Oct 22 2026: "don't give me a word, give me
   some kind of proof" -> "Make this as a rule"): nothing is reported
   done, ready, fixed or verified without proof Ayu can see - a
   screenshot, or log/output from a real test run, attached to the
   handover. A claim without proof is labeled UNVERIFIED, never
   presented as done.
5. FULLSTACK VERIFICATION WITH TEST ACCOUNTS (Ayu, Oct 22 2026: "Test
   and verify every time if something is stating done. Always verify
   fullstack. Make this as an instruction."): before calling anything
   done, run the real flow end to end - UI, API, data and the deploy -
   signing in with the shared test accounts, and attach the proof
   (rule 4). Test-account usernames and a vault-item pointer live in
   this file / DECISIONS.md once the accounts are proven; PASSWORDS
   NEVER go into the repo or chat - agents fetch them from the vault.
6. TIDY BRANCHES (Ayu, Oct 22 2026: "just have only working branches,
   once done it should be merged" + "repo should be tidy"): work on a
   branch, merge it, delete it. After every PR merges, delete the
   branch (record its name + tip SHA in docs/DECISIONS.md first).
   Unmerged branches with unique work are escalated to Ayu, never
   deleted unilaterally.

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
- MONEY RULE (Ayu, Oct 16 2026): never choose money-spending options.
  Choose free or money-earning options only. Paid plans/add-ons are
  dropped, not proposed as defaults. If a task seems to require spend,
  that is a blocker: report it with a free or earning alternative.
- MOBILE-FIRST is a contract, not a preference: docs/17-MOBILE-FIRST.md.
  360px baseline, 44px touch targets, 16px inputs, safe-area insets,
  ≤200KB gz initial JS. /designs is truth for UI. A screen that only
  works on desktop is a failed task.
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
- Nightly pg_dump → R2 via the GitHub Actions workflow
  seatswap-backup.yml is our insurance (docs/16-EXIT-PLAYBOOK.md).
  Never disable or "simplify away" the backup workflow.



