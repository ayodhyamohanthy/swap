/* SwapSeat payment config — fill keys, deploy, done.
   No rebuild needed: edit this file or use the in-app Billing Settings (stored in localStorage, overrides here).
   - Razorpay: Dashboard → Settings → API Keys → Key ID (rzp_test_… / rzp_live_…). Needs backend for orders+verify (server/example-server.js).
   - PayPal: developer.paypal.com → App → Client ID. One-time via Buttons; subscriptions need a Plan ID for Plus.
   - Chargebee: Settings → API Keys (publishable) + Site name. Needs backend for hosted-page checkout + portal (server/example-server.js).
*/
const PAYMENTS_CONFIG = {
  backendBase: '', // e.g. 'https://api.swapseat.in' — empty = demo mode (no order/hosted-page backend)

  razorpay: {
    keyId: '',          // 'rzp_test_…' — empty = mock UPI fallback
    currency: 'INR',
  },

  paypal: {
    clientId: '',       // PayPal REST App Client ID — empty = hidden
    currency: 'USD',
    // Optional: PayPal subscription Plan ID for Plus Monthly (Create in PayPal → Subscriptions → Plans)
    plusPlanId: '',
  },

  chargebee: {
    site: '',           // e.g. 'swapseat-test'
    publishableKey: '', // Chargebee publishable key — empty = hidden
    // Must match catalog in Chargebee (and server/example-server.js defaults):
    plans: { plusMonthly: 'plus-monthly', plusYearly: 'plus-yearly' },
  },

  prices: {
    single: { INR: 19,  USD: 0.49, label: 'Single swap unlock' },
    boost:  { INR: 29,  USD: 0.69, label: 'Boost 24h' },
    reveal: { INR: 19,  USD: 0.49, label: 'Instant reveal' },
    plusMonthly: { INR: 99, USD: 2.99, label: 'Plus Monthly' },
    plusYearly:  { INR: 999, USD: 29.0, label: 'Plus Yearly' },
  },
};

/* localStorage overrides from Billing Settings UI */
function effectivePayConfig() {
  try {
    const o = JSON.parse(localStorage.getItem('swapseat_paycfg') || '{}');
    return {
      backendBase: o.backendBase ?? PAYMENTS_CONFIG.backendBase,
      razorpay: { ...PAYMENTS_CONFIG.razorpay, ...(o.razorpay || {}) },
      paypal: { ...PAYMENTS_CONFIG.paypal, ...(o.paypal || {}) },
      chargebee: {
        ...PAYMENTS_CONFIG.chargebee,
        ...(o.chargebee || {}),
        plans: { ...PAYMENTS_CONFIG.chargebee.plans, ...((o.chargebee || {}).plans || {}) },
      },
      prices: PAYMENTS_CONFIG.prices,
    };
  } catch { return PAYMENTS_CONFIG; }
}
