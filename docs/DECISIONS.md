# Decisions Log (append-only)

Agents: when you make a judgment call without Ayu, append one line here
in the same commit. Never edit or delete prior lines.

Format: `YYYY-MM-DD | L# | decision | why`

2026-09-29 | — | Ledger restructured to WIRED/RESERVE/BENCH; backup cron + exit playbook adopted | portability over migration



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
