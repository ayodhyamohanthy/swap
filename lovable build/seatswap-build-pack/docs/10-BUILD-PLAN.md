# 10 — Build Plan (in order)

1. **Foundation:** TanStack Start app, design tokens, 3-tab shell, i18n (en, hi), PWA manifest.
2. **Trips:** add PNR (type/paste SMS parse), multiple PNRs, passengers, statuses (WL/RAC/CAN), quota, chair car, child-no-berth. Works signed out (local), synced after sign-in.
3. **Auth:** Google sign-in, profiles, privacy consent, user_roles + has_role.
4. **Requests & matching:** ranked choices, matches list with hidden berths, send to many free, offers, Updates list, "You're the first", share sheet (WhatsApp, Instagram, Facebook, Telegram, SMS, Copy, QR).
5. **Acceptor:** open to swap, filters, incoming request, accept/decline, waiting for payment, "someone was faster".
6. **Payments:** Razorpay + PayPal + credit, webhooks, receipts, pending/failed states.
7. **Locked swap:** berth reveal, chat with risky-message guard, report/block, Found each other, Swap summary offline.
8. **Outcomes:** Did you swap?, credit rules, disputes, auto-confirm job, rating, share cards, acceptor nudge.
9. **Changes:** PNR cancelled, berth changed, partner cancelled, cancel swap.
10. **Groups:** link PNRs, family plan, ₹199 group payment, swapping for parents, easy mode.
11. **On board:** live coach board until your stop.
12. **Admin:** overview, activity log, users, swaps, payments, credits, reports, CSV export.
13. **Growth extras:** public train pages (SEO), free berth check, chart-time push, welcome back, credit reminders, install prompt.
14. **QA:** every flow in 04-FLOWS.md end to end on a 360 px Android device, offline tests, webhook replay tests.

## Definition of done
- All non-negotiable rules in AGENTS.md pass a manual checklist.
- No banned words anywhere (grep the locales).
- Every state change writes activity_log.
- Lighthouse PWA installable; first screen usable on slow 3G.

## Placeholders to replace
Domain (currently planned: toyoufromme.website), example names (Arjun, Priya, Riya), admin figures, QR pattern, US$ estimate.
