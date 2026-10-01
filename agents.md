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

## Definition of done — no partial credit
1. `npm run typecheck` clean
2. `npm run test` — full suite passes
3. `npm run build` — includes verify-dist, must be green
4. `npm run collab-check` clean
5. One topic per commit. NEVER `git add -A`. Subject ≥ 10 chars,
   form `feat(x): ...`, `fix(x): ...`, or `L#: ...`.

## Non-negotiable product rules (never break, never "improve")
1. **Price:** ₹99 per swap = ₹49 SeatSwap fee + ₹50 thank-you credit to the
   acceptor. No discounts (no senior/women/first-time discounts). No coupons.
2. **Pay only after acceptance.** Sending requests is free. Requester pays ₹99
   after someone accepts. No payment timer. Swap locks the moment payment
   succeeds; until then other matches can still accept.
3. **Acceptor never pays.** Acceptor earns ₹50 credit only when the swap is
   confirmed as done.
4. **Credit is never cash.** Credit only lowers future SeatSwap fees. Cannot be
   withdrawn or transferred (exception: can be used on a linked family trip).
   Expires 12 months after it is earned.
5. **No free rewards.** Nothing for signing up, adding a PNR, or being "open to
   swap". No "thanks for trying" credit.
6. **Swap didn't happen → ₹99 goes to the requester's credit**, never back to
   the bank. Only exception: a payment that failed at the bank/gateway level
   (money auto-returned by bank in 3–5 days).
7. **No promised dispute time.** Copy: "We'll look at both sides and reply as
   soon as we can. Your money is held safely meanwhile."
8. **Sign-in: Google only.** No phone OTP, SMS, WhatsApp OTP, email/password.
   Sign-in is asked only when the user first sends or accepts a request (PNR
   entry works signed out).
9. **Payments: Razorpay primary, domestic AND international.** PayPal is an
   explicit fallback for international payers (label: "International
   traveller? Pay with PayPal"). Amount is always ₹99 INR. The stack line in
   docs/12 §1 must agree with this — see the note there.
10. **Banned words anywhere in UI/copy/notifications:** "TTE", "pass", "swap
    pass", "official", "Indian Railways", "IRCTC approved", "authorised",
    "legal", "grievance". Use **"Swap summary"** for the post-payment card.
    Naming IRCTC as the *source* of a ticket the passenger already holds
    ("Paste the IRCTC booking SMS") is factual and allowed; claiming its
    *approval* is not.
11. **Positioning:** SeatSwap is a convenience platform. Every swap is the
    passengers' own mutual understanding. Footer line: "SeatSwap is not an
    official railway service." No legal/grievance screens, no lawyer talk.
12. **Navigation:** exactly 3 bottom tabs: **Home / Swaps / Profile.** Setup
    screens (language, privacy, alerts, Google sign-in, WhatsApp link landing)
    show no tab bar.
13. **Privacy:** never show another user's PNR, full name, phone, email, or
    ticket photo. Before payment, other users see only first name + initial,
    class, coach, berth type. Exact berth numbers are revealed to both sides
    only after payment.
14. **Scope:** Indian trains only (all trains, all India). Anyone worldwide may
    pay via PayPal. Buses/flights are out of scope.
15. **Low running cost:** no SMS, no masked calling, no paid OTP. Notifications
    = free web push + in-app Updates list.

Restored 2026-10-02 from `lovable build/AGENTS.md`, which is where `fc3b670`
(2026-09-30) left them when it rewrote this file. Rule 9 was updated to match
the docs/12 §1 amendment made the same day; the other 14 are verbatim. The
"Definition of done" in docs/10-BUILD-PLAN.md points at this list by name, so
it must stay here — a rule that lives only in a doc nobody is told to read is
a rule that gets broken by accident.

## Hard rules
- STACK IS FIXED: TanStack Start + React 19 + Vite + Tailwind v4,
  Supabase (DB/auth/realtime), Cloudflare (hosting/cron/queues/R2).
  Never swap, never add a database, never "migrate to" anything.
- VENDOR WHITELIST: only vendors marked WIRED in docs/12 §2 may appear
  in code, package.json, or config. RESERVE/BENCH vendors require Ayu
  moving the row to WIRED first. An agent never adds a vendor.
- NEVER build persistent infrastructure on expiring credits (docs/12 §0).
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



