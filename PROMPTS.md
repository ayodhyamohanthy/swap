# PROMPTS.md — the only prompt you need

> The human does nothing but say **"start"** or **"continue"**.
> `agents.md` §0 tells every model to find the project state, pick a free
> lane from `docs/14-LANES.md`, claim it, build, and release it.
> You never pick lanes, never name files, never explain the rules.

**Standing auto-approval (2026-09-28): models do not ask permission.** If a
choice is free, better and meets the goals — better free/student-credit tool,
refactor, extra tests, next Backlog item — the model just does it and notes
the reason in the commit. They only escalate for real money, paid products,
non-free dependencies, `agents.md` non-negotiables, or another active lane's
files. CI (`.github/workflows/green.yml`) blocks a red push.

## Say this to any AI coding platform

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
start
```

or, on a second session:

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
continue
```

That's it. `agents.md` §0 is the bootstrap: pull, hot-file check, read
`docs/14-LANES.md`, claim the first free lane, read `docs/11`–`13`, work only
in that lane, run the three gates, mark `done`, repeat.

## If a platform needs a little more (2 lines max)

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
Read agents.md §0 and follow it exactly. Claim one free lane in docs/14-LANES.md.
```

## What happens automatically (so you can trust it)

| Step | Where it's written | Who does it |
|---|---|---|
| Pull + hot-file check | `agents.md` §0.1, `docs/11` | the model |
| Pick + claim a lane | `agents.md` §0.2, `docs/14-LANES.md` | the model |
| Read rules for its lane | `docs/11`/`12`/`13`, `docs/05`→`designs/` | the model |
| Build keyless, keys later | `docs/12` §8, `wrangler.toml` | the model |
| Three gates before commit | `agents.md` §0.4, `docs/13` §5 | the model |
| Release the lane + summary | `docs/13` §2.5, `docs/14-LANES.md` | the model |
| Integration once lanes report done | `PROMPTS.md` §3 (you run it) | you or L1 owner |

## Your only jobs

1. Paste `start` / `continue` to each platform (one lane per platform happens
   automatically — the board prevents overlap).
2. When a platform reports `done`, paste the integration prompt (§3 below) once.
3. Nothing else. No lane picking, no file lists, no rule reminders.

---

## §3. Integration prompt (paste once after lanes report `done`)

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
Read docs/13-COLLAB-CONTRACT.md §2.6. Act as integrator only:
git pull --rebase && git status --short
node app/scripts/collab-check.mjs
npm run typecheck --workspace seatswap-app
npm run test --workspace seatswap-app
npm run build --workspace seatswap-app
Fix cross-lane wiring only (imports, route registration, env plumbing), never
another lane's logic — file a `request:` line in docs/14-LANES.md instead.
Push when all gates are green.
```


## Lane cheat-sheet (fill the blank)

| Lane | Give this prompt to | Lanes free today |
|---|---|---|
| L1 PWA shell + design system + Cloudflare | Cline | check `docs/14-LANES.md` |
| L2 Trips + PNR | Codex | |
| L3 Requests + matching | Claude | |
| L4 Payments | Gemini | |
| L5 Swaps + chat + safety | Copilot | |
| L6 Groups + onboard | Cursor | |
| L7 Admin | Windsurf | |
| L8 DB + schema (announce first) | one agent only | |
| L9 Infra + credits | Aider | |
| L10 i18n (single writer) | one agent only | |

---

## 1. Kickoff prompt (send to EVERY platform — replace `<Lx>` and `<what you own>`)

```
You are working in the shared SeatSwap repo:
/Users/ayodhyarammohanthy/Documents/GitHub/swap

Read these files in this order before writing any code:
1. agents.md
2. docs/11-COLLAB.md          (git discipline)
3. docs/12-INFRA-CREDITS.md   (stack + credit/free-only spend rule)
4. docs/13-COLLAB-CONTRACT.md (lane rules)
5. docs/14-LANES.md           (who owns what right now)

YOU OWN LANE <Lx> — <what you own>.
Do NOT edit any file outside this lane. If you need one, add a
`request: <date> <Lx> → <target lane>: <need>` line in docs/14-LANES.md and stop.

Do this first:
  git pull --rebase
  git status --short
  find app/src app/tests app/locales -mmin -15 -type f   # hot files
  node app/scripts/collab-check.mjs --fast
Then claim your lane: in docs/14-LANES.md set state to
  active: <platform name>, <time>

Build with no keys (local-first; keys come later):
  npm run dev --workspace seatswap-app

Match the design images in designs/ against the route map in docs/05-SCREENS.md.
agents.md rules beat the images. Never use banned words (agents.md 10).

Before every commit (all three must pass):
  npm run typecheck --workspace seatswap-app
  npm run test --workspace seatswap-app
  npm run build --workspace seatswap-app

Commit rules: path-scoped `git add <your lane files>`, one topic per commit,
conventional message. NEVER `git add -A`. Never force-push. Never edit another
lane's files. Only free / student / startup-credit products — never add a paid
dependency, SMS or paid OTP.

When finished: set your lane state to `done. <one-line summary>` in
docs/14-LANES.md and report exactly which files you changed.
```

---

## 2. Integration prompt (run after a lane says `done`)

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
Role: integrator. Do NOT rewrite any lane's logic.

  git pull --rebase
  git status --short
  node app/scripts/collab-check.mjs
  npm run typecheck --workspace seatswap-app
  npm run test --workspace seatswap-app
  npm run build --workspace seatswap-app

Fix only cross-lane wiring: imports, route registration in routeTree.gen.ts
(run the build to regenerate, never hand-edit), env plumbing, shared types.
If a lane's file must change, write a `request:` line in docs/14-LANES.md
instead of editing it yourself.
Push only when all gates are green: git push origin main
```

---

## 3. Design-parity prompt (per lane, against designs/)

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
Read: agents.md, docs/05-SCREENS.md, docs/07-DESIGN-SYSTEM.md,
docs/13-COLLAB-CONTRACT.md. Claim / confirm you hold LANE <Lx>.

For each screen listed for your lane in docs/05-SCREENS.md, open the matching
designs/NN *.jpg and compare: layout order, wording, numbers (₹99, ₹50),
"Berth ••" masking before payment, tone. Fix ONLY inside your lane.
If the image disagrees with agents.md, agents.md wins — note the conflict in
docs/14-LANES.md notes. Then run the three gates and commit path-scoped.
```

---

## 4. Infra / credits prompt (L9)

```
Repo: /Users/ayodhyarammohanthy/Documents/GitHub/swap
Read: docs/12-INFRA-CREDITS.md, docs/13-COLLAB-CONTRACT.md, app/azure/README.md.
You hold LANE L9.

Work only in app/azure/**, docs/12-*, .github/workflows/**.
Never put a real secret in a file — env/wrangler secret only.
Azure tasks are dry-run safe (no keys): node app/azure/translator-draft.mjs
--dry-run ; node app/azure/safety-eval.mjs
Only free / student / startup-credit products. Green rule before commit.
```

---

## 5. Short version (when a platform only accepts one line)

```
Repo /Users/ayodhyarammohanthy/Documents/GitHub/swap. Read agents.md, docs/11-COLLAB.md,
docs/12-INFRA-CREDITS.md, docs/13-COLLAB-CONTRACT.md, docs/14-LANES.md.
Claim ONE lane in docs/14-LANES.md, touch only that lane's files, cross-lane needs
become `request:` lines. Build keyless. Green rule (typecheck+test+build) before commit.
Never git add -A. Free/student-credit products only.
```

---

## 6. What to do when two platforms clash

1. Their lane owner keeps the file (docs/13 §2).
2. The other platform re-applies its change on top of a fresh `git pull --rebase`.
3. Re-run the three gates; if still red, the L1 owner decides and records the
   call in `docs/14-LANES.md`.
