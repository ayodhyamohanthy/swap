# 06 — Payments (Razorpay + PayPal)

## Choosing the provider
**Razorpay is the single primary gateway — domestic and international.**
PayPal is a fallback path the passenger chooses explicitly: never a default,
never auto-suggested.
- Default: **Razorpay** (Indian cards, UPI, net banking, wallets). Show UPI apps first.
- A traveller paying with a foreign card uses Razorpay's card rail like anyone
  else. PayPal is offered as a fallback, not as "the international option".
- Amount always ₹99 INR (₹199 for a group trip). PayPal converts; show "about US$X" as an estimate only.

### Status — what this doc does not yet match (recorded by L9, build-plan item 7)
A provider doc that describes a default nobody implements is how two lanes come
to disagree about what ships, so the gaps are written down rather than implied.
1. **The auto-suggestion was never built.** This section used to say
   "auto-suggest PayPal when the browser locale/currency is non-INR, but let the
   user switch". Nothing in `app/src` reads the browser locale or currency to
   choose a provider — no `navigator.language`, no `Accept-Language`, and
   `routes/pay.$requestId.method.tsx` renders one fixed list. The sentence is
   removed rather than left describing behaviour that does not exist; nothing
   relied on it, so no code changed.
2. **The method screen still frames PayPal as the international option.**
   `routes/pay.$requestId.method.tsx` renders an "In India" card of Razorpay
   methods and a separate "International traveller?" card whose only control is
   the PayPal button — so the screen still says, by its structure, that
   international means PayPal. Making Razorpay primary there is a change inside
   **L4's surface** and needs copy in both languages (**L10**, single writer),
   so it is filed as a request on the board with the exact change named, rather
   than swept from here.
3. **`docs/12` §1 contradicts §2 about this.** §1 reads "Payments: Razorpay
   (domestic), PayPal (international)"; §2's ledger already says Razorpay is
   "payments PRIMARY (both)" and PayPal is an "international fallback". §1 is
   titled "Fixed stack (agents may not change this)", so correcting it is Ayu's
   edit and not an agent's — flagged as a must-ask, not changed.

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
