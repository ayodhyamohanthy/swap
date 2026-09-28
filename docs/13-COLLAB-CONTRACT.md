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
| L1 PWA shell + design system | `app/src/components/**`, `app/src/styles.css`, `app/public/**`, `app/pwa.workbox.mjs`, `app/wrangler.toml` | Cline |
| L2 Trips + PNR | `routes/index`, `routes/trips.*`, `lib/pnr.ts`, `lib/store.ts` | Codex |
| L3 Requests + matching | `routes/request.*`, `routes/share.*`, `lib/requests.ts`, `lib/matching.ts` | Claude |
| L4 Payments | `routes/pay.*`, `server/payments*`, `server/razorpay-client.ts`, `server/paypal-client.ts`, `lib/payments.ts` | Gemini |
| L5 Swaps + chat + safety | `routes/swaps.*`, `routes/chat.*`, `lib/chat-guard.ts`, `lib/safety.ts`, `lib/outbox.ts` | Copilot |
| L6 Groups + onboard | `routes/groups.*`, `routes/onboard.*`, `lib/groups.ts` | Cursor |
| L7 Admin | `routes/admin.*`, `server/admin.ts`, `lib/admin.ts` | Windsurf |
| L8 DB + schema | `app/supabase/**`, `app/tests/schema.test.ts` | one agent at a time, announce first |
| L9 Infra + credits | `app/azure/**`, `docs/12-*`, `.github/workflows/**` | Aider |
| L10 i18n | `app/locales/**`, `lib/i18n.tsx` | **single writer only** |

Shared files (`package.json`, `routeTree.gen.ts`, `app/vite.config.ts`)
are **generated or additive-only**: run the build after touching routes and
commit the regenerated tree; never hand-edit.

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
hot-file check (find app/src app/tests app/locales -newermt '-15 min' -type f).
Claim the lane in docs/14-LANES.md (active: now). Touch ONLY your lane's
files. Build keyless (no secret needed): npm run dev --workspace seatswap-app.
Before every commit: npm run typecheck, npm run test, npm run build.
Commit path-scoped, conventional message, one topic. Release the lane when done.
If you need a file outside your lane, write a `request:` line in
docs/14-LANES.md and stop. Never `git add -A`. Never add a paid dependency.
```

**Integration prompt (run once after lanes report done):**

```
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

## 4. Spend rule (hard)

Only use products with student/startup credits, free tiers, or free
access: Cloudflare ($10k), Supabase (free → Startup), Zoho wallet,
PostHog/Sentry startup credits, Mixpanel/Statsig backups, GitHub Pack.
**Never** introduce a paid dependency, SMS/OTP, or a paid OTP provider
(AGENTS.md 15). Needs a new tool? Propose it in `docs/14-LANES.md` with its
free/credit terms from `docs/12-INFRA-CREDITS.md` first.

## 5. Definition of done for a lane

- Files only in your lane; lane entry released in `docs/14-LANES.md`.
- Keyless build works; keys stay optional.
- `typecheck` + `test` + `build` green.
- No banned words (`tests/copy.test.ts`), paise integers, `activity_log`
  on every transition, RLS intact.
- `designs/` parity for every screen in your lane (`docs/05`).
