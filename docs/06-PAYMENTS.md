# 06 — Payments (Razorpay)

## Choosing the provider
- **Razorpay only** (Indian cards, UPI, net banking, wallets). Show UPI apps first. Owner ruling 2026-10-21: India-only for now - Razorpay covers every payment method, so PayPal was removed from every user-facing surface (method picker, appreciation screen, the /pay/$id/paypal route, both locales, USD-estimate copy). The `src/lib/paypal/` client, its unit tests, the payment `provider` column and the admin ledger label stay so international payments can return from git history.
- Amount always ₹100 INR (₹199 for a group trip).

## Razorpay flow
1. Server fn `createRazorpayOrder(requestId)` → validates request is `accepted_awaiting_payment` and caller is the requester; computes `amount = 10000 - creditUsed`; creates order (receipt = request id); inserts `payments(status='created')`.
2. Client opens Razorpay Checkout with `order_id`.
3. On handler success → server fn `verifyRazorpaySignature` (HMAC SHA256 of `order_id|payment_id` with key secret) → mark `pending` until webhook.
4. Webhook `/api/public/webhooks/razorpay` (verify `X-Razorpay-Signature`): `payment.captured` → `paid` → lock request, supersede other offers, reveal berths, notify both, write activity_log. `payment.failed` → `failed`.
5. Idempotent on `provider_ref`.

## Credit
- If credit balance ≥ amount → no provider; `provider='credit'`, instant lock.
- Credit is consumed oldest-first (earliest expiry first).
- "Swap didn't happen" never triggers a provider refund; it inserts `wallet_tx(kind='swap_to_credit', +9900, expires_at = now()+12 months)`.

## Receipts
Number format `SS-#####`. Lines: SeatSwap fee ₹50 · Thank-you credit ₹50 · credit used (if any) · Total. Downloadable PDF + share.

## Secrets (server only)
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (plus the PayPal trio if international returns). Public: the Razorpay key id may be exposed to the browser.

## Tax note for the owner
GST on the ₹50 fee should be confirmed with an accountant before live payments.

## Tips (owner rulings 2026-10-21)

After a swap is confirmed done, the requester may tip the helper ₹10 / ₹20 / ₹50 in cash (Razorpay / PayPal). Rules:

- The helper receives 100% of the tip as credit (`wallet_tx` kind `tip_credit`, 12-month validity). Never cash. No split — SeatSwap takes no cut and absorbs the gateway fee.
- Credit can never pay for a tip (`credit_used_paise` is always 0).
- One tip per swap; requester only; only after both sides confirmed. Enforced in `lib/tips` (`tipGateFor`, `beginTip`) and re-checked at the write.
- The payment row opens BEFORE the gateway order (keyed `tip:<requestId>` so it never reads as the swap's own payment). Only a captured payment settles the credit, idempotently on the payment id. A failed tip charges nothing, holds nothing, and may be retried.
- No refunds. Disputes go through support; `tip_credit` is never auto-clawed-back.
- "Credit is never transferable" stays literally true: no credit moves between travellers — the helper's tip credit is newly minted from a cash payment.
