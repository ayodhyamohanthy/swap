# 13 — Multi-Platform Collaboration Contract (MANDATORY for every AI platform)

> Purpose: many agents (Cline, Codex, Claude, Gemini, Copilot, Cursor,
> Windsurf, Aider, Muse) work this repo **at the same time**. Without
> ownership, two agents rebuild the same screen and lose work. This file
> assigns **one owner per surface** and gives copy-paste prompts.
> Read with `docs/11-COLLAB.md` (git discipline) and `docs/12-INFRA-CREDITS.md`.
> Infra rule: only student/startup-credit/free products. Never add a paid
> dependency (see §4).

## 1. Ownership map — one surface, one owner

Claim your lane in `docs/14-LANES.md` before you start. If your lane is
taken, pick an unclaimed one. **Never edit a file outside your lane** —
file a `docs/14-LANES.md` handoff note instead.

| Lane | Surface (routes/files) | Typical agent |
|---|---|---|
| L1 PWA shell + design system | `app/src/components/ui/**`, `app/src/components/app-shell.tsx`, `app/src/components/pwa*.tsx`, `app/src/styles.css`, `app/public/**`, `app/pwa.workbox.mjs`, `app/wrangler.toml` | Cline |
| L2 Trips + PNR | `routes/index`, `routes/trips.*`, `lib/pnr.ts`, `lib/store.ts` | Codex |
| L3 Requests + matching | `routes/request.*`, `routes/share.*`, `lib/requests.ts`, `lib/matching.ts` | Claude |
| L4 Payments | `routes/pay.*`, `server/payments*`, `server/razorpay-client.ts`, `server/paypal-client.ts`, `lib/payments.ts` | Gemini |
| L5 Swaps + chat + safety | `routes/swaps.*`, `routes/chat.*`, `lib/chat-guard.ts`, `lib/safety.ts`, `lib/outbox.ts` | Copilot |
| L6 Groups + onboard | `routes/groups.*`, `routes/onboard.*`, `lib/groups.ts` | Cursor |
| L7 Admin | `routes/admin.*`, `server/admin.ts`, `lib/admin.ts` | Windsurf |
| L8 DB + schema | `app/supabase/**`, `app/tests/schema.test.ts` | one agent at a time, announce first |
| L9 Infra + credits | `app/azure/**`, `docs/12-*`, `.github/workflows/**`, `app/scripts/**` | Aider |
| L10 i18n | `app/locales/**`, `lib/i18n.tsx` | **single writer only** |

Shared files (`package.json`, `routeTree.gen.ts`, `app/vite.config.ts`)
are **generated or additive-only**: run the build after touching routes and
commit the regenerated tree; never hand-edit.

Two more were unowned (flagged by L9, 2026-09-28) and are now assigned here:
`app/vitest.config.ts` follows L1, and `app/scripts/**` — the collab guard and
its installer — follows **L9**, because the guard is what enforces every other
lane's boundary.

That paragraph is prose the guard cannot read. `collab-check.mjs` parses only
the table above for surfaces, so it never enforced this assignment — L9's OWN
files were unclaimed as far as it was concerned, and an `app/scripts/**` edit
passed with no check at all. **2026-09-29 (L9, Cline): merged into the L9 row
above** — one surface added rather than one row, because `parseSurfaces` keys
by lane id and two rows for one id would silently drop one of them. The guard
now defends its own code.

**Narrowed 2026-09-29 (L4, via the pre-commit guard).** L1 previously owned the
whole of `app/src/components/**`, which swallowed every feature component too —
a new `app/src/components/pay-gate.tsx` was refused as L1's while L4 legitimately
owned the feature it served. L1 is now the shell: the `ui/` kit, the app shell,
the PWA components, and the tokens/public assets. Feature components are
**additive and belong to the lane that owns the feature**; if a lane needs a
change inside `components/ui/**` or `app-shell.tsx`, that is a `request:` to L1.
This is the guard working as intended: it caught a genuine cross-lane boundary
problem that prose alone had let through twice.

### Pre-commit guard (L9, live since 2026-09-29)

`app/scripts/collab-check.mjs` existed and was even named in the integration
prompt below, but nothing ran it on commit: `core.hooksPath` was unset and
`.git/hooks` held only the desktop app's `post-checkout`/`post-commit`. So the
protocol existed on paper. It is now wired:

```
npm run collab:install-hooks      # once per clone; local git config only
```

That activates two versioned hooks in `.githooks/`:

- `prepare-commit-msg` — refuses a subject that cannot attribute a change
  (empty, shorter than 10 chars, or neither `feat(pay): …` nor `L5: …`).
  This check is in `prepare-commit-msg` and **not** `pre-commit` because git
  writes `COMMIT_EDITMSG` only after `pre-commit` runs — a `pre-commit` read of
  the message sees the *previous* commit's subject. That was found by testing
  `git commit -m "0"`, which passed a naive hook.
- `pre-commit` — refuses a commit that contains a file belonging to a lane
  marked `active:` in `docs/14-LANES.md`, or a file written in the last 15
  minutes. Lanes and surfaces are parsed from `docs/14` + `docs/13` at run time,
  so the guard cannot drift from the board.

**One honest limit:** a hook cannot detect *which* `git add` spelling produced
the index — `git add -A` and a path-scoped add are byte-identical there. The
guard therefore checks the effect the protocol cares about (not committing
another live lane's files), not the command. The green rule stays in CI so a
commit is never blocked for minutes on a laptop.

## 2. Integration protocol (how lanes merge without conflicts)

1. **Announce** — write your lane + files in `docs/14-LANES.md` before the
   first edit (`active: <ISO time>`).
2. **Work only in your lane.** Need a change elsewhere? Add a `request:`
   line in `docs/14-LANES.md`; the owner does it.
3. **Commit small** — one topic per commit, path-scoped
   (`git add app/src/routes/request.*`), never `git add -A`.
4. **Green before push** — `typecheck` + full `test` + `build` (docs/11).
5. **Release the lane** — set `active: none`, add a one-line summary.
6. **Integrator pass** — whoever holds L1 (or the human) pulls, runs
   `npm run verify`, and fixes cross-lane wiring only.

Conflict rule: if two lanes touched the same file, the **lane owner of that
file keeps their version**; the other agent re-applies their change on top
and re-runs the suite. Never force-push, never revert another lane.

## 3. Ready-to-paste prompts

**Kickoff (send to each platform, replace the lane):**

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
Read in order: agents.md, docs/11-COLLAB.md, docs/12-INFRA-CREDITS.md,
docs/13-COLLAB-CONTRACT.md, docs/14-LANES.md.
You own LANE <Lx> — <surface>. First: git pull --rebase, git status --short,
hot-file check (find app/src app/tests app/locales -mmin -15 -type f).
Claim the lane in docs/14-LANES.md (active: now). Touch ONLY your lane's
files. Build keyless (no secret needed): npm run dev --workspace seatswap-app.
Before every commit: npm run typecheck, npm run test, npm run build.
Commit path-scoped, conventional message, one topic. Release the lane when done.
If you need a file outside your lane, write a `request:` line in
docs/14-LANES.md and stop. Never `git add -A`. Never add a paid dependency.
```

**Integration prompt (run once after lanes report done):**

```
npm run collab:install-hooks                # once per clone
git pull --rebase && git status --short
node app/scripts/collab-check.mjs          # hot files + generated + green
npm run typecheck --workspace seatswap-app
npm run test --workspace seatswap-app
npm run build --workspace seatswap-app     # includes verify-dist
Fix only cross-lane wiring (imports, route registration, env plumbing).
Do not rewrite another lane's logic — file a request instead.
Push only when all three gates are green.
```

**Design-parity prompt (designs/ vs build, docs/05 mapping):**

```
Compare designs/NN *.jpg against the route in docs/05-SCREENS.md for
LANE <Lx>. Fix layout/wording only inside your lane. AGENTS.md rules beat
the images. Banned words never appear. Report mismatches you cannot fix.
```

## 4. Spend rule (hard) + autonomy

Only use products with student/startup credits, free tiers, or free
access: Cloudflare ($10k), Supabase (free → Startup), Zoho wallet,
PostHog/Sentry startup credits, Mixpanel/Statsig backups, GitHub Pack.
**Never** introduce a paid dependency, SMS/OTP, or a paid OTP provider
(AGENTS.md 15).

**Standing approval (from the human, 2026-09-28):** when a change is free,
clearly better and meets the goals, decide it yourself — no permission
needed. Pick the better free/student-credit tool, refactor, add tests, pull
Backlog items, swap libraries inside your lane. Record the reason in the
commit message and, for a tool swap, in `docs/12-INFRA-CREDITS.md` §7.

Only escalate for: real money, paid products, non-free dependencies,
changes to `agents.md` non-negotiables, or another *active* lane's files
(`request:` line, then stop). CI (`.github/workflows/green.yml`) enforces
the gates on every push, so "continue" can never silently break `main`.


## 5. Definition of done for a lane

- Files only in your lane; lane entry released in `docs/14-LANES.md`.
- Keyless build works; keys stay optional.
- `typecheck` + `test` + `build` green.
- No banned words (`tests/copy.test.ts`), paise integers, `activity_log`
  on every transition, RLS intact.
- `designs/` parity for every screen in your lane (`docs/05`).
