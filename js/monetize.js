/* Monetization: charge for convenience, never for seats or responses.
   - Viewing maps, listing, requesting, accepting, chatting: FREE.
   - Paid: Trip pass (multi-traveller group listings), Boost (24h highlight —
     cannot create a match, unused time refunded as credit), Plus (unlimited
     listings, saved household preferences, alerts).
   Swap in real keys via js/payments-config.js or Billing → Keys. */

const MONETIZE = {
  adsenseClient: '',        // e.g. 'ca-pub-XXXX' — empty = show tasteful placeholder slots
  currency: 'INR',
  freeListings: 5,
  plans: {
    free:  { swaps: 5,   price: 0,   label: 'Free' },
    trip:  { price: 19,  priceUSD: 0.49, label: 'Trip pass' },
    boost: { price: 29,  priceUSD: 0.69, label: 'Boost 24h' },
    plus:  { price: 99,  priceUSD: 2.99, label: 'Plus Monthly' },
    plusYearly: { price: 999, priceUSD: 29.0, label: 'Plus Yearly' },
  },
};

const Wallet = {
  get() {
    try {
      const w = JSON.parse(localStorage.getItem('swapseat_wallet') || '{}');
      return { plan: 'free', used: 0, credits: 0, boosts: 0, household: null, alerts: false, ...w };
    }
    catch { return { plan: 'free', used: 0, credits: 0, boosts: 0, household: null, alerts: false }; }
  },
  set(w) { localStorage.setItem('swapseat_wallet', JSON.stringify(w)); },
  activeListings() {
    try {
      const cur = JSON.parse(localStorage.getItem('swapseat_swaps') || '[]');
      return cur.filter(s => (s.state || 'open') === 'open').length;
    } catch { return 0; }
  },
  canPost() { const w = this.get(); if (w.plan === 'plus') return true; return this.activeListings() < MONETIZE.freeListings; },
  upgrade(gateway, ref) {
    const w = this.get();
    w.plan = 'plus'; w.gateway = gateway || 'demo'; w.since = Date.now(); w.ref = ref || null;
    this.set(w);
  },
  addBoost() { const w = this.get(); w.boosts = (w.boosts || 0) + 1; this.set(w); },
  useBoost() { const w = this.get(); if ((w.boosts || 0) > 0) { w.boosts--; this.set(w); return true; } return false; },
};

/* Unified checkout: real gateways when configured, mock sheet otherwise. */
function checkout(kind, onDone) {
  // kind: 'trip' | 'boost' | 'plus' | 'plusYearly'
  if (typeof Payments !== 'undefined') {
    Payments.openCheckout(kind, (res) => {
      if (kind === 'plus' || kind === 'plusYearly') Wallet.upgrade(res?.gateway, res?.id || res?.razorpay_payment_id || res?.orderID);
      if (kind === 'boost') Wallet.addBoost();
      onDone && onDone(res);
    });
  } else {
    mockCheckout(kind, 29, onDone);
  }
}

function paywallHTML(reason) {
  const P = (typeof PAYMENTS_CONFIG !== 'undefined') ? PAYMENTS_CONFIG.prices : null;
  const trip = P ? `₹${P.single.INR} · $${P.single.USD}` : '₹19';
  const boost = P ? `₹${P.boost.INR} · $${P.boost.USD}` : '₹29';
  const plusM = P ? `₹${P.plusMonthly.INR} · $${P.plusMonthly.USD}` : '₹99';
  const plusY = P ? `₹${P.plusYearly.INR} · $${P.plusYearly.USD}` : '₹999';
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
    <h3>${reason || 'Free matching, paid convenience'}</h3>
    <p class="muted">Maps, listings, requests, accepts and chat are <b>free forever</b>. Paid extras never buy a seat and never guarantee a match.</p>
    <div class="plans">
      <div class="plan"><b>Trip pass</b><span>${trip} · group listing</span><button class="btn ghost" data-pay="trip">Group of 2+</button></div>
      <div class="plan"><b>Boost 24h</b><span>${boost} · top of list</span><button class="btn ghost" data-pay="boost">Boost</button></div>
      <div class="plan hot"><b>Plus Monthly</b><span>${plusM} · unlimited</span><button class="btn primary" data-pay="plus">Go Plus</button></div>
      <div class="plan"><b>Plus Yearly</b><span>${plusY} · 2 mo free</span><button class="btn ghost" data-pay="plusYearly">Go Yearly</button></div>
    </div>
    <p class="fine">Boost only highlights your listing for 24h — it can't create a match. Unused boost time is refunded as credit. Plus = unlimited listings, saved household preferences, instant demo alerts.</p>
    <p class="fine">UPI · Cards · Netbanking · PayPal · <span class="mock">${gwLine}</span></p>
  </div>`;
}

function mockCheckout(label, amount, onDone) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="sheet"><h3>💳 ${label} — ₹${amount}</h3>
    <p class="muted">Demo checkout. Add keys in <b>Billing → Keys</b> for live payments.</p>
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
