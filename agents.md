# AGENTS.md — SeatSwap build rules for AI coding agents (ALL models: Codex, Claude, Gemini, Copilot, Cursor, Windsurf, Aider, Muse Spark)

## 0. If the human just said "start" / "continue" / "go"

Do this yourself. Ask nothing. The human will not pick your lane — you do.

1. `git pull --rebase`, `git status --short`, hot-file check
   `find app/src app/tests app/locales -newermt '-15 min' -type f`.
2. Read `docs/14-LANES.md`. Pick the **first lane that is `free`** (or the
   lane you already hold). Claim it: `active: <your platform>, <ISO time>`.
   If every lane is `active` by other agents, take the top item from the
   lane-board **Backlog** inside any lane that is free.
3. Read, in order: `docs/11-COLLAB.md`, `docs/12-INFRA-CREDITS.md`,
   `docs/13-COLLAB-CONTRACT.md`. Skim `docs/01`…`docs/10` as needed for
   your lane; `docs/05-SCREENS.md` maps every screen to `designs/*.jpg`.
4. Work ONLY inside your lane. Build keyless: `npm run dev --workspace seatswap-app`.
   Before every commit: `npm run typecheck` + `npm run test` + `npm run build`
   (all in workspace `seatswap-app`). Commit path-scoped, one topic, never
   `git add -A`. Free / student / startup-credit products only.
5. Finish: set your lane to `done. <one-line summary>` in `docs/14-LANES.md`,
   list changed files, then do the next free lane or stop.

Full detail: the rest of this file. Prompts for the human: `PROMPTS.md`.

Read this file first, then `docs/01-PRD.md` … `docs/14-LANES.md` in order.
The screen images in `designs/` are the visual reference for layout and wording.
Multiple agents work in this repo at once: `docs/11-COLLAB.md` is mandatory.
Infra + credits: `docs/12-INFRA-CREDITS.md` + `app/azure/README.md` are mandatory.
Collaboration: `docs/13-COLLAB-CONTRACT.md` (one lane per agent) +
`docs/14-LANES.md` (live claims) are mandatory — claim a lane before editing.
Tool pointers: `CLAUDE.md`, `GEMINI.md`, `CODEX.md`, `.cursorrules`, `.windsurfrules`, `.muserules`, `.github/muse-instructions.md`, `.aider.conf.yml`.

## Product in one line
SeatSwap is a mobile-first PWA that helps passengers on the same Indian train, same date, swap berths/seats with each other by mutual agreement.

## Non-negotiable rules (never break, never "improve")
1. **Price:** ₹99 per swap = ₹49 SeatSwap fee + ₹50 thank-you credit to the acceptor. No discounts (no senior/women/first-time discounts). No coupons.
2. **Pay only after acceptance.** Sending requests is free. Requester pays ₹99 after someone accepts. No payment timer. Swap locks the moment payment succeeds; until then other matches can still accept.
3. **Acceptor never pays.** Acceptor earns ₹50 credit only when the swap is confirmed as done.
4. **Credit is never cash.** Credit only lowers future SeatSwap fees. Cannot be withdrawn or transferred (exception: can be used on a linked family trip). Expires 12 months after it is earned.
5. **No free rewards.** Nothing for signing up, adding a PNR, or being "open to swap". No "thanks for trying" credit.
6. **Swap didn't happen → ₹99 goes to the requester's credit**, never back to the bank. Only exception: a payment that failed at the bank/gateway level (money auto-returned by bank in 3–5 days).
7. **No promised dispute time.** Copy: "We'll look at both sides and reply as soon as we can. Your money is held safely meanwhile."
8. **Sign-in: Google only.** No phone OTP, SMS, WhatsApp OTP, email/password. Sign-in is asked only when the user first sends or accepts a request (PNR entry works signed out).
9. **Payments:** Razorpay for Indian payers (UPI, cards, net banking, wallets). PayPal for international travellers (label: "International traveller? Pay with PayPal"). Amount is always ₹99 INR.
10. **Banned words anywhere in UI/copy/notifications:** "TTE", "pass", "swap pass", "official", "Indian Railways", "IRCTC approved", "authorised", "legal", "grievance". Use **"Swap summary"** for the post-payment card.
11. **Positioning:** SeatSwap is a convenience platform. Every swap is the passengers' own mutual understanding. Footer line: "SeatSwap is not an official railway service." No legal/grievance screens, no lawyer talk.
12. **Navigation:** exactly 3 bottom tabs: **Home / Swaps / Profile.** Setup screens (language, privacy, alerts, Google sign-in, WhatsApp link landing) show no tab bar.
13. **Privacy:** never show another user's PNR, full name, phone, email, or ticket photo. Before payment, other users see only first name + initial, class, coach, berth type. Exact berth numbers are revealed to both sides only after payment.
14. **Scope:** Indian trains only (all trains, all India). Anyone worldwide may pay via PayPal. Buses/flights are out of scope.
15. **Low running cost:** no SMS, no masked calling, no paid OTP. Notifications = free web push + in-app Updates list.

## Tech stack (fixed)
- TanStack Start v1 (React 19, Vite 7), TypeScript strict, Tailwind CSS v4, shadcn/ui.
- Backend: Supabase-compatible Postgres + Auth (Google) + RLS + Storage (Lovable Cloud).
- Server logic: `createServerFn`; webhooks at `/api/public/*` with signature verification.
- PWA: manifest + `vite-plugin-pwa` (generateSW, NetworkFirst for pages) for offline Trips and Swap summary.
- Roles in a separate `user_roles` table with `has_role()` security-definer function. Never check admin on the client.

## Coding conventions
- Money stored as integer paise. ₹99 = 9900.
- All state transitions go through server functions that write an `activity_log` row.
- Every table: RLS on, explicit GRANTs.
- All copy in i18n files (`/locales/{lang}.json`). English + Hindi first; structure ready for all 22 scheduled languages.
- Semantic Tailwind tokens only (no raw hex in components).
