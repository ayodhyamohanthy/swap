# 06 — Payments (Razorpay + PayPal)

## Choosing the provider
**Razorpay is the single primary gateway — domestic and international.**
PayPal is a fallback path the passenger chooses explicitly: never a default,
never auto-suggested.
- Default: **Razorpay** (Indian cards, UPI, net banking, wallets). Show UPI apps first.
- A traveller paying with a foreign card uses Razorpay's card rail like anyone
  else. PayPal is offered as a fallback, not as "the international option".
- Amount always ₹99 INR (₹199 for a group trip). PayPal converts; show "about US$X" as an estimate only.

### Status — what this section now describes (build-plan item 7, closed 2026-10-02)
The screen is `routes/pay.$requestId.method.tsx` and it says what this section
says. All three gaps this file used to list under "Status" are closed; they are
kept as a record of what was decided and why, because each one was invisible in
the markup.
1. **The auto-suggestion was never built, and is not coming.** This section used
   to say "auto-suggest PayPal when the browser locale/currency is non-INR, but
   let the user switch". Nothing in `app/src` reads the browser locale or
   currency to choose a provider — no `navigator.language`, no
   `Accept-Language` — so the sentence was deleted rather than left describing a
   default that does not exist. Nothing depended on it, so no code changed. The
   provider is never chosen for the passenger: the list below is the default and
   PayPal is one row they either take or walk past.
2. **The method screen's framing was the real gap, and it is fixed.** It rendered
   a `pay.inIndia` section holding the entire card rail and a `pay.intl` section
   holding nothing but the PayPal button, so the screen asserted "international ⇒
   PayPal" through its structure while every individual string read fine. Shape
   (a) of the two options on the board was taken, because rule 9 names the label
   "International traveller? Pay with PayPal" and that line has to survive:
   - the card rail is headed `pay.razorpay` — "Pay with UPI, card or net
     banking", with no country on it — and `pay.inIndia` is deleted, so the
     key that carried the framing cannot come back as dead copy;
   - the PayPal section keeps rule 9's label and adds `pay.intlNote` ABOVE the
     button: "Not in India? A foreign card works in the options above too."
     Above, not below, because a correction printed under the button still reads
     as "abroad ⇒ PayPal" with a footnote;
   - `pay.paypalAlt` is deleted. It already held rule 9's label verbatim, so
     reword one and the screen and the key set disagree.
   `tests/pay-provider-primary.test.ts` pins all of it, including the ordering.
3. **`docs/12` §1 no longer contradicts §2.** It read "Payments: Razorpay
   (domestic), PayPal (international)" while §2's ledger already said Razorpay is
   "payments PRIMARY (both)". Amended 2026-10-02 by Ayu, which is the only way it
   could be: §1 is titled "Fixed stack (agents may not change this)". Nothing
   enforces §1 mechanically, so the guard for that line is prose and a test
   reading this file — not a check.

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
