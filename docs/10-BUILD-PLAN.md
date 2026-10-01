
# 10 — Build Plan
Format: each lane owns a checklist. "build"/"continue" = first [ ] in
your lane. Check it [x] in the same commit that completes it.

## L9 — Infra & tooling
- [x] Unblock GitHub Actions (2026-09-30, L9): repo is public so the billing
      lock no longer blocks jobs; landed the rewrite-drop fixes on main and
      run 36668939334 went green (typecheck + tests + build + collab-check)
- [ ] Create Supabase project seatswap-staging; mirror schema via
      migrations; agents point at staging by default
- [ ] Backup workflow: commit .github/workflows/seatswap-backup.yml
      (file provided in handoff), add the 6 GH Actions secrets per
      docs/12 §8, set R2 30-day lifecycle rule, verify one manual run
      (workflow_dispatch) succeeds end-to-end
- [ ] Claim Student Pack domain (Namecheap .me or Name.com) → Cloudflare
      DNS, TTL 300 (Ayu does the claim; agent wires DNS + wrangler routes)
- [x] Sweep: verify no BENCH/RESERVE vendor SDK exists in package.json
      or code; remove any found; add collab-check rule enforcing the
      docs/12 §2 whitelist
      (2026-09-30, Fo, fo/swap-vendor-sweep): sweep clean — neither
      manifest carries a BENCH/RESERVE/UNCLAIMED SDK and no code import
      references one; the new collab-check `vendor whitelist` check now
      enforces §2 over both package.json files and every import specifier
      under app/src, app/functions, app/scripts and server (decision +
      tests in tests/collab-check.test.ts, mutation-checked: a planted
      mixpanel dep and a planted statsig import both fail by name).
- [x] Mobile-first audit: run every existing screen against
      docs/17-MOBILE-FIRST.md (360px baseline, 44px targets, 16px
      inputs, safe-area insets, manifest maskable icons, bundle
      ≤200KB gz); file one fix task per violation in the owning lane (done 2026-10-01: 3 violations filed as L9→L2/L1 requests in docs/14; bundle, splitting, fonts, touch targets, input size, viewport, safe-area all pass)
- [ ] Payments: make Razorpay the single primary gateway for domestic
      AND international; demote PayPal to fallback path only; update
      docs/06-PAYMENTS.md to match

## L1..L8 — (existing feature lanes: keep current tasks, converted to [ ]/[x])




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
