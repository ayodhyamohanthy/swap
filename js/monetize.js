/* Monetization: freemium + Plus + boost + pay-per-swap + ads/affiliates (client mock).
   Swap in real Razorpay/AdSense keys via MONETIZE config. */

const MONETIZE = {
  adsenseClient: '',        // e.g. 'ca-pub-XXXX' — empty = show tasteful placeholder slots
  razorpayKey: '',          // empty = UPI mock checkout
  currency: 'INR',
  plans: {
    free:  { swaps: 1,  price: 0,   label: 'Free' },
    plus:  { swaps: 999, price: 99, priceUSD: 2.99, label: 'Plus' },
    boost: { price: 29,  label: 'Boost 24h' },
    reveal:{ price: 19,  label: 'Instant reveal' },
  },
};

const Wallet = {
  get() {
    try {
      const w = JSON.parse(localStorage.getItem('swapseat_wallet') || '{"plan":"free","used":0,"credits":0,"boosts":[]}');
      // Expire demo Plus? Real expiry comes from Chargebee webhook → backend → app. Keep client hint:
      return { plan: 'free', used: 0, credits: 0, boosts: [], ...w };
    }
    catch { return { plan: 'free', used: 0, credits: 0, boosts: [] }; }
  },
  set(w) { localStorage.setItem('swapseat_wallet', JSON.stringify(w)); },
  canPost() { const w = this.get(); if (w.plan === 'plus') return true; return w.used < MONETIZE.plans.free.swaps; },
  consumePost() { const w = this.get(); if (w.plan !== 'plus') { w.used++; this.set(w); } },
  upgrade(gateway, ref) {
    const w = this.get();
    w.plan = 'plus'; w.gateway = gateway || 'demo'; w.since = Date.now(); w.ref = ref || null;
    this.set(w);
  },
  downgrade() { const w = this.get(); w.plan = 'free'; delete w.gateway; this.set(w); },
};

/* Unified checkout: real gateways when configured, mock sheet otherwise. */
function checkout(kind, onDone) {
  // kind: 'single' | 'plus' | 'plusYearly' | 'boost' | 'reveal'
  if (typeof Payments !== 'undefined') {
    Payments.openCheckout(kind, (res) => {
      if (kind === 'plus' || kind === 'plusYearly') Wallet.upgrade(res?.gateway, res?.id || res?.razorpay_payment_id || res?.orderID);
      onDone && onDone(res);
    });
  } else {
    mockCheckout(kind, MONETIZE.plans.plus.price, onDone);
  }
}

function paywallHTML(reason) {
  const w = Wallet.get();
  const P = (typeof PAYMENTS_CONFIG !== 'undefined') ? PAYMENTS_CONFIG.prices : null;
  const single = P ? `₹${P.single.INR} · $${P.single.USD}` : '₹19';
  const plusM = P ? `₹${P.plusMonthly.INR} · $${P.plusMonthly.USD}` : '₹99';
  const plusY = P ? `₹${P.plusYearly.INR} · $${P.plusYearly.USD}` : '₹999';
  const boost = P ? `₹${P.boost.INR} · $${P.boost.USD}` : '₹29';
  let gwLine = 'demo checkout';
  try {
    if (typeof Payments !== 'undefined') {
      const on = [];
      if (Payments.hasRazor()) on.push('Razorpay ✓');
      if (Payments.hasPayPal()) on.push('PayPal ✓');
      if (Payments.hasCB()) on.push('Chargebee ✓');
      gwLine = on.length ? on.join(' · ') : 'demo checkout (add keys in Billing → Keys)';
    }
  } catch {}
  return `
  <div class="paywall">
    <div class="pw-badge">💎 SwapSeat Plus</div>
    <h3>${reason || 'You used your free swap'}</h3>
    <p class="muted">Free = ${MONETIZE.plans.free.swaps} active swap / month. Plus = unlimited swaps, priority matching, verified badge, instant alerts.</p>
    <div class="plans">
      <div class="plan"><b>Pay-per-swap</b><span>${single} / swap</span><button class="btn ghost" data-pay="single">Continue</button></div>
      <div class="plan hot"><b>Plus Monthly</b><span>${plusM} · unlimited</span><button class="btn primary" data-pay="plus">Go Plus</button></div>
      <div class="plan"><b>Plus Yearly</b><span>${plusY} · 2 mo free</span><button class="btn ghost" data-pay="plusYearly">Go Yearly</button></div>
      <div class="plan"><b>Boost 24h</b><span>${boost} · top of list</span><button class="btn ghost" data-pay="boost">Boost</button></div>
    </div>
    <p class="fine">UPI · Cards · Netbanking · PayPal · <span class="mock">${gwLine}</span></p>
    <p class="fine">Free tier resets monthly · requesters pay a small fee, helpers earn credits (Swapr model). Subscriptions via Chargebee — cancel anytime in portal.</p>
  </div>`;
}

function mockCheckout(label, amount, onDone) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="sheet"><h3>💳 ${label} — ₹${amount}</h3>
    <p class="muted">Demo UPI checkout. Add <code>razorpayKey</code> in <code>js/monetize.js</code> for live payments.</p>
    <div class="upi-box"> <b>UPI ID:</b> swapseat@upi <br> <div class="qr-fake">▦▦▦ QR ▦▦▦</div></div>
    <div class="row"><button class="btn primary" id="payOk">Pay ₹${amount}</button>
    <button class="btn ghost" id="payCancel">Cancel</button></div></div>`;
  modal.hidden = false;
  document.getElementById('payCancel').onclick = () => { modal.hidden = true; };
  document.getElementById('payOk').onclick = () => { modal.hidden = true; toast(`✅ ${label} activated`); onDone && onDone(); };
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2600);
}
