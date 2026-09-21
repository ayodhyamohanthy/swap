/* SwapSeat · explicit non-happy-path screens: offline, failure/timeout/stale
   quote/gateway error, and unsupported browser.
   ---------------------------------------------------------------------------
   PRODUCT CONTRACT: an offline or timed-out action is never shown as confirmed,
   and no screen may stay in a loading state. Every terminal state below offers
   a retry or a fallback action. */
(() => {
  if (typeof Flow === 'undefined') return;
  const esc = Flow.esc;

  const REASONS = {
    timeout: { icon: '⏱️', title: 'This took too long', body: 'The service did not answer in time. Nothing was sent and nothing was charged.', retry: 'Try again' },
    network: { icon: '📴', title: 'Connection lost', body: 'We could not reach SwapSeat. Your input is kept on this device.', retry: 'Retry' },
    gateway: { icon: '⚠️', title: 'Payment did not complete', body: 'The payment gateway refused or failed the request. No credits were applied and the swap was not confirmed.', retry: 'Retry payment' },
    stale: { icon: '🕒', title: 'This quote has expired', body: 'Fees and availability are revalidated before anything is charged. Refresh the quote to continue.', retry: 'Refresh quote' },
    rejected: { icon: '🚫', title: 'Request declined', body: 'The other traveller declined. Nothing was shared and no payment applies. You can search for another match.', retry: 'Back to matches' },
    generic: { icon: '⚠️', title: 'Something went wrong', body: 'The action did not complete. Nothing was confirmed.', retry: 'Try again' },
  };

  Flow.register({
    id: 'failure', title: 'Action not completed',
    render() {
      const r = REASONS[Flow.ctx.failureReason] || REASONS.generic;
      const back = Flow.ctx.failureBack || 'home';
      return `
      ${Flow.screenHead('Not completed', r.title, '')}
      <div class="fs-body">
        <div class="fcard state-block">
          <span class="sb-icon" aria-hidden="true">${r.icon}</span>
          <p class="fmuted">${esc(r.body)}</p>
          ${Flow.ctx.failureDetail ? `<p class="offline-na">${esc(Flow.ctx.failureDetail)}</p>` : ''}
        </div>
        ${Flow.offlineNote()}
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-fretry>${esc(r.retry)}</button>
          <button type="button" class="fbtn ghost block" data-go-scr="${esc(back)}">Back</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelector('[data-fretry]').addEventListener('click', () => {
        const target = Flow.ctx.failureRetry || Flow.ctx.failureBack || 'home';
        Flow.show(target);
      });
      root.querySelectorAll('[data-go-scr]').forEach((b) => b.addEventListener('click', () => Flow.show(b.dataset.goScr)));
    },
  });

  Flow.register({
    id: 'offline', title: 'You are offline',
    render() {
      return `
      ${Flow.screenHead('Offline', "You're offline", '')}
      <div class="fs-body">
        <div class="fcard state-block">
          <span class="sb-icon" aria-hidden="true">📴</span>
          <p class="fmuted">Searches, requests, acceptances and payments need a connection. Nothing is queued silently and nothing is shown as confirmed while you are offline.</p>
          <p class="offline-na" data-offline-stamp>Offline since this page loaded.</p>
        </div>
        <div class="fcard fcard--ghost">
          <div class="fsub">Still available</div>
          <p class="fmuted">Cached seat maps and your on-device ledger.</p>
          <div class="chips">
            <button type="button" class="chip" data-go-scr="history">Open history</button>
            <button type="button" class="chip" data-go-scr="seats">Your seat map</button>
          </div>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="offRetry">Retry connection</button>
          <button type="button" class="fbtn ghost block" data-go-scr="home">Home</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((b) => b.addEventListener('click', () => Flow.show(b.dataset.goScr)));
      root.querySelector('#offRetry').addEventListener('click', () => {
        if (typeof online === 'function' && !online()) { toast('📴 Still offline — the cached shell is being used.'); return; }
        Flow.show('home');
      });
    },
  });

  Flow.register({
    id: 'unsupported', title: 'Browser not supported',
    render() {
      return `
      ${Flow.screenHead('Compatibility', 'Update your browser', '')}
      <div class="fs-body">
        <div class="fcard state-block">
          <span class="sb-icon" aria-hidden="true">🧭</span>
          <p class="fmuted">This browser is missing features SwapSeat relies on (service worker / modern JavaScript). The maps and the ledger still work, but install-to-home-screen and offline mode are unavailable.</p>
          <p class="offline-na" data-capability-list></p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-scr="home">Continue anyway</button>
        </div>
        <p class="safe-note">Recommended: a current Chrome, Edge, Safari or Firefox release on Android or iOS.</p>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((b) => b.addEventListener('click', () => Flow.show(b.dataset.goScr)));
      const list = root.querySelector('[data-capability-list]');
      if (list) list.textContent = 'Missing: ' + missingFeatures().join(', ');
    },
  });

  /* ---------- capability detection (used by pwa.js at boot) ---------- */
  function missingFeatures() {
    const miss = [];
    if (!('serviceWorker' in navigator)) miss.push('service worker (offline mode)');
    if (typeof Promise === 'undefined') miss.push('Promises');
    if (typeof fetch === 'undefined') miss.push('fetch');
    if (!('localStorage' in window)) miss.push('local storage (ledger)');
    if (typeof AbortController === 'undefined') miss.push('request timeouts');
    return miss;
  }
  function supportsApp() {
    return typeof Promise !== 'undefined' && typeof fetch !== 'undefined' && 'localStorage' in window;
  }

  window.SwapSeatStates = { missingFeatures, supportsApp, REASONS,
    /* Route a failure to the dedicated screen without losing the retry target. */
    fail(reason, opts) {
      const o = opts || {};
      Flow.ctx.failureReason = reason || 'generic';
      Flow.ctx.failureBack = o.back || 'home';
      Flow.ctx.failureRetry = o.retry || o.back || 'home';
      Flow.ctx.failureDetail = o.detail || '';
      if (typeof online === 'function' && !online() && (reason === 'network' || reason === 'timeout')) {
        return Flow.show('offline');
      }
      return Flow.show('failure');
    },
  };
})();
