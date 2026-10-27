# Decisions Log (append-only)

Agents: when you make a judgment call without Ayu, append one line here
in the same commit. Never edit or delete prior lines.

Format: `YYYY-MM-DD | L# | decision | why`

2026-09-29 | — | Ledger restructured to WIRED/RESERVE/BENCH; backup cron + exit playbook adopted | portability over migration



2026-10-22 | — | Folded stale-branch work into main via PR #9 (squash 403d8ce): og/twitter previews + fresh ₹100 og-image, robots.txt + sitemap.xml, Cloudflare _headers, maskable-192, safety-eval relaunch. Deleted folded branches (tip SHAs, restorable): fo/swap-og-tags 24c3f9fa, fo/swap-link-preview c6deabe2, fo/swap-robots-sitemap 66039cdc, fo/swap-robots-headers a8fd1ca7, fo/swap-azure-main-green 0503fe58, fo/swap-lanes-stale-note 13bcc27b (only the safety-eval half folded; its docs/14 Forge-note removal was dropped deliberately), fo/swap-safety-eval-type-stripping e5ab1539, consolidate/oct22-fold-in (merged). Branch og-images were NOT taken: one read Rs 99, the other rendered tofu; a fresh image carries the current ₹100 line. | Ayu's tidy-repo consolidation, 3:11 PM relay
2026-10-22 | — | Batch 2 fold via PR #10 (squash 4cd0c75): .app-console 72rem admin bound, hot-file pointers, manifest ?source=pwa, stale root manifest.webmanifest removed. Deleted folded branches (tip SHAs): l1/responsive-clamps 71af6694, fo/swap-protocol-doc-restores d167db1e, fo/swap-mobile-first-fixes 823fd5fd, fo/swap-stale-manifest 9d4f4549, consolidate/oct22-batch2 (merged). | Ayu's tidy-repo consolidation
2026-10-22 | — | Batch 3 fold via PR #11 (squash 8fad65a): payment rows carry request_id/group_id with the database XOR mirrored locally (KNOWN GAP closed), example-server.js Chargebee endpoints dropped. Deleted folded/superseded branches (tip SHAs): fo/swap-payment-row-group-target f1a3fac6, fo/swap-vendor-sweep 86917b23, fo/swap-mobile-first-audit cbcc1b53 (same shared core: safety-eval folded in #9, vendor guard superseded by main's lane-board, payment-row core folded here), consolidate/oct22-batch3 (merged). | Ayu's tidy-repo consolidation
2026-10-22 | — | Batch 4: source-map-js ^1.2.2 override landed via PR #12 (squash 5c8ff1c), folding PR #7's content. Deleted as superseded (tip SHAs): fo/swap-stack-green fe707e3a (rollup whose useful parts all landed; its one unique remainder was the PayPal-fallback feature, dead since the Oct 21 PayPal removal), l7/design-15-activity-table 484b2e73 (design-15 activity table already on main in evolved form: CATEGORY_ICON column, activityTrain, options-based activityDetails), base44/setup-8a4ecb9f 6e20b026 (off-whitelist vendor experiment, Sep 28, no docs/12 row), fo/swap-sourcemap-js-audit 3b8fe570 + consolidate/oct22-batch4 (merged). Closed PR #7 as folded. | Ayu's tidy-repo consolidation
2026-10-22 | — | Batch 5: PRs #6 + #3 folded via PR #13 (squash b37d07a) - request transitions through the SECURITY DEFINER RPC (a real latent bug: direct UPDATE is grant-rejected on a configured backend), and sign-out keeps trip ownership with account-scoped sync. PR #6, #3 closed as folded; PR #1 (pwa/mobile-first, pre-workspace layout) closed as superseded. Deleted branches (tip SHAs): reason/task-85925e06 a92a56ea, fix/agents-md-casing 63750644, pwa/mobile-first a438cf2e, consolidate/oct22-batch5 (merged). Left for the founder: docs/instructions-v2 / PR #8 (16,740-line rewrite). | Ayu's tidy-repo consolidation
2026-10-22 | — | Branch-tidy rule: only working branches; delete each branch after its PR merges (record name + tip SHA first); escalate unmerged branches with unique work | Ayu's rule, 3:08 PM
2026-10-22 | — | Deleted stale branch fo/swap-razorpay-primary, tip 2e87507c15a6bcf670cd86f5c69f8437880e7ef3 (restorable from this SHA) | superseded: main is Razorpay-only since 72ec216 (PayPal removed, live-verified); branch's remaining diff targeted the pre-workspace layout
2026-10-22 | — | Fullstack verification rule: test + verify end to end (UI/API/data/deploy) with shared test accounts before anything is called done; usernames + vault pointer to be published in repo notes, passwords only ever in the vault | Ayu's instruction, 3:00 PM relay
2026-10-22 | — | Proof rule: no done/ready/verified report without visible proof (screenshot or real test-run output); unproven claims are labeled UNVERIFIED | Ayu's rule, his words: "don't give me a word, give me some kind of proof" + "Make this as a rule"
2026-10-16 | — | Money rule: never choose money-spending options; free or money-earning options only; paid plans/add-ons dropped, not proposed as defaults | Ayu's bootstrap rule
2026-10-16 | — | Session-start sync: every session reads agents.md + DECISIONS.md + docs/12 §2 before acting | Ayu's standing instruction
2026-10-16 | — | Meritocracy: recommend better approaches with evidence; Ayu decides; never override a recorded decision | Ayu's standing instruction

## 2026-10-21 — Swap repriced to ₹100; helper credit is exactly 50%; tips approved for design

Owner ruling (iMessage phonemsg-01M5E537NGY2DTGP7KQ09EQCXX, 8:06 AM IST, replying to the payout-mismatch report for the 50%-copy task phonemsg-01M5E4YZN6BPDAP1HGPM85HRBG): option D — make the swap ₹100 so ₹50 is exactly 50%, and allow people to tip more.

- PRICE_PAISE 9900 → 10000, FEE_PAISE 4900 → 5000, THANK_YOU_PAISE stays 5000. The helper's credit is now exactly 50% of the swap price.
- Group trip price ₹199 unchanged.
- Promo copy replaced in both locales (home banner, swaps, requests, matches, profile): "Earn 50% credit every time you help someone swap". Post-fact receipt lines keep the exact ₹50 amount (₹50 = 50% of ₹100, so both are true).
- "back" framing rejected: helpers pay nothing, so the credit is earned, not returned.
- Tips (phonemsg-01M5E58MD1JZ2HMXB2VNP1MQ63, 8:09 AM IST): helper gets 100% of every tip, as credit. No split. Design proposal to the owner before building.
- PayPal estimate rate unchanged (display hint only); ₹100 still estimates to about US$1.2.

## 2026-10-21 (later) — Tips approved: cash-paid, credit-received

Owner rulings (iMessage phonemsg-01M5E537NGY2DTGP7KQ09EQCXX 8:06 "allow people to tip more too"; phonemsg-01M5E58MD1JZ2HMXB2VNP1MQ63 8:09 "No split on tip"; phonemsg-01M5EEZ3DV2BAX60PYXKEGYGSQ 10:59 "Swap requesters can pay in cash but we would be crediting as credits"; 👍 tapback 11:14 approving the final design, relayed and confirmed to him at 11:14:45 in phonemsg-01M5EFV5ZPGS4Q5S3511JAH5BY with no correction):

- Presets ₹10/₹20/₹50, cash via the existing rails, shown only after the swap is confirmed done. Optional, dismissible, once per swap, no pressure UI.
- Helper receives 100% as credit (12-month, never cash). No split; SeatSwap absorbs the ~2% gateway fee.
- Credit never pays for a tip. No self-serve refunds. Capture-before-credit, idempotent on payment id. "Never transferable" copy unchanged (no credit moves between users).
- Server side: webhook planner extended for tip capture/failure; DB-backed tip persistence (a tip marker on `payments`) is a schema decision for when payment hosting is wired (step 3+), same status as the rest of the server payment layer.

## 2026-10-21 (later still) — "Tip" renamed to "appreciation" in user-facing copy

Owner ruling (iMessage phonemsg-01M5EKEB86NX3H5TW098TBPK8S, 12:17 PM IST): "Instead of tip use some other word appreciation etc because they are helping out though they are taking some minimal charges." All user-facing copy (EN+HI) now says appreciation / say thanks / thank {name}, with an "earned" framing for the helper. Logic, ids, wallet kinds, route paths and i18n key names unchanged. Also fixed: a received appreciation in profile payments now carries the "added to your credit" label instead of the generic paid label.

## 2026-10-27 — Legacy prototype controllers removed from the root surface

The pre-Steps-1-2 prototype (app/auth/booking/flow/flow2/accept/journey/exchange-ui/flights/seatmaps/i18n/monetize/payments/payments-config/policy controllers under `js/`) was unreachable: `index.html` loads only the seatswap-*.js files, `sw.js` CORE caches only those, `SeatSwap-journeys.html` embeds its journeys inline, and no root test reads them. Branch fo/swap-root-legacy-js deletes all 15, so ~327 KB of dead prototype code no longer ships to the public host. `js/data.js` stays deliberately: auth.js calls it the seeded preview marketplace and tests/geometry.test.js evaluates it as a fixture. Evidence rule followed (proof, not words): every reachability claim above was grepped across index.html, SeatSwap-journeys.html, sw.js, styles.css, tests/, docs/ and README before deletion.
