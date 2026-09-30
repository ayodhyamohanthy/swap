
# 10 — Build Plan
Format: each lane owns a checklist. "build"/"continue" = first [ ] in
your lane. Check it [x] in the same commit that completes it.

## L9 — Infra & tooling
- [ ] Unblock GitHub Actions: clear billing lock or make repo public;
      seatswap-ci must run green in the cloud on next push
- [ ] Create Supabase project seatswap-staging; mirror schema via
      migrations; agents point at staging by default
      (2026-09-30, L9 — two of the three clauses are done; the box stays
      open because the first is Ayu's and nothing here can do it: no
      Supabase access token, no `supabase` CLI, no `~/.supabase`, zero GH
      secrets in this environment. **Done:** the mirror is *proved* rather
      than assumed — `scripts/staging-lib.mjs` identifies every object a
      fresh apply creates (112 objects from 112 CREATE statements in
      `_init.sql`, 0 unrecognised statement kinds) and asserts
      migration #1 == `schema.sql` == the concatenation of `parts/`, so
      drift between the three copies now fails a test instead of shipping;
      `node app/scripts/staging-dry-run.mjs` prints the ordered apply
      commands and exits non-zero on any blocking finding, with no network
      reach at all (proved structurally — it imports only `node:fs`,
      `node:path`, `node:url` — and run under `azure/no-net.mjs` with 0
      recorded attempts). "Agents point at staging by default" is enforced
      rather than prose: docs/12 §4 gained a parseable env→project-ref
      table, and `collab-check` check 7 fails if any committed file names a
      Supabase project whose ref is not recorded there — mutation-checked
      against an unknown ref, a blind parser, and a recorded *prod* ref.
      **Still Ayu:** create seatswap-staging (free plan), then paste its
      project ref into that table; the dry run prints the exact
      Management-API `curl` body. **Blocked on L8, filed as requests:**
      `<repo>/supabase/migrations` does not exist, so a CLI-driven
      `supabase db push` from the repo root provisions an EMPTY database;
      and a stale fourth copy at `supabase/schema-steps-1-2.sql` collides
      with the canonical schema on 10 objects.)
- [ ] Backup workflow: commit .github/workflows/seatswap-backup.yml
      (file provided in handoff), add the 6 GH Actions secrets per
      docs/12 §8, set R2 30-day lifecycle rule, verify one manual run
      (workflow_dispatch) succeeds end-to-end
- [ ] Claim Student Pack domain (Namecheap .me or Name.com) → Cloudflare
      DNS, TTL 300 (Ayu does the claim; agent wires DNS + wrangler routes)
- [x] Sweep: verify no BENCH/RESERVE vendor SDK exists in package.json
      or code; remove any found; add collab-check rule enforcing the
      docs/12 §2 whitelist
      (sweep found none — 27 deps + 663 imports, all clean; the rule is
      `collab-check` check 6, fed by `scripts/vendor-whitelist.mjs`)
- [x] Mobile-first audit: run every existing screen against
      docs/17-MOBILE-FIRST.md (360px baseline, 44px targets, 16px
      inputs, safe-area insets, manifest maskable icons, bundle
      ≤200KB gz); file one fix task per violation in the owning lane
      (audited 0078bcf: all six compliant — viewport-fit=cover, .tap
      48px / Input min-h-12, --text-body 1rem = 16px, safe-area-inset-bottom
      on the bottom nav, maskable-512 in the manifest. The budget was the
      one rule docs/17 calls "CI-enforceable" that nothing enforced; it
      measured 189.3 KB gz of 200 and is now checked by verify-dist §5b.
      One contract-vs-guard contradiction filed as a request.)
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
