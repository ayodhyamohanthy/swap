# 06 — Payments (Razorpay + PayPal)

## Choosing the provider
- Default: **Razorpay** (Indian cards, UPI, net banking, wallets). Show UPI apps first.
- "International traveller?" → **PayPal**. Also auto-suggest PayPal when the browser locale/currency is non-INR, but let the user switch.
- Amount always ₹99 INR (₹199 for a group trip). PayPal converts; show "about US$X" as an estimate only.

## Razorpay flow
1. Server fn `createRazorpayOrder(requestId)` → validates request is `accepted_awaiting_payment` and caller is the requester; computes `amount = 9900 - creditUsed`; creates order (receipt = request id); inserts `payments(status='created')`.
2. Client opens Razorpay Checkout with `order_id`.
3. On handler success → server fn `verifyRazorpaySignature` (HMAC SHA256 of `order_id|payment_id` with key secret) → mark `pending` until webhook.
4. Webhook `/api/public/webhooks/razorpay` (verify `X-Razorpay-Signature`): `payment.captured` → `paid` → lock request, supersede other offers, reveal berths, notify both, write activity_log. `payment.failed` → `failed`.
5. Idempotent on `provider_ref`.

## PayPal flow
1. Server fn `createPaypalOrder(requestId)` (Orders v2, currency INR, intent CAPTURE).
2. Client: PayPal JS buttons → approve → server fn `capturePaypalOrder`.
3. Webhook `/api/public/webhooks/paypal` (verify via PayPal verify-webhook-signature API): `PAYMENT.CAPTURE.COMPLETED` → `paid`; `DENIED` → `failed`.

## Credit
- If credit balance ≥ amount → no provider; `provider='credit'`, instant lock.
- Credit is consumed oldest-first (earliest expiry first).
- "Swap didn't happen" never triggers a provider refund; it inserts `wallet_tx(kind='swap_to_credit', +9900, expires_at = now()+12 months)`.

## Receipts
Number format `SS-#####`. Lines: SeatSwap fee ₹49 · Thank-you credit ₹50 · credit used (if any) · Total. Downloadable PDF + share.

## Secrets (server only)
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`. Public: Razorpay key id and PayPal client id may be exposed to the browser.

## Tax note for the owner
GST on the ₹49 fee should be confirmed with an accountant before live payments.
