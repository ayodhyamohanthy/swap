# AGENTS.md — SeatSwap build rules for AI coding agents

Read this file first, then `docs/01-PRD.md` … `docs/10-BUILD-PLAN.md` in order.
The screen images in `designs/` are the visual reference for layout and wording.

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
