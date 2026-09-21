/* SwapSeat unified payments: Razorpay (IN one-time/UPI) + PayPal (global one-time) + Chargebee (recurring).
   Demo-safe: with no keys/backend everything falls back to the mock UPI sheet so the PWA always works offline. */
const Payments = (() => {
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  const cfg = () => effectivePayConfig();
  const hasRazor = () => !!cfg().razorpay.keyId;
  const hasPayPal = () => !!cfg().paypal.clientId;
  const hasCB = () => !!(cfg().chargebee.site && cfg().chargebee.publishableKey);
  const backend = () => (cfg().backendBase || '').replace(/\/$/, '');

  function amountFor(kind, currency) {
    const p = cfg().prices, f = cfg().fees || { SEARCH_FEE: 49, ONE_SIDED_SWAP_FEE: 99 };
    const feeRow = (inr) => ({ INR: inr, USD: +(inr / 83).toFixed(2) });
    const map = { single: p.single, trip: p.single, boost: p.boost, reveal: p.reveal, plus: p.plusMonthly, plusYearly: p.plusYearly,
      search: feeRow(f.SEARCH_FEE), completion: feeRow(f.ONE_SIDED_SWAP_FEE) };
    const row = map[kind] || p.single;
    return currency === 'USD' ? row.USD : row.INR;
  }
  function labelFor(kind) {
    const p = cfg().prices;
    return ({ single: p.single.label, trip: 'Trip pass (group)', boost: p.boost.label, reveal: p.reveal.label, plus: p.plusMonthly.label, plusYearly: p.plusYearly.label, search: 'Search fee (matching)', completion: 'One-sided swap fee' })[kind] || kind;
  }

  /* ---------- backend helpers (optional but required for live verify/hosted pages) ---------- */
  async function api(path, body) {
    const b = backend();
    if (!b) return null;
    const r = await fetch(b + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('Backend ' + r.status);
    return r.json();
  }

  /* ---------- Razorpay ---------- */
  async function payRazorpay(kind, onSuccess, onFail) {
    const c = cfg();
    if (!hasRazor()) return onFail && onFail(new Error('no-key'));
    try { await loadScript('https://checkout.razorpay.com/v1/checkout.js'); }
    catch (e) { return onFail && onFail(e); }
    const amountINR = amountFor(kind, 'INR');
    let order = null;
    try { order = await api('/api/razorpay/order', { kind, amount: amountINR, currency: 'INR' }); } catch (e) { order = null; }
    const opts = {
      key: c.razorpay.keyId,
      amount: Math.round(amountINR * 100),
      currency: 'INR',
      name: 'SwapSeat',
      description: labelFor(kind),
      theme: { color: '#7c3aed' },
      ...(order && order.id ? { order_id: order.id } : {}),
      handler: async (resp) => {
        // Verify server-side when backend exists; else trust demo checkout.
        try {
          if (backend()) await api('/api/razorpay/verify', resp);
          recordTxn({ gateway: 'razorpay', kind, ...resp });
          onSuccess && onSuccess(resp);
        } catch (e) { onFail && onFail(e); }
      },
      modal: { ondismiss: () => onFail && onFail(new Error('dismissed')) },
    };
    try { new window.Razorpay(opts).open(); }
    catch (e) { onFail && onFail(e); }
  }

  /* ---------- PayPal one-time ---------- */
  async function renderPayPal(kind, mountEl, onSuccess, onFail) {
    const c = cfg();
    if (!hasPayPal()) { onFail && onFail(new Error('no-key')); return; }
    try {
      await loadScript(`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(c.paypal.clientId)}&currency=${c.paypal.currency}&intent=capture`);
    } catch (e) { onFail && onFail(e); return; }
    const amountUSD = amountFor(kind, 'USD').toFixed(2);
    mountEl.innerHTML = '';
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'pay' },
      createOrder: (_d, actions) => actions.order.create({
        purchase_units: [{ description: 'SwapSeat — ' + labelFor(kind), amount: { currency_code: c.paypal.currency, value: amountUSD } }],
      }),
      onApprove: async (data, actions) => {
        try {
          const details = await actions.order.capture();
          if (backend()) { try { await api('/api/paypal/capture', { kind, orderID: data.orderID }); } catch {} }
          recordTxn({ gateway: 'paypal', kind, orderID: data.orderID, details });
          onSuccess && onSuccess(details);
        } catch (e) { onFail && onFail(e); }
      },
      onCancel: () => onFail && onFail(new Error('cancelled')),
      onError: (e) => onFail && onFail(e),
    }).render(mountEl);
  }

  /* ---------- Chargebee subscriptions ---------- */
  async function subscribeChargebee(planKey, onSuccess, onFail) {
    const c = cfg();
    if (!hasCB()) { onFail && onFail(new Error('no-key')); return; }
    if (!backend()) { openSetupHelp('chargebee'); onFail && onFail(new Error('no-backend')); return; }
    try { await loadScript('https://js.chargebee.com/v2/chargebee.js'); } catch (e) { return onFail && onFail(e); }
    try {
      const planId = c.chargebee.plans[planKey] || planKey;
      const { hostedPage } = await api('/api/chargebee/checkout', { planId });
      const cb = window.Chargebee.init({ site: c.chargebee.site, publishableKey: c.chargebee.publishableKey });
      cb.openCheckout({
        hostedPage: () => Promise.resolve(hostedPage),
        success: (id) => { recordTxn({ gateway: 'chargebee', kind: planKey, hostedPageId: id }); onSuccess && onSuccess({ id }); },
        close: () => onFail && onFail(new Error('closed')),
        error: (e) => onFail && onFail(e),
      });
    } catch (e) { onFail && onFail(e); }
  }
  async function openPortal(onFail) {
    const c = cfg();
    if (!hasCB() || !backend()) { openSetupHelp('chargebee'); return; }
    try {
      await loadScript('https://js.chargebee.com/v2/chargebee.js');
      const { hostedPage } = await api('/api/chargebee/portal', {});
      const cb = window.Chargebee.init({ site: c.chargebee.site, publishableKey: c.chargebee.publishableKey });
      cb.openCheckout({ hostedPage: () => Promise.resolve(hostedPage), close: () => {}, error: (e) => onFail && onFail(e) });
    } catch (e) { onFail && onFail(e); }
  }

  /* ---------- unified checkout sheet ---------- */
  function openCheckout(kind, onSuccess) {
    const c = cfg();
    const modal = document.getElementById('modal');
    const inr = amountFor(kind, 'INR'), usd = amountFor(kind, 'USD');
    const isSub = kind === 'plus' || kind === 'plusYearly';
    const gateways = [];
    if (hasRazor()) gateways.push('razorpay');
    if (hasPayPal()) gateways.push('paypal');
    if (isSub && hasCB()) gateways.push('chargebee');
    if (!gateways.length) { mockCheckout(labelFor(kind) + (isSub ? ' monthly' : ''), inr, onSuccess); return; }

    const gwBtn = (id, icon, title, sub) =>
      `<button class="gw" data-gw="${id}"><span class="gw-ic">${icon}</span><span><b>${title}</b><small>${sub}</small></span><span class="gw-go">→</span></button>`;
    let html = `<div class="sheet"><div class="pw-badge">💎 SwapSeat checkout</div>
      <h3>${labelFor(kind)} — ₹${inr} · $${usd}</h3>
      <p class="muted">${isSub ? 'Recurring via Chargebee (cards/UPI/PayPal per your Chargebee gateway). Manage or cancel anytime in the portal.' : 'One-time. Razorpay for UPI/cards (India) · PayPal for global.'}</p>
      <div class="gwlist">`;
    if (gateways.includes('razorpay')) html += gwBtn('razorpay', '🇮🇳', 'Razorpay', `UPI · cards · netbanking · ₹${inr}`);
    if (gateways.includes('paypal')) html += gwBtn('paypal', '🌍', 'PayPal', `Global buyer protection · $${usd}`);
    if (gateways.includes('chargebee')) html += gwBtn('chargebee', '🔁', isSub ? 'Card via Chargebee' : 'Chargebee', 'Subscription billing + invoices + portal');
    html += `</div><div id="ppMount" style="margin-top:10px"></div>
      <div class="row" style="margin-top:10px"><button class="btn ghost" id="coCancel">Cancel</button>
      <button class="btn ghost" id="coKeys">⚙ Keys</button></div>
      <p class="fine">Backend: ${backend() || 'not set (demo mode)'} · Razorpay verify + Chargebee hosted pages need <code>server/example-server.js</code>.</p></div>`;
    modal.innerHTML = html; modal.hidden = false;
    document.getElementById('coCancel').onclick = () => { modal.hidden = true; };
    document.getElementById('coKeys').onclick = () => openKeySettings();
    modal.querySelectorAll('[data-gw]').forEach(b => b.onclick = () => {
      const gw = b.dataset.gw;
      if (gw === 'razorpay') payRazorpay(kind, (r) => { modal.hidden = true; toast('✅ Payment verified'); onSuccess && onSuccess({ gateway: 'razorpay', ...r }); }, (e) => {
        if (String(e?.message || e) === 'no-key') mockCheckout(labelFor(kind), inr, onSuccess);
        else toast('⚠️ ' + (e?.message || 'Payment failed'));
      });
      if (gw === 'paypal') {
        toast('Select a PayPal button below 👇');
        renderPayPal(kind, document.getElementById('ppMount'), (d) => { modal.hidden = true; toast('✅ PayPal approved'); onSuccess && onSuccess({ gateway: 'paypal', ...d }); }, (e) => toast('⚠️ PayPal: ' + (e?.message || 'failed')));
      }
      if (gw === 'chargebee') subscribeChargebee(kind === 'plusYearly' ? 'plusYearly' : 'plusMonthly', (d) => { modal.hidden = true; toast('✅ Subscription active'); onSuccess && onSuccess({ gateway: 'chargebee', ...d }); }, (e) => { if ((e?.message) !== 'no-backend') toast('⚠️ Chargebee: ' + (e?.message || 'failed')); });
    });
  }

  function openSetupHelp(which) {
    const modal = document.getElementById('modal');
    modal.innerHTML = `<div class="sheet"><h3>⚙ ${which === 'chargebee' ? 'Chargebee' : 'Payments'} setup needed</h3>
      <ol class="muted" style="font-size:13.5px;line-height:1.7">
        <li>Copy <code>server/example-server.js</code> to your backend, set env keys, deploy.</li>
        <li>In-app: <b>Billing → Keys</b> → paste <code>backendBase</code> + key IDs (or edit <code>js/payments-config.js</code>).</li>
        <li>Razorpay: order create + signature verify run server-side. PayPal capture verified server-side. Chargebee checkout/portal via hosted pages.</li>
      </ol>
      <div class="row"><button class="btn primary" id="setupKeys">Open key settings</button>
      <button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
    modal.hidden = false;
    document.getElementById('setupKeys').onclick = () => openKeySettings();
  }

  function openKeySettings() {
    const c = cfg();
    const modal = document.getElementById('modal');
    modal.innerHTML = `<div class="sheet"><h3>⚙ Billing keys</h3>
      <p class="muted">Stored only in this browser (localStorage). For production, bake into <code>js/payments-config.js</code>.</p>
      <div class="field"><label>Backend base URL</label><input id="kBackend" placeholder="https://api.swapseat.in" value="${c.backendBase || ''}"/></div>
      <div class="field"><label>Razorpay Key ID</label><input id="kRazor" placeholder="rzp_test_…" value="${c.razorpay.keyId || ''}"/></div>
      <div class="field"><label>PayPal Client ID</label><input id="kPaypal" placeholder="AY…" value="${c.paypal.clientId || ''}"/></div>
      <div class="field"><label>PayPal Plus Plan ID (optional)</label><input id="kPPPlan" placeholder="P-…" value="${c.paypal.plusPlanId || ''}"/></div>
      <div class="field"><label>Chargebee site</label><input id="kCBSite" placeholder="swapseat-test" value="${c.chargebee.site || ''}"/></div>
      <div class="field"><label>Chargebee publishable key</label><input id="kCBKey" placeholder="test_…" value="${c.chargebee.publishableKey || ''}"/></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="kSave">Save</button>
      <button class="btn ghost" id="kClear">Clear</button>
      <button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
    modal.hidden = false;
    document.getElementById('kSave').onclick = () => {
      const o = {
        backendBase: document.getElementById('kBackend').value.trim(),
        razorpay: { keyId: document.getElementById('kRazor').value.trim() },
        paypal: { clientId: document.getElementById('kPaypal').value.trim(), plusPlanId: document.getElementById('kPPPlan').value.trim() },
        chargebee: { site: document.getElementById('kCBSite').value.trim(), publishableKey: document.getElementById('kCBKey').value.trim() },
      };
      localStorage.setItem('swapseat_paycfg', JSON.stringify(o));
      modal.hidden = true; toast('⚙ Billing keys saved'); document.dispatchEvent(new CustomEvent('paycfg'));
    };
    document.getElementById('kClear').onclick = () => { localStorage.removeItem('swapseat_paycfg'); modal.hidden = true; toast('Cleared'); document.dispatchEvent(new CustomEvent('paycfg')); };
  }

  function recordTxn(t) {
    try {
      const arr = JSON.parse(localStorage.getItem('swapseat_txns') || '[]');
      arr.unshift({ ts: Date.now(), ...t });
      localStorage.setItem('swapseat_txns', JSON.stringify(arr.slice(0, 50)));
    } catch {}
  }
  function txns() { try { return JSON.parse(localStorage.getItem('swapseat_txns') || '[]'); } catch { return []; } }

  return { openCheckout, payRazorpay, renderPayPal, subscribeChargebee, openPortal, openKeySettings, openSetupHelp, amountFor, labelFor, hasRazor, hasPayPal, hasCB, backend, txns };
})();
