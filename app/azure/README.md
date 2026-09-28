# SeatSwap Azure burn-down — $200 credits, exp Dec 16 2026

> Ephemeral only. Production stays Cloudflare ($10k) + Supabase.
> Nothing in here runs at runtime, touches `app/locales/`, or changes
> money/RLS. All scripts are dry-run safe with no keys.

## Guardrails (do these in Azure Portal day 1)

1. Subscription `seatswap-credits`, RG `seatswap-exp-dec16`.
2. Budget `$200`, alerts 50 / 80 / 100%. Delete RG by **Dec 10 2026**.
3. No prod secrets here — only test keys. Prod
   `RAZORPAY_* / PAYPAL_* / VAPID_* / VITE_SUPABASE_*` stays in
   Cloudflare + Supabase.
4. `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION`,
   `AZURE_CONTENT_SAFETY_ENDPOINT`, `AZURE_CONTENT_SAFETY_KEY` are
   optional env. Every script works without them (dry-run / local eval).

## What lives here

| Path | What | Burns $ |
|---|---|---|
| `translator-draft.mjs` | `en.json` (635 leaves, ~17k chars) → draft `tmp/<code>.json` for the 20 remaining langs. Never writes `app/locales/`. Banned-word + placeholder scan included. | ~$5 total |
| `safety-corpus.json` | 60-message eval corpus: clean / cash_en / upi / phone / hinglish / hindi_devanagari / obfuscated. | $0 |
| `safety-eval.mjs` | Runs local `guardMessage()` over the corpus → precision/recall. Optionally compares Azure AI Content Safety when env is set. | <$30 capped |
| `load/get-matches.k6.js` | k6 plan for the hot-train board (`12951 + date + 3A`). | ~$20-40 |
| `load/get-matches.spec.sql` | PROPOSAL ONLY — partial indexes + paginated `get_matches()` RPC. Not applied; schema tests forbid drift. | $0 |
| `budget/` | Budget + delete-by-Dec-10 checklist + `az` commands. | $0 |

## Quick start

```bash
# 1. Cost estimate only, no network, no spend
node app/azure/translator-draft.mjs --dry-run

# 2. Draft one language to tmp (needs keys, else stays dry-run)
AZURE_TRANSLATOR_KEY=xxx AZURE_TRANSLATOR_REGION=centralindia \
  node app/azure/translator-draft.mjs --lang bn

# 3. Safety eval, local only ($0)
node app/azure/safety-eval.mjs

# 4. With Azure Content Safety comparison (optional spend)
AZURE_CONTENT_SAFETY_ENDPOINT=https://xxx.cognitiveservices.azure.com \
AZURE_CONTENT_SAFETY_KEY=xxx node app/azure/safety-eval.mjs --azure

# 5. Load plan (needs k6 + staging URL, ephemeral)
k6 run app/azure/load/get-matches.k6.js -e BASE_URL=https://staging.toyoufromme.website
```

## Why not host on Azure

`$200` dies to Postgres HA + egress in a festival spike. Supabase Free
holds ~2–3L bookings; Startup Team (startup credits) removes limits with
zero rewrite. Azure is for one-shot jobs that Cloudflare free can't do:
Translator batch, safety-model eval, VU load test.
