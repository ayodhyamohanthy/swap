/* SeatSwap app — Build Plan Steps 1 (Foundation) + 2 (Trips).
   Screens match designs/*.jpg "as is"; AGENTS.md rules win on any conflict
   (3 tabs, no tab bar on setup screens, Google-only sign-in deferred,
   required footer sentence). Trips work signed out; every state change
   writes activity_log via SeatSwapStore. */
const SeatSwapApp = (() => {
  const mount = () => document.getElementById('screen');
  const tabsEl = () => document.getElementById('tabs');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (k, v) => SeatSwapI18n.t(k, v);
  const SETUP = new Set(['language', 'note', 'privacy', 'alerts', 'signin', 'goodbye']);
  const extra = {}; // screens registered by seatswap-screens*.js: {render(r)->{html,tab}, wire(el,r)}

  /* ---------- SVG artwork (design palette via tokens; no literal colors) ---------- */
  const IC = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const Art = {
    train: IC('<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/><path d="M9 3 7 1.5M15 3l2-1.5"/>'),
    bell: IC('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    gear: IC('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2 17 7M7 17l-1.8 1.8"/>'),
    back: IC('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
    chevR: '<span class="chev" aria-hidden="true">›</span>',
    plus: IC('<path d="M12 5v14M5 12h14"/>'),
    gift: IC('<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M6 13v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7M12 9v12M12 9S5 9 4 7a2 2 0 0 1 3.5-1.5C9 7 12 9 12 9zm0 0s7 0 8-2A2 2 0 0 0 16.5 5.5C15 7 12 9 12 9z"/>'),
    coins: IC('<ellipse cx="9" cy="7" rx="5" ry="2.4"/><path d="M4 7v4c0 1.3 2.2 2.4 5 2.4s5-1.1 5-2.4V7"/><path d="M4 11v4c0 1.3 2.2 2.4 5 2.4s5-1.1 5-2.4v-4"/><circle cx="17.5" cy="16.5" r="3.5"/><path d="M17.5 14.8v3.4M16 15.5h3"/>'),
    shieldCheck: IC('<path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.6 7 9 4.1-1.4 7-4.6 7-9V5.8z"/><path d="m9 11.5 2.2 2.2L15.5 9.5"/>'),
    phone: IC('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    swapArrows: IC('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
    idCard: IC('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16.5c.6-1.7 1.7-2.5 3-2.5s2.4.8 3 2.5M14 9.5h4M14 13h4"/>'),
    people: IC('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.8-3 2.9-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.5 14.6c2.3.2 4 1.6 4.7 4"/>'),
    doc: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 13h5M10 17h5"/>'),
    suitcase: IC('<rect x="4" y="8" width="16" height="12" rx="2.5"/><path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8M4 13h16"/>'),
    globe: IC('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3z"/>'),
    help: IC('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3A2.6 2.6 0 0 1 12 7.5c1.4 0 2.6 1 2.6 2.3 0 1.8-2.3 2-2.3 3.7"/><circle cx="12.2" cy="17" r="0.4"/>'),
    check: IC('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    home: IC('<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/>'),
    homeFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5 3.5 11h2.3V20.5h4.7v-6h3v6h4.7V11h2.3z"/></svg>',
    swapTab: IC('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
    person: IC('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-3.6 3.6-5.4 7-5.4s6 1.8 7 5.4"/>'),
    personFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="3.8"/><path d="M4.8 20.2c1-3.8 3.7-5.7 7.2-5.7s6.2 1.9 7.2 5.7z"/></svg>',
    clip: IC('<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 4.5h6"/><path d="M9 11h6M9 14.5h6"/>'),
    lock: IC('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    link: IC('<path d="M10 14a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.6-5.6l-1.7 1.7M14 10a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.6 5.6l1.7-1.7"/>'),
    alert: IC('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.4"/>'),
    googleG: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="currentColor" opacity=".65" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="currentColor" opacity=".4" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/><path fill="currentColor" opacity=".8" d="M12 5.9c1.5 0 2.8.5 3.8 1.5L18.7 4A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z"/></svg>',
    scene: `<svg class="art art--scene" viewBox="0 0 340 150" role="img" aria-label="Train illustration">
      <circle cx="252" cy="34" r="17" style="fill:var(--art-sun)"/>
      <path d="M0 118 Q60 62 130 104 Q200 140 270 96 Q310 70 340 88 L340 150 L0 150 Z" style="fill:var(--tint-green)"/>
      <path d="M0 132 Q80 92 170 122 Q250 144 340 116 L340 150 L0 150 Z" style="fill:var(--art-sage)" opacity=".55"/>
      <rect x="52" y="66" width="236" height="52" rx="14" style="fill:var(--card)" stroke="var(--line)"/>
      <rect x="52" y="96" width="236" height="9" style="fill:var(--accent)"/>
      <rect x="64" y="76" width="30" height="16" rx="4" style="fill:var(--art-sage)"/>
      <rect x="100" y="76" width="30" height="16" rx="4" style="fill:var(--art-sage)"/>
      <rect x="136" y="76" width="30" height="16" rx="4" style="fill:var(--art-sage)"/>
      <rect x="172" y="76" width="30" height="16" rx="4" style="fill:var(--art-sage)"/>
      <rect x="208" y="76" width="30" height="16" rx="4" style="fill:var(--art-sage)"/>
      <rect x="244" y="76" width="30" height="16" rx="4" style="fill:var(--primary)"/>
      <circle cx="104" cy="122" r="9" style="fill:var(--ink-soft)"/><circle cx="236" cy="122" r="9" style="fill:var(--ink-soft)"/>
      <rect x="30" y="128" width="280" height="5" rx="2.5" style="fill:var(--art-track)"/></svg>`,
    shieldHero: `<svg class="art art--mark" viewBox="0 0 128 128" role="img" aria-label="Privacy illustration">
      <circle cx="64" cy="64" r="58" style="fill:var(--tint-green)"/>
      <path d="M64 22 36 33v26c0 22 12 36 28 43 16-7 28-21 28-43V33z" style="fill:var(--primary)"/>
      <rect x="52" y="58" width="24" height="20" rx="4" style="fill:var(--card)"/>
      <path d="M57 58v-4a7 7 0 0 1 14 0v4" fill="none" style="stroke:var(--card)" stroke-width="5" stroke-linecap="round"/>
      <circle cx="64" cy="66" r="2.6" style="fill:var(--primary)"/></svg>`,
    bellHero: `<svg class="art art--mark" viewBox="0 0 128 128" role="img" aria-label="Alerts illustration">
      <circle cx="64" cy="64" r="58" style="fill:var(--tint-peach)"/>
      <path d="M42 58a22 22 0 0 1 44 0c0 16 6 20 6 20H36s6-4 6-20z" style="fill:var(--art-sun)"/>
      <rect x="56" y="80" width="16" height="9" rx="4.5" style="fill:var(--accent)"/>
      <circle cx="64" cy="98" r="5" style="fill:var(--art-sun)"/>
      <g style="stroke:var(--accent)" stroke-width="4" stroke-linecap="round"><path d="M22 52l8 4M22 68l8-1M106 52l-8 4M106 68l-8-1"/></g></svg>`,
    ticketHero: `<svg class="art art--mark" viewBox="0 0 140 128" role="img" aria-label="Cancelled ticket illustration">
      <circle cx="64" cy="64" r="58" style="fill:var(--tint-pink)"/>
      <g transform="rotate(-18 64 60)"><rect x="30" y="40" width="68" height="40" rx="8" style="fill:var(--card)" stroke="var(--art-track)" stroke-width="2"/>
      <path d="M52 40v40" stroke-dasharray="4 4" style="stroke:var(--art-track)" stroke-width="2"/>
      <circle cx="30" cy="60" r="6" style="fill:var(--tint-pink)"/><circle cx="98" cy="60" r="6" style="fill:var(--tint-pink)"/></g>
      <circle cx="96" cy="88" r="17" style="fill:var(--red)"/>
      <path d="M89 81l14 14M103 81l-14 14" style="stroke:var(--card)" stroke-width="4" stroke-linecap="round"/></svg>`,
  };

  /* ---------- shared chrome ---------- */
  function footer(split) {
    return split
      ? `<footer class="footer"><p class="footer--split"><span>${esc(T('first.noSignin'))}</span><span aria-hidden="true">·</span><span>${esc(T('footer.line2'))}</span></p></footer>`
      : `<footer class="footer"><p>${esc(T('footer.line1'))}</p><p>${esc(T('footer.line2'))}</p></footer>`;
  }
  function homeHead(action) {
    return `<header class="topbar"><span class="wordmark">${esc(T('brand.wordmark'))}</span><span class="spacer"></span>
      ${action === 'gear'
        ? `<a class="iconbtn" href="#/profile/settings" aria-label="${esc(T('profile.settings'))}">${Art.gear}</a>`
        : `<a class="iconbtn" href="#/swaps" aria-label="${esc(T('nav.swaps'))}">${Art.bell}</a>`}</header>`;
  }
  function innerHead(action) {
    return `<header class="topbar topbar--inner"><button type="button" class="iconbtn" id="backBtn" aria-label="${esc(T('common.back'))}">${Art.back}</button>
      <span class="wordmark">${esc(T('brand.wordmark'))}</span>
      ${action === 'bell' ? `<a class="iconbtn" href="#/swaps" aria-label="${esc(T('nav.swaps'))}">${Art.bell}</a>` : '<span style="width:44px"></span>'}</header>`;
  }
  function tabs(active) {
    const items = [['home', T('nav.home'), '#/', false], ['swaps', T('nav.swaps'), '#/swaps', false], ['profile', T('nav.profile'), '#/profile', false]];
    return items.map(([id, label, href]) => {
      const on = active === id;
      const icon = id === 'home' ? (on ? Art.homeFill : Art.home)
        : id === 'swaps' ? Art.swapTab : (on ? Art.personFill : Art.person);
      return `<a href="${href}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${icon}<span>${esc(label)}</span></a>`;
    }).join('');
  }
  function setTabs(active) {
    const el = tabsEl();
    if (!el) return;
    if (SETUP.has(active)) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = tabs(active);
  }
  function offlineBar() {
    return `<div class="offlinebar" id="offlineBar" hidden>${esc(T('offline.bar'))}</div>`;
  }
  function paintOffline() {
    const bar = document.getElementById('offlineBar');
    if (bar) bar.hidden = navigator.onLine !== false;
  }
  function fmtDate(d) {
    if (!d) return '';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString(SeatSwapI18n.getLang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
    } catch { return d; }
  }
  function bindBack(root, fallback) {
    const b = root.querySelector('#backBtn');
    if (b) b.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.hash = fallback || '#/';
    });
  }

  /* ---------- HOME: first open (no trips) ---------- */
  function homeEmpty() {
    return `${homeHead('gear')}<main class="body">
      <h1 class="h-title center" style="margin-top:26px">${esc(T('first.title'))}</h1>
      <form id="quickPnr" novalidate style="margin-top:14px">
        <div class="inputwrap"><span class="inicon">${Art.train}</span>
          <input id="qPnr" class="input" inputmode="numeric" maxlength="10" autocomplete="off"
            placeholder="${esc(T('first.pnrPlaceholder'))}" aria-label="${esc(T('first.pnrLabel'))}" />
        </div>
        <p class="err" id="qErr" role="alert" hidden></p>
        <button class="pastelink" type="button" id="qPaste">${Art.clip}<span>${esc(T('first.paste'))}</span></button>
        <button class="btn" type="submit">${esc(T('first.find'))}</button>
      </form>
      <section class="card card--peach"><div class="banner" style="cursor:default">
        <span class="tile tile--peach">${Art.gift}</span>
        <span class="btxt"><b>${esc(T('first.hint'))}</b></span>${Art.chevR}
      </div></section>
      ${footer(true)}</main>`;
  }

  /* ---------- HOME: my trips ---------- */
  function home() {
    const list = SeatSwapStore.trips();
    if (!list.length) return homeEmpty();
    const credit = SeatSwapStore.creditPaise();
    const cards = list.map((t) => {
      const p = t.passengers[0] || {};
      const sub = `${esc(t.train_no)} · ${esc(t.from_code || '')} → ${esc(t.to_code || '')}`.trim();
      return `<a class="card tripcard" href="#/trips/${t.id}" style="margin:8px 0">
        <span class="tripthumb">${Art.train}</span>
        <span class="tripmain"><b>${esc(t.train_name || t.train_no || '—')}</b>
        <small>${sub}</small><small>${esc(fmtDate(t.journey_date))}</small>
        <span><span class="pill">${t.open_to_swap ? esc(T('home.openToSwap')) : esc(T('home.firstHere'))}</span></span></span>
        ${Art.chevR}</a>`;
    }).join('');
    return `${homeHead('gear')}<main class="body">
      <p class="subtitle" style="margin-top:10px">${esc(T('brand.tagline'))}</p>
      ${credit > 0 ? `<a class="creditbanner" href="#/profile" style="text-decoration:none;color:inherit">
        <span class="tile tile--peach">${Art.coins}</span>
        <span class="btxt" style="flex:1"><b>${esc(T('home.creditWaiting', { amount: (credit / 100).toFixed(0) }))}</b>
        <small>${esc(T('home.creditUse'))}</small></span>${Art.chevR}</a>` : ''}
      <div class="rowhead"><h2 class="h-section">${esc(T('home.trips'))}</h2></div>
      ${cards}
      <div class="fabrow"><a class="fabcol" href="#/trips/add" aria-label="${esc(T('home.addPnr'))}">
        <span class="fab">${Art.plus}</span><span>${esc(T('home.addPnr'))}</span></a></div>
      ${footer(false)}</main>`;
  }
  function wireHome(root) {
    const f = root.querySelector('#quickPnr');
    if (f) {
      const go = async (e) => {
        if (e) e.preventDefault();
        const v = root.querySelector('#qPnr').value;
        const err = root.querySelector('#qErr');
        if (!SeatSwapPNR.validPNR(v)) {
          err.textContent = T('add.must10') + ' ' + T('add.invalid');
          err.hidden = false;
          return;
        }
        err.hidden = true;
        sessionStorage.setItem('seatswap_prefill_pnr', SeatSwapPNR.digitsOnly(v));
        location.hash = '#/trips/add';
      };
      f.addEventListener('submit', go);
      const paste = root.querySelector('#qPaste');
      if (paste) paste.addEventListener('click', () => { location.hash = '#/trips/add'; });
    }
  }

  /* ---------- SETUP: language / note / privacy / alerts / signin ---------- */
  function language() {
    const cur = SeatSwapI18n.getLang();
    return `<main class="body body--setup">
      <p class="wordmark wordmark--center">${esc(T('brand.wordmark'))}</p>
      <h1 class="h-title" style="margin-top:34px">${esc(T('language.title'))}</h1>
      <div class="langlist">
        <button type="button" data-lang="en" class="langcard ${cur === 'en' ? 'on' : ''}"><span>English</span>${Art.chevR}</button>
        <button type="button" data-lang="hi" class="langcard ${cur === 'hi' ? 'on' : ''}"><span>हिन्दी</span>${Art.chevR}</button>
      </div>
      <p class="fine center">${esc(T('language.more'))}</p>
      <button type="button" class="btn" id="langGo">${esc(T('language.continue'))}</button></main>`;
  }
  function note() {
    const items = [
      [Art.phone, 'peach', T('note.c1')],
      [Art.swapArrows, 'sage', T('note.c2')],
      [Art.idCard, 'peach', T('note.c3')],
    ];
    return `<main class="body body--setup">
      <p class="wordmark wordmark--center">${esc(T('brand.wordmark'))}</p>
      <h1 class="h-title" style="margin-top:30px">${esc(T('note.title'))}</h1>
      ${items.map(([icon, tone, text]) => `<section class="card"><div class="iconcard">
        <span class="tile tile--${tone}">${icon}</span><b style="font-size:16.5px">${esc(text)}</b></div></section>`).join('')}
      <button type="button" class="btn" id="noteGo">${esc(T('note.got'))}</button>
      ${footer(false)}</main>`;
  }
  function privacy() {
    const rows = [[T('privacy.i1t'), T('privacy.i1s')], [T('privacy.i2t'), T('privacy.i2s')], [T('privacy.i3t'), T('privacy.i3s')]];
    return `${innerHead()}<main class="body">
      ${Art.shieldHero}
      <h1 class="h-title center">${esc(T('privacy.title'))}</h1>
      <p class="subtitle center">${esc(T('privacy.sub'))}</p>
      ${rows.map(([t, s]) => `<div class="checkrow"><span class="checkdot">${Art.check}</span>
        <span><b>${esc(t)}</b><small>${esc(s)}</small></span></div>`).join('')}
      <button type="button" class="btn" id="agreeBtn">${esc(T('privacy.agree'))}</button>
      ${footer(false)}</main>`;
  }
  function alerts() {
    return `<main class="body body--setup">
      <p class="wordmark wordmark--center">${esc(T('brand.wordmark'))}</p>
      ${Art.bellHero}
      <h1 class="h-title center">${esc(T('alerts.title'))}</h1>
      <p class="subtitle center">${esc(T('alerts.body'))}</p>
      <button type="button" class="btn" id="alertsOn" style="margin-top:18px">${esc(T('alerts.on'))}</button>
      <button type="button" class="linklike linklike--muted linklike--center" id="alertsLater">${esc(T('alerts.later'))}</button>
    </main>`;
  }
  function signin() {
    const real = (typeof SeatSwapAuth !== 'undefined' && SeatSwapAuth.realGoogle());
    const demo = (typeof SeatSwapConfig === 'undefined' || SeatSwapConfig.demoAuth !== false);
    return `${innerHead()}<main class="body body--setup" style="padding-top:10px">
      <p class="wordmark wordmark--center">${esc(T('brand.wordmark'))}</p>
      <h1 class="h-title center" style="margin-top:26px">${esc(T('signin.title'))}</h1>
      <p class="subtitle center">${esc(T('signin.body'))}</p>
      <div id="googleSlot" style="margin-top:14px"></div>
      ${real ? '' : `<button type="button" class="btn btn--ghost" id="googleBtn" disabled><span style="width:22px;height:22px;display:inline-flex">${Art.googleG}</span>${esc(T('signin.google'))}</button>`}
      ${demo ? `<form id="demoLogin" class="card" style="margin-top:10px">
        <b>${esc(T('signin.demoTitle'))}</b>
        <p class="fine">${esc(T('signin.demoBody'))}</p>
        <label class="label" for="dName">${esc(T('signin.demoName'))}</label>
        <input id="dName" class="input" autocomplete="given-name" placeholder="Ravi" />
        <p class="err" id="dErr" role="alert" hidden></p>
        <button class="btn" type="submit">${esc(T('common.continue'))}</button>
      </form>` : ''}
      <p class="lockline">${Art.lock}<span>${esc(T('signin.safe'))} ${esc(T('signin.note'))}</span></p>
      ${footer(false)}</main>`;
  }

  /* ---------- ADD PNR ---------- */
  function add() {
    const pre = sessionStorage.getItem('seatswap_prefill_pnr') || '';
    sessionStorage.removeItem('seatswap_prefill_pnr');
    const today = new Date().toISOString().slice(0, 10);
    const clsOpts = SeatSwapPNR.CLASSES.map((c) => `<option value="${c}">${c}</option>`).join('');
    return `${innerHead()}<main class="body">
      ${Art.scene}
      <h1 class="h-title center">${esc(T('add.title'))}</h1>
      <p class="subtitle center">${esc(T('add.sub'))}</p>
      <form id="pnrForm" novalidate style="margin-top:8px">
        <div class="inputwrap"><span class="inicon">${Art.train}</span>
          <input id="fPnr" class="input" inputmode="numeric" maxlength="10" value="${esc(pre)}"
            placeholder="${esc(T('first.pnrPlaceholder'))}" aria-label="${esc(T('first.pnrLabel'))}" />
        </div>
        <p class="err" id="fErrTop" role="alert" hidden></p>
        <button class="pastelink" type="button" id="smsToggle">${Art.clip}<span>${esc(T('first.paste'))}</span></button>
        <div id="smsBox" hidden>
          <textarea id="smsText" class="input" rows="3" placeholder="${esc(T('add.smsPlaceholder'))}"></textarea>
          <button type="button" class="btn btn--ghost" id="smsGo">${esc(T('add.usePasted'))}</button>
        </div>
        <div class="grid2">
          <div><label class="label" for="fTrain">Train no</label><input id="fTrain" class="input" inputmode="numeric" placeholder="12951" /></div>
          <div><label class="label" for="fDate">Date</label><input id="fDate" class="input" type="date" value="${today}" /></div>
        </div>
        <div class="grid2">
          <div><label class="label" for="fFrom">From</label><input id="fFrom" class="input" maxlength="4" placeholder="NDLS" style="text-transform:uppercase" /></div>
          <div><label class="label" for="fTo">To</label><input id="fTo" class="input" maxlength="4" placeholder="BPL" style="text-transform:uppercase" /></div>
        </div>
        <div class="grid2">
          <div><label class="label" for="fClass">Class</label><select id="fClass" class="input">${clsOpts}</select></div>
          <div><label class="label" for="fCoach">Coach</label><input id="fCoach" class="input" maxlength="3" placeholder="B2" /></div>
        </div>
        <div class="grid2">
          <div><label class="label" for="fBerth">Berth no</label><input id="fBerth" class="input" inputmode="numeric" placeholder="34" /></div>
          <div><label class="label" for="fBerthType">Berth type</label>
            <select id="fBerthType" class="input">
              <option value="LB">Lower</option><option value="MB">Middle</option><option value="UB">Upper</option>
              <option value="SL">Side Lower</option><option value="SU">Side Upper</option>
              <option value="WINDOW">Window</option><option value="AISLE">Aisle</option><option value="MIDDLE_SEAT">Middle</option>
            </select></div>
        </div>
        <div class="grid2">
          <div><label class="label" for="fStatus">Ticket</label>
            <select id="fStatus" class="input"><option value="CNF">CNF</option><option value="RAC">RAC</option><option value="WL">WL</option><option value="CAN">CAN</option></select></div>
          <div><label class="label" for="fQuota">Quota</label>
            <select id="fQuota" class="input"><option value="GN">GN</option><option value="SS">SS</option><option value="LD">LD</option><option value="HP">HP</option><option value="TQ">TQ</option><option value="PT">PT</option><option value="OTHER">OTHER</option></select></div>
        </div>
        <label class="check"><input type="checkbox" id="fChild" /><span>Child without berth (in group, never offered)</span></label>
        <p class="err" id="fErr" role="alert" hidden></p>
        <button class="btn" type="submit">${esc(T('first.find'))}</button>
      </form>
      <p class="lockline">${Art.lock}<span>${esc(T('add.noSignin'))}</span></p>
      ${footer(false)}</main>`;
  }
  function wireAdd(root) {
    bindBack(root);
    const tog = root.querySelector('#smsToggle'), box = root.querySelector('#smsBox');
    if (tog) tog.addEventListener('click', () => { box.hidden = !box.hidden; });
    const smsGo = root.querySelector('#smsGo');
    if (smsGo) smsGo.addEventListener('click', () => {
      const p = SeatSwapPNR.parseSMS(root.querySelector('#smsText').value);
      const set = (id, v) => { if (v) root.querySelector('#' + id).value = v; };
      set('fPnr', p.pnr); set('fTrain', p.train_no); set('fDate', p.journey_date);
      if (p.class) root.querySelector('#fClass').value = p.class;
      set('fCoach', p.coach); set('fBerth', p.berth_no);
      if (p.berth_type) root.querySelector('#fBerthType').value = p.berth_type;
      if (p.status) root.querySelector('#fStatus').value = p.status;
      if (p.quota) root.querySelector('#fQuota').value = p.quota;
      set('fFrom', p.from_code); set('fTo', p.to_code);
      SeatSwapStore.logActivity('sms_parsed', { entity: 'booking', fields: Object.keys(p).filter((k) => k !== 'pnr') });
    });
    const cls = root.querySelector('#fClass'), bt = root.querySelector('#fBerthType');
    if (cls) cls.addEventListener('change', () => {
      bt.value = SeatSwapPNR.isChair(cls.value) ? 'WINDOW' : 'LB';
    });
    root.querySelector('#pnrForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = root.querySelector('#fErr'), errTop = root.querySelector('#fErrTop');
      const v = (id) => root.querySelector('#' + id).value.trim();
      const fail = (m) => { err.textContent = m; err.hidden = false; errTop.textContent = m; errTop.hidden = false; };
      if (!SeatSwapPNR.validPNR(v('fPnr'))) { fail(T('add.must10') + ' ' + T('add.invalid')); return; }
      const clsV = v('fClass') || 'SL';
      try {
        const smsUsed = !root.querySelector('#smsBox').hidden && root.querySelector('#smsText').value.trim();
        const trip = await SeatSwapStore.addTrip({
          pnr: v('fPnr'), train_no: v('fTrain'), journey_date: v('fDate') || null,
          from_code: v('fFrom'), to_code: v('fTo'), class: clsV, coach: v('fCoach') || null,
          berth_no: v('fBerth') || null, berth_type: v('fBerthType') || 'LB',
          status: v('fStatus') || 'CNF', quota: v('fQuota') || 'GN',
          source: smsUsed ? 'sms_paste' : 'typed',
          passengers: [{
            label: 'Passenger 1', coach: v('fCoach') || null, berth_no: v('fBerth') || null,
            berth_type: v('fBerthType') || 'LB', status: v('fStatus') || 'CNF',
            quota: v('fQuota') || 'GN', is_child_no_berth: root.querySelector('#fChild').checked,
          }],
        });
        location.hash = '#/trips/' + trip.id;
      } catch (ex) {
        fail(ex && ex.message === 'pnr_duplicate' ? 'Already added.' : T('add.must10'));
      }
    });
  }

  /* ---------- TRIP DETAIL ---------- */
  function trip(id) {
    const t = SeatSwapStore.get(id);
    if (!t) return `${innerHead()}<main class="body"><section class="card card--ghost"><p>${esc(T('home.empty'))}</p></section>
      <a class="btn" href="#/trips/add">${esc(T('home.addPnr'))}</a>${footer(false)}</main>`;
    const p = t.passengers[0] || {};
    if (p.status === 'CAN') {
      return `${innerHead()}<main class="body">
        ${Art.ticketHero}
        <h1 class="h-title center">${esc(T('trip.can'))}</h1>
        <p class="subtitle center">${esc(T('trip.wasCancelled', { last4: t.pnr_last4 }))}</p>
        <section class="card card--green"><div class="iconcard">
          <span class="checkdot">${Art.check}</span>
          <span>${esc(T('trip.cancelledInfo'))}</span></div></section>
        <a class="btn" href="#/trips/add">${esc(T('trip.addNewPnr'))}</a>
        ${footer(false)}</main>`;
    }
    const wl = (p.status === 'WL' || p.status === 'RAC')
      ? `<section class="card card--peach"><b>${esc(T('trip.wl'))}</b><p class="subtitle">${esc(T('trip.wlBody', { status: p.status }))}</p></section>` : '';
    const quota = SeatSwapPNR.quotaNote(p.quota) ? `<p class="note">${esc(T('trip.quota'))}</p>` : '';
    const child = t.passengers.some((x) => x.is_child_no_berth) ? `<p class="note">${esc(T('trip.child'))}</p>` : '';
    const chairNote = SeatSwapPNR.isChair(t.class) ? `<p class="note">${esc(T('trip.chaircar'))}</p>` : '';
    const extra = t.passengers.length > 1
      ? `<section class="card"><b>${esc(T('trip.passengers'))}</b><ul class="plist">${t.passengers.map((x) =>
        `<li>${esc(x.label)} · ${x.is_child_no_berth ? 'no berth' : `${esc(x.coach || t.class)} · ${esc(SeatSwapPNR.berthLabel(x.berth_type, t.class))} · ${esc(x.status)}`}</li>`).join('')}</ul></section>` : '';
    return `${innerHead('bell')}<main class="body">
      <section class="berthcard">
        <span class="tile">${Art.train}</span>
        <span><small>${esc(T('trip.coach', { coach: p.coach || t.class }))} · ${esc(t.class)}</small>
        <span class="bigno">${p.is_child_no_berth ? '—' : `Berth ${esc(p.berth_no || '••')}`}</span>
        <span class="bsub">${esc(SeatSwapPNR.berthLabel(p.berth_type, t.class))} · ${esc(p.status)}</span></span>
      </section>
      ${wl}${quota}${child}${chairNote}${extra}
      <a class="card card--peach banner" href="#/onboard/${t.id}" style="text-decoration:none;color:inherit">
        <span class="tile tile--peach">${Art.people}</span>
        <span class="btxt"><b>${esc(T('trip.peopleWant', { n: 3 }))}</b></span>${Art.chevR}</a>
      <a class="btn" href="#/request/new?trip=${t.id}">${esc(T('trip.ask'))}</a>
      <button type="button" class="btn btn--ghost" id="openBtn">${esc(T('trip.open'))}</button>
      <p class="fine" id="openState">${t.open_to_swap ? esc(T('trip.openOn')) : esc(T('trip.openOff'))} ${esc(T('trip.noReward'))}</p>
      <button type="button" class="linklike linklike--danger" id="rmBtn">${esc(T('trip.remove'))}</button>
      <p class="subtitle center" style="margin-top:14px">${esc(T('home.travelBetter'))}</p>
      ${Art.scene}
      ${footer(false)}</main>`;
  }
  function wireTrip(root, id) {
    bindBack(root, '#/');
    const open = root.querySelector('#openBtn');
    if (open) open.addEventListener('click', () => {
      const t = SeatSwapStore.get(id);
      const next = SeatSwapStore.setOpen(id, !(t && t.open_to_swap));
      root.querySelector('#openState').textContent =
        (next && next.open_to_swap ? T('trip.openOn') : T('trip.openOff')) + ' ' + T('trip.noReward');
    });
    const rm = root.querySelector('#rmBtn');
    if (rm) rm.addEventListener('click', () => {
      if (!tConfirm()) return;
      SeatSwapStore.remove(id);
      location.hash = '#/';
    });
    function tConfirm() { return window.confirm(T('trip.remove') + '?'); }
  }

  /* ---------- SWAPS tab: outgoing + incoming + updates ---------- */
  function swaps() {
    const E = (typeof SeatSwapEngine !== 'undefined' ? SeatSwapEngine : null);
    let out = [], inc = [], unread = 0;
    if (E && E.authed()) {
      out = E.myRequests();
      inc = E.incomingForMe();
      unread = E.myNotifs().filter((n) => !n.read_at).length;
    }
    const statusPill = (s) => {
      const map = { searching: 'Waiting for replies', accepted_awaiting_payment: 'Said yes · pay to lock', locked: 'Locked', confirmed: 'Swapped', voided: 'To credit', disputed: 'On hold', withdrawn: 'Withdrawn', expired: 'Expired' };
      return `<span class="pill">${esc(map[s] || s)}</span>`;
    };
    const tripLine = (bookingId) => {
      const t = SeatSwapStore.get(bookingId);
      return t ? `${esc(t.train_no)} · ${esc(t.from_code || '')}→${esc(t.to_code || '')}` : '';
    };
    return `${homeHead('gear')}<main class="body">
      <h1 class="h-title" style="margin-top:10px">${esc(T('swaps.title'))}</h1>
      <p class="subtitle">${esc(T('swaps.sub'))}</p>
      <a class="card banner" href="#/updates" style="text-decoration:none;color:inherit">
        <span class="tile">${Art.bell}</span>
        <span class="btxt" style="flex:1"><b>${esc(T('updates.title'))}${unread ? ` (${unread})` : ''}</b>
        <small>${esc(T('swaps.updates'))}</small></span>${Art.chevR}</a>
      ${!E || !E.authed() ? `<section class="card card--ghost center">
        <b style="font-size:17px">${esc(T('swaps.none'))}</b>
        <p class="subtitle">${esc(T('swaps.empty'))}</p>
        <a class="btn" href="#/trips/add">${esc(T('home.addPnr'))}</a></section>` : ''}
      ${E && E.authed() && inc.length ? `<div class="rowhead"><h2 class="h-section">${esc(T('incoming.title'))}</h2></div>` +
        inc.map((o) => {
          const r = E.getRequest(o.request_id);
          return `<a class="card banner" href="#/incoming/${o.id}" style="text-decoration:none;color:inherit">
            <span class="avatar">${esc((r.reason || 'S').slice(0, 1))}</span>
            <span class="btxt" style="flex:1"><b>${esc(T('incoming.title'))}</b>
            <small>${esc(tripLine(r.booking_id))} · ${esc((r.choices || []).join(' / '))}</small></span>${Art.chevR}</a>`;
        }).join('') : ''}
      ${E && E.authed() ? out.map((r) => {
        const link = r.status === 'locked' || r.status === 'confirmed' ? '#/swaps/' + r.id : '#/request/' + r.id;
        return `<a class="card banner" href="${link}" style="text-decoration:none;color:inherit">
          <span class="tripthumb">${Art.train}</span>
          <span class="btxt" style="flex:1"><b>${esc((r.choices || []).join(' / ') || T('swaps.title'))}</b>
          <small>${esc(tripLine(r.booking_id))}</small><span>${statusPill(r.status)}</span></span>${Art.chevR}</a>`;
      }).join('') || (E.authed() ? `<section class="card card--ghost center">
        <b style="font-size:17px">${esc(T('swaps.none'))}</b>
        <p class="subtitle">${esc(T('swaps.empty'))}</p>
        <a class="btn" href="#/trips/add">${esc(T('home.addPnr'))}</a></section>` : '') : ''}
      ${footer(false)}</main>`;
  }

  /* ---------- PROFILE ---------- */
  function profile() {
    const c = SeatSwapStore.creditPaise();
    const easy = SeatSwapI18n.isEasy();
    const who = (typeof SeatSwapAuth !== 'undefined' && SeatSwapEngine.authed()) ? SeatSwapAuth.displayName() : '';
    return `${homeHead('gear')}<main class="body">
      <div class="prow"><span class="avatar">${Art.person}</span>
        <span><span class="pname">${esc(who || T('profile.name'))}</span><br />
        <span class="psub">${esc(T('profile.tag'))}</span></span></div>
      <a class="creditbanner" href="#/swaps" style="text-decoration:none;color:inherit">
        <span class="tile tile--peach">${Art.coins}</span>
        <span class="btxt" style="flex:1"><small style="color:var(--muted)">${esc(T('profile.credit'))}</small>
        <span class="big">${esc(T('profile.balance', { amount: (c / 100).toFixed(0) }))}</span>
        <small>${esc(T('profile.validNote'))}</small></span>${Art.chevR}</a>
      <nav class="menu">
        <a class="mrow" href="#/"><span class="mico">${Art.suitcase}</span><span class="mlab">${esc(T('profile.myTrips'))}</span>${Art.chevR}</a>
        <a class="mrow" href="#/profile/settings"><span class="mico">${Art.shieldCheck}</span><span class="mlab">${esc(T('profile.safety'))}</span>${Art.chevR}</a>
        <a class="mrow" href="#/welcome/language"><span class="mico">${Art.globe}</span><span class="mlab">${esc(T('profile.langRow'))}</span>${Art.chevR}</a>
        <button type="button" class="mrow" id="helpRow"><span class="mico">${Art.help}</span><span class="mlab">${esc(T('profile.helpQ'))}</span>${Art.chevR}</button>
        <div class="mrow" id="helpText" hidden><span class="mlab"><small style="font-size:14px;color:var(--ink-soft)">${esc(T('profile.helpAllowed'))}</small></span></div>
        <div class="mrow"><span class="mico" style="font-family:var(--font-head);font-weight:700">Aa</span>
          <span class="mlab">${esc(T('profile.easy'))}</span>
          <label class="switch"><input type="checkbox" id="easyBox" ${easy ? 'checked' : ''} /><span class="tr"></span><span class="th"></span></label></div>
      </nav>
      <p class="fine">${esc(T('profile.signInLater'))}</p>
      ${footer(false)}</main>`;
  }
  function wireProfile(root) {
    const help = root.querySelector('#helpRow'), txt = root.querySelector('#helpText');
    if (help) help.addEventListener('click', () => { txt.hidden = !txt.hidden; });
    const ez = root.querySelector('#easyBox');
    if (ez) ez.addEventListener('change', () => SeatSwapI18n.setEasy(ez.checked));
  }

  /* ---------- SETTINGS + DELETE + GOODBYE ---------- */
  function prefs() {
    try { return Object.assign({ women_only: false, families_only: false, same_coach_only: false, paused: false }, JSON.parse(localStorage.getItem('seatswap_prefs_v1') || '{}')); }
    catch { return { women_only: false, families_only: false, same_coach_only: false, paused: false }; }
  }
  function savePrefs(p) {
    try { localStorage.setItem('seatswap_prefs_v1', JSON.stringify(p)); } catch {}
    SeatSwapStore.logActivity('prefs_changed', { prefs: p });
  }
  function settings() {
    const p = prefs();
    const easy = SeatSwapI18n.isEasy();
    const sw = (key, on) => `<label class="switch"><input type="checkbox" data-pref="${key}" ${on ? 'checked' : ''} /><span class="tr"></span><span class="th"></span></label>`;
    return `${innerHead()}<main class="body">
      <h1 class="h-title">${esc(T('settings.title'))}</h1>
      <section class="menu">
        <div class="setrow"><span class="mlab">${esc(T('settings.women'))}</span>${sw('women_only', p.women_only)}</div>
        <div class="setrow"><span class="mlab">${esc(T('settings.families'))}</span>${sw('families_only', p.families_only)}</div>
        <div class="setrow"><span class="mlab">${esc(T('settings.sameCoach'))}</span>${sw('same_coach_only', p.same_coach_only)}</div>
        <div class="setrow"><span class="mlab">${esc(T('settings.pause'))}</span>${sw('paused', p.paused)}</div>
        <div class="setrow"><span class="mlab">${esc(T('settings.easyBig'))}</span>
          <label class="switch"><input type="checkbox" id="easyBox2" ${easy ? 'checked' : ''} /><span class="tr"></span><span class="th"></span></label></div>
        <a class="mrow" href="#/welcome/language"><span class="mlab">${esc(T('settings.lang', { lang: SeatSwapI18n.getLang() === 'hi' ? 'हिन्दी' : 'English' }))}</span>${Art.chevR}</a>
      </section>
      <section class="menu">
        <button type="button" class="mrow" id="helpRow"><span class="mlab">${esc(T('settings.helpQ'))}</span>${Art.chevR}</button>
        <div class="mrow" id="helpText" hidden><span class="mlab"><small style="font-size:14px;color:var(--ink-soft)">${esc(T('profile.helpAllowed'))}</small></span></div>
        <a class="mrow mrow--danger" href="#/profile/delete"><span class="mlab">${esc(T('settings.del'))}</span>${Art.chevR}</a>
      </section>
      ${footer(false)}</main>`;
  }
  function wireSettings(root) {
    bindBack(root, '#/profile');
    const p = prefs();
    root.querySelectorAll('[data-pref]').forEach((box) => box.addEventListener('change', () => {
      p[box.dataset.pref] = box.checked;
      savePrefs(p);
    }));
    const ez = root.querySelector('#easyBox2');
    if (ez) ez.addEventListener('change', () => SeatSwapI18n.setEasy(ez.checked));
    const help = root.querySelector('#helpRow'), txt = root.querySelector('#helpText');
    if (help) help.addEventListener('click', () => { txt.hidden = !txt.hidden; });
  }
  function delAccount() {
    return `${innerHead()}<main class="body">
      <h1 class="h-title">${esc(T('del.title'))}</h1>
      <p class="subtitle">${esc(T('del.body'))}</p>
      <button type="button" class="btn btn--danger" id="delGo">${esc(T('del.confirm'))}</button>
      <button type="button" class="btn btn--ghost" id="delKeep">${esc(T('del.keep'))}</button>
      ${footer(false)}</main>`;
  }
  function wireDel(root) {
    bindBack(root, '#/profile/settings');
    root.querySelector('#delKeep').addEventListener('click', () => history.back());
    root.querySelector('#delGo').addEventListener('click', () => {
      ['seatswap_trips_v1', 'seatswap_activity_v1', 'seatswap_wallet_v1', 'seatswap_seen_v1', 'seatswap_prefs_v1']
        .forEach((k) => { try { localStorage.removeItem(k); } catch {} });
      location.hash = '#/goodbye';
    });
  }
  function goodbye() {
    return `<main class="body body--setup center">
      <p class="wordmark wordmark--center">${esc(T('brand.wordmark'))}</p>
      ${Art.shieldHero}
      <h1 class="h-title">${esc(T('del.done'))}</h1>
      <a class="btn" href="#/" style="margin-top:16px">${esc(T('home.addPnr'))}</a>
    </main>`;
  }

  /* ---------- TRAIN PAGE ---------- */
  function trainPage(n) {
    return `${homeHead('gear')}<main class="body">
      ${Art.scene}
      <h1 class="h-title center">${esc(T('train.title', { n }))}</h1>
      <p class="subtitle center">${esc(T('train.body', { n }))}</p>
      <a class="btn" href="#/trips/add">${esc(T('home.addPnr'))}</a>
      ${footer(false)}</main>`;
  }

  /* ---------- ROUTER ---------- */
  function route() {
    const h = location.hash || '#/';
    const pathPart = h.split('?')[0];
    const parts = pathPart.replace(/^#\//, '').split('/');
    if (h === '#/' || h === '') return { name: 'home' };
    if (parts[0] === 'welcome' && parts[1] === 'language') return { name: 'language' };
    if (parts[0] === 'welcome' && parts[1] === 'note') return { name: 'note' };
    if (parts[0] === 'welcome' && parts[1] === 'privacy') return { name: 'privacy' };
    if (parts[0] === 'welcome' && parts[1] === 'alerts') return { name: 'alerts' };
    if (parts[0] === 'signin') return { name: 'signin' };
    if (parts[0] === 'goodbye') return { name: 'goodbye' };
    if (parts[0] === 'trips' && parts[1] === 'add') return { name: 'add' };
    if (parts[0] === 'trips' && parts[1]) return { name: 'trip', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && !parts[1]) return { name: 'swaps' };
    if (parts[0] === 'profile' && parts[1] === 'settings') return { name: 'settings' };
    if (parts[0] === 'profile' && parts[1] === 'delete') return { name: 'delAccount' };
    if (parts[0] === 'profile') return { name: 'profile' };
    if (parts[0] === 'train' && parts[1]) return { name: 'train', n: decodeURIComponent(parts[1]) };
    if (parts[0] === 's' && parts[1]) return { name: 'invite', code: decodeURIComponent(parts[1]) };
    if (parts[0] === 'request' && parts[1] === 'new') return { name: 'choices', trip: qs('trip'), req: qs('req'), want: qs('want'), resume: qs('resume') };
    if (parts[0] === 'request' && parts[2] === 'matches') return { name: 'matches', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'request' && parts[1]) return { name: 'request', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'incoming' && parts[1]) return { name: 'incoming', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'updates') return { name: 'updates' };
    if (parts[0] === 'pay' && parts[2] === 'method') return { name: 'paymethod', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'pay' && parts[2] === 'upi') return { name: 'payupi', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'pay' && parts[2] === 'paypal') return { name: 'paypaypal', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'pay' && parts[2] === 'status') return { name: 'paystatus', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'pay' && parts[2] === 'done') return { name: 'paydone', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'pay' && parts[1]) return { name: 'pay', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[2] === 'cancel') return { name: 'swapcancel', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[2] === 'meet') return { name: 'meet', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[2] === 'summary') return { name: 'summary', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[2] === 'confirm') return { name: 'confirm', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[2] === 'done') return { name: 'swapdone', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[2] === 'share') return { name: 'swapshare', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[2] === 'rate') return { name: 'rate', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'swaps' && parts[1]) return { name: 'swapdetail', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'chat' && parts[1]) return { name: 'chat', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'onboard' && parts[1]) return { name: 'onboard', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'groups' && parts[2] === 'plan') return { name: 'groupplan', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'groups' && parts[1]) return { name: 'group', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'groups') return { name: 'groups' };
    if (parts[0] === 'admin' && parts[1]) return { name: 'admin_' + parts[1], q: qs('q') };
    if (parts[0] === 'admin') return { name: 'admin' };
    if (extra[parts[0]]) return { name: parts[0], arg: decodeURIComponent(parts[1] || '') };
    return { name: 'home' };
  }
  function qs(k) {
    try {
      const q = (location.hash.split('?')[1] || '');
      return new URLSearchParams(q).get(k);
    } catch { return null; }
  }
  function render() {
    const r = route();
    const el = mount();
    const slot = document.getElementById('offlineSlot');
    if (slot && !slot.innerHTML) slot.innerHTML = offlineBar();
    SeatSwapI18n.applyStatic(document);
    let html = '', tab = 'home';
    if (r.name === 'home') { html = home(); tab = 'home'; }
    else if (r.name === 'language') { html = language(); tab = 'language'; }
    else if (r.name === 'note') { html = note(); tab = 'note'; }
    else if (r.name === 'privacy') { html = privacy(); tab = 'privacy'; }
    else if (r.name === 'alerts') { html = alerts(); tab = 'alerts'; }
    else if (r.name === 'signin') { html = signin(); tab = 'signin'; }
    else if (r.name === 'goodbye') { html = goodbye(); tab = 'goodbye'; }
    else if (r.name === 'add') { html = add(); tab = 'home'; }
    else if (r.name === 'trip') { html = trip(r.id); tab = 'home'; }
    else if (r.name === 'swaps') { html = swaps(); tab = 'swaps'; }
    else if (r.name === 'profile') { html = profile(); tab = 'profile'; }
    else if (r.name === 'settings') { html = settings(); tab = 'profile'; }
    else if (r.name === 'delAccount') { html = delAccount(); tab = 'profile'; }
    else if (r.name === 'train') { html = trainPage(r.n); tab = 'home'; }
    else if (extra[r.name]) { const e = extra[r.name].render(r); html = e.html; tab = e.tab || 'home'; }
    el.innerHTML = html;
    setTabs(tab);
    paintOffline();
    if (extra[r.name] && extra[r.name].wire) { try { extra[r.name].wire(el, r); } catch (err) { console.warn(err); } }
    if (r.name === 'home') wireHome(el);
    if (r.name === 'language') {
      el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => {
        await SeatSwapI18n.setLang(b.dataset.lang);
        render();
      }));
      el.querySelector('#langGo').addEventListener('click', () => {
        SeatSwapStore.markSeen('lang');
        location.hash = SeatSwapStore.seen('note') ? '#/' : '#/welcome/note';
      });
    }
    if (r.name === 'note') el.querySelector('#noteGo').addEventListener('click', () => {
      SeatSwapStore.markSeen('note');
      SeatSwapStore.logActivity('onboarding_note_seen', {});
      location.hash = '#/';
    });
    if (r.name === 'privacy') {
      bindBack(el);
      el.querySelector('#agreeBtn').addEventListener('click', () => {
        SeatSwapStore.logActivity('privacy_consented', {});
        history.back();
      });
    }
    if (r.name === 'signin') {
      bindBack(el);
      try {
        const slot = el.querySelector('#googleSlot');
        if (slot && typeof SeatSwapAuth !== 'undefined') {
          SeatSwapAuth.initGoogleButton(slot, (resp) => {
            try {
              const payload = JSON.parse(atob(String(resp.credential).split('.')[1]));
              const nm = String(payload.given_name || payload.name || '').split(/\s+/);
              SeatSwapEngine.signIn({ first_name: nm[0] || 'Traveller', last_initial: (nm[1] || '').slice(0, 1), via: 'google', sub: payload.sub });
              SeatSwapAuth.afterLogin();
            } catch { toast('Sign-in failed. Try again.'); }
          });
        }
      } catch {}
      const dl = el.querySelector('#demoLogin');
      if (dl) dl.addEventListener('submit', (e) => {
        e.preventDefault();
        const err = el.querySelector('#dErr');
        try {
          SeatSwapAuth.signInDemo(el.querySelector('#dName').value);
          SeatSwapStore.markSeen('signedin');
        } catch {
          err.textContent = T('signin.demoName');
          err.hidden = false;
        }
      });
    }
    if (r.name === 'alerts') {
      el.querySelector('#alertsOn').addEventListener('click', async () => {
        try {
          if ('Notification' in window) await Notification.requestPermission();
        } catch {}
        SeatSwapStore.logActivity('alerts_choice', { on: true });
        history.back();
      });
      el.querySelector('#alertsLater').addEventListener('click', () => {
        SeatSwapStore.logActivity('alerts_choice', { on: false });
        history.back();
      });
    }
    if (r.name === 'add') wireAdd(el);
    if (r.name === 'trip') wireTrip(el, r.id);
    if (r.name === 'profile') wireProfile(el);
    if (r.name === 'settings') wireSettings(el);
    if (r.name === 'delAccount') wireDel(el);
    window.scrollTo(0, 0);
  }

  async function boot() {
    await SeatSwapI18n.init();
    SeatSwapI18n.applyStatic(document);
    try { SeatSwapEngine.expireSweep(); SeatSwapEngine.autoConfirmSweep(); } catch {}
    // install prompt: gentle card after first PNR add (capture event for later)
    try {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.__seatswapInstall = e;
      });
    } catch {}
    if (new URLSearchParams(location.search).get('sw') === 'off' && 'serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach((r) => r.unregister());
      } catch {}
    }
    window.addEventListener('hashchange', render);
    window.addEventListener('online', paintOffline);
    window.addEventListener('offline', paintOffline);
    if (!location.hash) location.hash = '#/';
    if (!SeatSwapStore.seen('lang') && route().name === 'home') {
      render();
      location.hash = '#/welcome/language';
      return;
    }
    render();
  }
  const api = { boot, render, route };
  api.screen = (name, def) => { extra[name] = def; };
  api.helpers = { esc, Art, innerHead, homeHead, footer, fmtDate, bindBack, offlineBar, paintOffline };
  api.T = T;
  return api;
})();
