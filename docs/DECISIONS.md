# Decisions Log (append-only)

Agents: when you make a judgment call without Ayu, append one line here
in the same commit. Never edit or delete prior lines.

Format: `YYYY-MM-DD | L# | decision | why`

2026-09-29 | — | Ledger restructured to WIRED/RESERVE/BENCH; backup cron + exit playbook adopted | portability over migration



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
