/**
 * SwapSeat example payments backend (Node + Express).
 * Serves the static PWA AND the 5 endpoints the frontend expects:
 *   POST /api/razorpay/order    {kind, amount, currency} -> {id, amount, currency}
 *   POST /api/razorpay/verify   {razorpay_order_id, razorpay_payment_id, razorpay_signature} -> {ok:true}
 *   POST /api/paypal/capture    {kind, orderID} -> {ok:true}            (optional verify)
 *   POST /api/chargebee/checkout {planId} -> {hostedPage}
 *   POST /api/chargebee/portal   {} -> {hostedPage}  (customer portal; pass customerId in prod)
 *   POST /api/chargebee/webhook  (configure in Chargebee → Settings → Webhooks; verify + entitle Plus)
 *
 * Env:
 *   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET
 *   PAYPAL_CLIENT_ID / PAYPAL_SECRET (sandbox or live, matching frontend currency)
 *   CHARGEBEE_SITE / CHARGEBEE_API_KEY / CHARGEBEE_PLUS_MONTHLY / CHARGEBEE_PLUS_YEARLY
 *   PORT (default 8099) — serves ../ (the PWA) statically too.
 *
 *   npm i express razorpay @paypal/checkout-server-sdk chargebee
 *   node server/example-server.js
 */
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

const {
  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
  PAYPAL_CLIENT_ID, PAYPAL_SECRET,
  CHARGEBEE_SITE, CHARGEBEE_API_KEY,
  CHARGEBEE_PLUS_MONTHLY = 'plus-monthly',
  CHARGEBEE_PLUS_YEARLY = 'plus-yearly',
  PORT = 8099,
} = process.env;

// ---- static PWA ----
app.use(express.static(path.join(__dirname, '..')));

// ---- Razorpay ----
let rzp = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  const Razorpay = require('razorpay');
  rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
}
app.post('/api/razorpay/order', async (req, res) => {
  try {
    if (!rzp) return res.status(501).json({ error: 'Razorpay not configured' });
    const { amount, currency = 'INR' } = req.body || {};
    const order = await rzp.orders.create({ amount: Math.round(Number(amount) * 100), currency, receipt: 'ss_' + Date.now() });
    res.json(order);
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/razorpay/verify', (req, res) => {
  try {
    const crypto = require('crypto');
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const h = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
    if (h !== razorpay_signature) return res.status(400).json({ error: 'bad signature' });
    // TODO: entitle Plus / credits in your DB here.
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- PayPal (optional server verify) ----
app.post('/api/paypal/capture', async (req, res) => {
  try {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) return res.json({ ok: true, demo: true });
    // For brevity: client already captured via Buttons SDK; verify via Orders API in prod.
    // TODO: call paypal OrdersGet + validate amount per kind.
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// ---- Chargebee ----
let chargebee = null;
if (CHARGEBEE_SITE && CHARGEBEE_API_KEY) {
  chargebee = require('chargebee');
  chargebee.configure({ site: CHARGEBEE_SITE, api_key: CHARGEBEE_API_KEY });
}
app.post('/api/chargebee/checkout', async (req, res) => {
  try {
    if (!chargebee) return res.status(501).json({ error: 'Chargebee not configured' });
    const { planId } = req.body || {};
    const allowed = [CHARGEBEE_PLUS_MONTHLY, CHARGEBEE_PLUS_YEARLY];
    if (!allowed.includes(planId)) return res.status(400).json({ error: 'unknown plan' });
    const result = await chargebee.hosted_page.checkout_new({
      subscription: { plan_id: planId },
      // customer: { id: req.user?.cbCustomerId }, // attach logged-in customer in prod
    }).request();
    res.json({ hostedPage: result.hosted_page });
  } catch (e) { res.status(500).json({ error: String(e?.message || e?.message || e) }); }
});
app.post('/api/chargebee/portal', async (req, res) => {
  try {
    if (!chargebee) return res.status(501).json({ error: 'Chargebee not configured' });
    // In prod, look up customerId from session:
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'customerId required (wire to your auth)' });
    const result = await chargebee.portal_session.create({ customer: { id: customerId } }).request();
    res.json({ hostedPage: result.portal_session });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post('/api/chargebee/webhook', (req, res) => {
  // TODO: verify webhook auth, handle subscription_created/cancelled → entitle/revoke Plus in DB.
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`SwapSeat PWA + payments API on http://localhost:${PORT}`));
