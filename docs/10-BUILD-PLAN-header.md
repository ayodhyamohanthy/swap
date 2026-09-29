# 10 — Build Plan (new header + L9 seed tasks)

Paste this at the TOP of the existing docs/10-BUILD-PLAN.md, then convert
the existing lane tasks below it into [ ] / [x] checkboxes. Do not delete
existing task content — only reformat it.

---

# 10 — Build Plan
Format: each lane owns a checklist. "build"/"continue" = first [ ] in
your lane. Check it [x] in the same commit that completes it.

## L9 — Infra & tooling
- [ ] Unblock GitHub Actions: clear billing lock or make repo public;
      seatswap-ci must run green in the cloud on next push
- [ ] Create Supabase project seatswap-staging; mirror schema via
      migrations; agents point at staging by default
- [ ] Backup workflow: commit .github/workflows/seatswap-backup.yml
      (file provided in handoff), add the 6 GH Actions secrets per
      docs/12 §8, set R2 30-day lifecycle rule, verify one manual run
      (workflow_dispatch) succeeds end-to-end
- [ ] Claim Student Pack domain (Namecheap .me or Name.com) → Cloudflare
      DNS, TTL 300 (Ayu does the claim; agent wires DNS + wrangler routes)
- [ ] Sweep: verify no BENCH/RESERVE vendor SDK exists in package.json
      or code; remove any found; add collab-check rule enforcing the
      docs/12 §2 whitelist
- [ ] Mobile-first audit: run every existing screen against
      docs/17-MOBILE-FIRST.md (360px baseline, 44px targets, 16px
      inputs, safe-area insets, manifest maskable icons, bundle
      ≤200KB gz); file one fix task per violation in the owning lane
- [ ] Payments: make Razorpay the single primary gateway for domestic
      AND international; demote PayPal to fallback path only; update
      docs/06-PAYMENTS.md to match

## L1..L8 — (existing feature lanes: keep current tasks, converted to [ ]/[x])



