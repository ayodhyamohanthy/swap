/* SwapSeat · PWA runtime: service-worker lifecycle, install prompt, network
   status banner, in-progress form draft, and capability fallbacks.
   ---------------------------------------------------------------------------
   Rules honoured here (see docs/PWA.md):
     · Offline is stated, never simulated: the banner is explicit and an
       offline tap never becomes a confirmation.
     · Install/update/offline changes are announced to assistive technology.
     · Form drafts are kept on device so a reconnect does not lose input, but
       never for sensitive fields (PNR, surname, name, contact details).
   ------------------------------------------------------------------------- */
(() => {
  const DRAFT_KEY = 'swapseat_draft_v1';
  const SYNC_KEY = 'swapseat_last_sync';
  const SENSITIVE = /pnr|surname|email|phone|name|passenger|paycfg/i;
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ---------- network status ---------- */
  function stampLastSync() {
    if (navigator.onLine === false) return;
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(new Date().toISOString())); } catch { /* ignore */ }
  }
  function lastSyncText() {
    let raw = null;
    try { raw = localStorage.getItem(SYNC_KEY); } catch { /* ignore */ }
    if (!raw) return 'never synced on this device';
    try { return 'last updated ' + new Date(JSON.parse(raw)).toLocaleString(); } catch { return 'last updated ' + raw; }
  }
  function updateNetBar() {
    const bar = document.getElementById('offlineBar');
    const off = navigator.onLine === false;
    if (bar) {
      bar.hidden = !off;
      bar.setAttribute('role', 'status');
      bar.setAttribute('aria-live', 'polite');
      bar.innerHTML = off
        ? '📴 <b>Offline</b> — cached maps and your history only. Searches, requests and payments resume when you reconnect.<span class="net-ts">' + lastSyncText() + '</span>'
        : bar.innerHTML;
    }
    document.querySelectorAll('[data-offline-note]').forEach((n) => { n.hidden = !off; });
    document.querySelectorAll('[data-offline-stamp]').forEach((n) => { n.textContent = 'Cached data ' + lastSyncText() + '.'; });
  }
  window.addEventListener('online', () => { stampLastSync(); updateNetBar(); });
  window.addEventListener('offline', () => updateNetBar());

  /* ---------- service worker ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(nw);
        });
      });
      // Poll gently for a new release (10 min) so long-lived sessions can update.
      setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
    }).catch(() => { /* registration failure is non-fatal: app still works online */ });
  }
  let reloading = false;
  function showUpdateBar(worker) {
    const bar = document.getElementById('updateBar');
    if (!bar || !bar.hidden) return;
    bar.hidden = false;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    const go = document.getElementById('updateGo');
    const no = document.getElementById('updateNo');
    if (go) go.onclick = () => { reloading = true; worker.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => location.reload(), 300); };
    if (no) no.onclick = () => { bar.hidden = true; };
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  }

  /* ---------- install prompt ---------- */
  let deferred = null;
  function addFlowInstallBtn(show) {
    const top = document.querySelector('.fs-top');
    if (!top) return;
    let btn = document.getElementById('flowInstall');
    if (!show) { if (btn) btn.remove(); return; }
    if (btn) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'flowInstall';
    btn.className = 'chip';
    btn.textContent = '⬇ Install';
    btn.setAttribute('aria-label', 'Install SwapSeat on this device');
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      const res = await deferred.userChoice.catch(() => null);
      announce(res && res.outcome === 'accepted' ? 'Install accepted.' : 'Install dismissed.');
      deferred = null;
      addFlowInstallBtn(false);
    });
    const pill = document.getElementById('fsPill');
    top.insertBefore(btn, pill || null);
  }
  function announce(msg) {
    const live = document.getElementById('flowLive');
    if (live) live.textContent = msg;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!isStandalone()) addFlowInstallBtn(true);
  });
  window.addEventListener('appinstalled', () => { addFlowInstallBtn(false); announce('SwapSeat installed.'); toast('📲 SwapSeat installed — it will open offline.'); });
  function maybeIosHint() {
    if (!isIOS() || isStandalone()) return;
    let seen = null;
    try { seen = sessionStorage.getItem('swapseat_ios_hint'); } catch { /* ignore */ }
    if (seen) return;
    const bar = document.getElementById('iosHint');
    if (!bar) return;
    bar.hidden = false;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    try { sessionStorage.setItem('swapseat_ios_hint', '1'); } catch { /* ignore */ }
    const no = document.getElementById('iosNo');
    if (no) no.onclick = () => { bar.hidden = true; };
  }

  /* ---------- in-progress form draft (never for sensitive fields) ---------- */
  let saveTimer = null;
  function currentScreen() {
    const m = document.getElementById('flowScreen');
    return m && m.getAttribute('data-screen');
  }
  function saveDraft() {
    const mount = document.getElementById('flowScreen');
    if (!mount) return;
    const screen = currentScreen();
    if (!screen) return;
    const values = {};
    mount.querySelectorAll('input,select,textarea').forEach((el) => {
      if (!el.id || SENSITIVE.test(el.id)) return;
      if (el.type === 'checkbox' || el.type === 'radio') values[el.id] = el.checked;
      else if (el.value) values[el.id] = el.value;
    });
    try {
      if (!Object.keys(values).length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ schemaVersion: 1, screen, savedAt: new Date().toISOString(), values }));
    } catch { /* ignore */ }
  }
  function restoreDraft() {
    const screen = currentScreen();
    if (!screen) return;
    if (['requestSent', 'confirmed', 'accepted', 'done'].indexOf(screen) >= 0) {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      return;
    }
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { /* ignore */ }
    if (!draft || draft.screen !== screen || !draft.values) return;
    const mount = document.getElementById('flowScreen');
    let restored = 0;
    Object.keys(draft.values).forEach((id) => {
      const el = document.getElementById(id);
      if (!el || !mount.contains(el)) return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!draft.values[id];
      else if (!el.value) el.value = draft.values[id];
      restored++;
    });
    if (restored) announce('Restored what you had typed on this screen.');
  }
  function watchFlow() {
    const mount = document.getElementById('flowScreen');
    if (!mount) return;
    let last = mount.getAttribute('data-screen');
    new MutationObserver(() => {
      const now = mount.getAttribute('data-screen');
      if (now !== last) { last = now; restoreDraft(); }
    }).observe(mount, { attributes: true, attributeFilter: ['data-screen'], childList: true, subtree: false });
    mount.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 400); });
    mount.addEventListener('change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 400); });
    restoreDraft();
  }

  /* ---------- boot ---------- */
  function boot() {
    stampLastSync();
    updateNetBar();
    registerSW();
    watchFlow();
    const states = window.SwapSeatStates;
    if (states && !states.supportsApp()) { setTimeout(() => Flow.show('unsupported'), 0); }
    const q = new URLSearchParams(location.search);
    const deep = q.get('screen');
    if (deep === 'history') setTimeout(() => Flow.show('history'), 0);
    setTimeout(maybeIosHint, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
