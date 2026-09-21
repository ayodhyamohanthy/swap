/* SwapSeat - identity (Milestone 2 slice).
   ---------------------------------------------------------------------------
   Phone-OTP sign-in against the dev server (server/dev-server.js), plus the
   journey board: the first REAL two-party coordination surface. The seeded
   marketplace (js/data.js) stays as the preview; the board is where two
   signed-in travellers actually publish, accept and complete a swap.

   Privacy rules enforced by the server, mirrored honestly here:
     - your phone never appears anywhere (a masked label identifies you);
     - exact seat numbers are hidden until a swap is completed;
     - accepting is one-shot - a taken request can never be taken again.

   The PWA must keep working fully offline / serverless: when the API is not
   reachable every identity surface degrades to an honest note, never an error. */
const Auth = (() => {
  const TOKEN_KEY = 'swapseat_session_v1';
  const USER_KEY = 'swapseat_user_v1';
  let available = null; // null = unknown, false = static/offline, true = API up

  function token() { try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; } }
  function user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }
  function setSession(t, u) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
      if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }
  async function api(pathname, opts) {
    const o = opts || {};
    const res = await fetch(pathname, {
      method: o.method || 'GET',
      headers: { 'content-type': 'application/json', ...(token() ? { authorization: 'Bearer ' + token() } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 && token()) setSession(null, null); // server rotated/expired us
    if (!res.ok) { const e = new Error(data.error || 'Request failed (' + res.status + ')'); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  async function probe() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch('/api/health', { signal: ctrl.signal });
      clearTimeout(t);
      available = res.ok;
    } catch (_) { available = false; }
    if (available && token()) {
      try { const d = await api('/api/auth/session'); setSession(token(), d.user); }
      catch (_) { /* stale token cleared by api() */ }
    }
    return available;
  }
  async function logout() {
    try { if (available) await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    setSession(null, null);
  }
  return {
    probe, api, logout,
    user, token,
    isAvailable: () => available,
    signedIn: () => !!(token() && user()),
    requestOtp: (phone) => api('/api/auth/request-otp', { method: 'POST', body: { phone } }),
    verifyOtp: async (phone, code) => {
      const d = await api('/api/auth/verify-otp', { method: 'POST', body: { phone, code } });
      setSession(d.token, d.user);
      return d.user;
    },
  };
})();

/* ---------- Flow screens: login + journey board ---------- */
(() => {
  if (typeof Flow === 'undefined') return;
  const esc = Flow.esc;

  function needBooking() {
    return `<div class="fs-body"><div class="fcard fcard--ghost">
      <p class="fmuted">Find your booking first - the board is per journey.</p>
      <button type="button" class="fbtn block" data-go-scr="booking">Find your booking</button>
    </div></div>`;
  }
  function serverDownNote() {
    return `<div class="fcard fcard--ghost">
      <div class="frow"><b>Sign-in server is not running</b></div>
      <p class="fmuted">Everything else in the demo works without it. To try real two-party swapping, start it with:</p>
      <p class="fine"><code>node server/dev-server.js</code> then open the app on that port.</p>
    </div>`;
  }
  function requireAuth(targetScreen) {
    if (Auth.signedIn()) { Flow.show(targetScreen); return; }
    Flow.ctx.afterLogin = targetScreen;
    Flow.show('login');
  }

  /* ---------- LOGIN: phone -> OTP ---------- */
  Flow.register({
    id: 'login', title: 'Sign In',
    render() {
      const st = Flow.ctx.loginState || 'phone';
      if (Auth.isAvailable() === false) return `${Flow.screenHead('Account', 'Sign In', '')}<div class="fs-body">${serverDownNote()}</div>`;
      return `
      ${Flow.screenHead('Account', 'Sign In', 'Your number is your account. It is never shown to other travellers.')}
      <div class="fs-body">
        ${st === 'phone' ? `
        <div class="fcard">
          <label class="flabel" for="loginPhone">Phone number</label>
          <input id="loginPhone" class="finput" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91 98765 43210"/>
          <p class="fine">We send a one-time code. No password, no signup form.</p>
          <p class="ferr" id="loginErr" role="alert" hidden></p>
        </div>
        <div class="fs-actions"><button type="button" class="fbtn block" id="loginSend" data-online>Send code</button></div>` : `
        <div class="fcard">
          <div class="frow"><b>Code sent to ${esc(Flow.ctx.loginMasked || 'your number')}</b></div>
          <label class="flabel" for="loginCode" style="margin-top:10px">6-digit code</label>
          <input id="loginCode" class="finput" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"/>
          ${Flow.ctx.devCode ? `<p class="fine" id="devCodeHint">Demo server - code: <b>${esc(Flow.ctx.devCode)}</b></p>` : ''}
          <p class="ferr" id="loginErr" role="alert" hidden></p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="loginVerify" data-online>Verify & sign in</button>
          <button type="button" class="fbtn ghost block" id="loginBack">Use a different number</button>
        </div>`}
        <p class="safe-note">Other travellers only ever see "Traveller ··34" - never your number, never your name.</p>
      </div>`;
    },
    wire(root) {
      const err = (m) => { const e = root.querySelector('#loginErr'); if (e) { e.textContent = m; e.hidden = !m; } };
      const send = root.querySelector('#loginSend');
      if (send) send.addEventListener('click', async () => {
        err(''); send.disabled = true;
        try {
          const phone = root.querySelector('#loginPhone').value;
          const d = await Auth.requestOtp(phone);
          Flow.ctx.loginPhone = phone;
          Flow.ctx.loginMasked = d.phoneMasked;
          Flow.ctx.devCode = d.devCode || null; // present only from the dev server
          Flow.ctx.loginState = 'code';
          Flow.show('login');
        } catch (e) { err(e.message); send.disabled = false; }
      });
      const verify = root.querySelector('#loginVerify');
      if (verify) verify.addEventListener('click', async () => {
        err(''); verify.disabled = true;
        try {
          await Auth.verifyOtp(Flow.ctx.loginPhone, root.querySelector('#loginCode').value);
          Flow.ctx.loginState = 'phone'; Flow.ctx.devCode = null;
          const next = Flow.ctx.afterLogin || 'home';
          Flow.ctx.afterLogin = null;
          toast('Signed in as ' + (Auth.user() || {}).phoneMasked);
          Flow.show(next);
        } catch (e) { err(e.message); verify.disabled = false; }
      });
      const back = root.querySelector('#loginBack');
      if (back) back.addEventListener('click', () => { Flow.ctx.loginState = 'phone'; Flow.show('login'); });
    },
  });

  /* ---------- helpers shared by board + publish ---------- */
  function seatTypeOf(b) {
    const i = b && b.primary && b.primary.info;
    if (!i) return '';
    if (i.title) return i.title.split('·')[0].trim();
    if (i.type && typeof berthMeta !== 'undefined') return berthMeta(i.type).name;
    return '';
  }
  function ownSeatPayload(b) {
    return {
      journeyKey: b.service, mode: b.mode,
      seat: String(b.primary.seat), seatType: seatTypeOf(b),
      coach: b.coach || b.deck || '',
    };
  }
  function wantChips(mode) {
    const m = { flight: ['Window seat', 'Aisle seat', 'Middle seat', 'Exit row', 'More legroom'],
      train: ['Lower berth', 'Middle berth', 'Upper berth', 'Side lower', 'Side upper', 'Same coach'],
      bus: ['Window seat', 'Aisle seat', 'Lower deck', 'Upper deck'] };
    return m[mode] || m.flight;
  }

  /* ---------- PUBLISH: list your seat for swap ---------- */
  Flow.register({
    id: 'publish', title: 'List Your Seat',
    render() {
      const b = Flow.ctx.booking;
      if (!b) return needBooking();
      return `
      ${Flow.screenHead('Real swap · Step 1', 'List Your Seat', 'Other signed-in travellers on ' + esc(b.carrier) + ' ' + esc(b.serviceNo) + ' will see this.')}
      <div class="fs-body">
        <div class="fcard">
          <div class="frow"><b>${esc(Flow.seatLabel(b))}</b><span class="fpill">${esc(seatTypeOf(b))}</span></div>
          <p class="fine">Shown as "${esc(seatTypeOf(b))}" only - the exact number stays hidden until a swap is completed.</p>
        </div>
        <div class="fcard">
          <div class="fsub">You would consider</div>
          <div class="chips" id="pubWants">${wantChips(b.mode).map((w) => `<button type="button" class="prefchip" data-w="${esc(w)}" aria-pressed="false">${esc(w)}</button>`).join('')}</div>
          <label class="flabel" for="pubNote" style="margin-top:12px">Note (optional)</label>
          <input id="pubNote" class="finput" maxlength="280" placeholder="e.g. Travelling with my mother - anything lower works"/>
          <p class="ferr" id="pubErr" role="alert" hidden></p>
        </div>
        <div class="fs-actions"><button type="button" class="fbtn block" id="pubGo" data-online>Publish swap request</button></div>
        <p class="safe-note">Listing is coordination, not a confirmed change. The crew/operator always decides on board.</p>
      </div>`;
    },
    wire(root) {
      const b = Flow.ctx.booking; if (!b) return;
      const picked = new Set();
      root.querySelectorAll('[data-w]').forEach((c) => c.addEventListener('click', () => {
        const on = !picked.has(c.dataset.w);
        if (on) picked.add(c.dataset.w); else picked.delete(c.dataset.w);
        c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
      }));
      root.querySelector('#pubGo').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget; btn.disabled = true;
        const errEl = root.querySelector('#pubErr');
        try {
          await Auth.api('/api/swap-requests', { method: 'POST', body: { ...ownSeatPayload(b), want: [...picked], note: root.querySelector('#pubNote').value.trim() } });
          Flow.ctx.boardData = null; Flow.ctx.boardSig = null;
          toast('Listed. Signed-in travellers on your journey can see it now.');
          Flow.show('board');
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.hidden = false; }
          btn.disabled = false;
        }
      });
    },
  });

  /* ---------- BOARD: the journey's live swap requests ---------- */
  Flow.register({
    id: 'board', title: 'Journey Board',
    render() {
      const b = Flow.ctx.booking;
      if (!b) return needBooking();
      if (Auth.isAvailable() === false) return `${Flow.screenHead('Real swaps', 'Journey Board', '')}<div class="fs-body">${serverDownNote()}</div>`;
      if (!Auth.signedIn()) return `${Flow.screenHead('Real swaps', 'Journey Board', Flow.bookingLine(b))}
      <div class="fs-body">
        <div class="fcard">
          <div class="frow"><b>Sign in to swap for real</b></div>
          <p class="fmuted">This board is live coordination between signed-in travellers on ${esc(b.carrier)} ${esc(b.serviceNo)} - one-time code, no password.</p>
          <button type="button" class="fbtn block" data-go-scr="login" data-online>Sign in with a code</button>
        </div>
        <p class="safe-note">Your number is never shown. Other travellers see a masked label only.</p>
      </div>`;
      const d = Flow.ctx.boardData;
      if (!d) return `${Flow.screenHead('Real swaps', 'Journey Board', Flow.bookingLine(b))}<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Loading the board...</p></div></div>`;
      const mine = d.requests.find((r) => r.mine && (r.state === 'open' || r.state === 'accepted'));
      const completed = d.requests.filter((r) => r.state === 'completed' && (r.mine || (r.reveal && r.reveal.yourSeat)));
      const others = d.requests.filter((r) => !r.mine && r.state === 'open');
      const waitingOn = d.requests.filter((r) => r.acceptedByMe && r.state === 'accepted');
      const wantLine = (r) => (r.want && r.want.length ? r.want.join(' · ') : 'open to anything');
      return `
      ${Flow.screenHead('Real swaps', 'Journey Board', Flow.bookingLine(b))}
      <div class="fs-body">
        ${completed.map((r) => `
        <div class="fcard fcard--notif" role="group" aria-label="Completed swap">
          <div class="frow"><b>Swap completed</b> <span class="fpill">completed</span></div>
          <div class="seatpair" style="margin-top:8px">
            <div class="sp"><span class="fmuted">Your seat</span><b>${esc(r.reveal.yourSeat)}</b></div>
            <div class="sp"><span class="fmuted">${esc(r.reveal.theirLabel)}'s seat</span><b>${esc(r.reveal.theirSeat)}</b></div>
          </div>
          <p class="fine">Seats are now visible to both of you. The crew/operator confirms the change on board - this screen is coordination, not a reassignment.</p>
        </div>`).join('')}
        ${mine ? `
        <div class="fcard" role="group" aria-label="My listing">
          <div class="frow"><b>Your listing · ${esc(mine.seatType || 'your seat')}</b> <span class="fpill">${esc(mine.state)}</span></div>
          <p class="fmuted">Wants: ${esc(wantLine(mine))}${mine.note ? ' · "' + esc(mine.note) + '"' : ''}</p>
          ${mine.state === 'accepted' ? `
            <p class="fmuted"><b>${esc(mine.acceptedByLabel || 'A traveller')}</b> accepted. Complete the swap to reveal seats to each other.</p>
            <div class="frow">
              <button type="button" class="fbtn" data-complete="${esc(mine.id)}" data-online>Complete swap</button>
              <button type="button" class="fbtn ghost" data-cancel="${esc(mine.id)}">Cancel</button>
            </div>` : `
            <p class="fine">Visible to signed-in travellers on this journey. Your exact seat stays hidden.</p>
            <div class="frow"><button type="button" class="fbtn ghost" data-cancel="${esc(mine.id)}">Withdraw listing</button></div>`}
        </div>` : `
        <div class="fcard">
          <div class="frow"><b>Your seat · ${esc(seatTypeOf(b))}</b></div>
          <p class="fmuted">List it so signed-in travellers on this journey can offer you a swap.</p>
          <button type="button" class="fbtn block" id="boardPublish" data-online>List my seat for swap</button>
        </div>`}
        ${waitingOn.map((r) => `
        <div class="fcard" role="group" aria-label="Accepted swap">
          <div class="frow"><b>${esc(r.by)}'s listing</b> <span class="fpill">accepted</span></div>
          <p class="fmuted">You accepted this swap. Seats are revealed when ${esc(r.by)} completes it.</p>
          <p class="fine">If they do not complete before the listing expires, nothing changes - you keep your seat.</p>
        </div>`).join('')}
        ${others.length ? `<div class="fsub" style="margin:14px 0 6px">From travellers on this journey</div>` : ''}
        ${others.map((r) => `
        <div class="fcard" role="group" aria-label="Swap offer">
          <div class="frow"><span class="avatar" aria-hidden="true">${esc(r.by.slice(-2))}</span>
            <div style="flex:1"><b>${esc(r.by)}</b> <span class="fpill">verified sign-in</span><br/>
            <span class="fmuted">offers ${esc(r.seatType || 'their seat')}${r.coach ? ' · coach ' + esc(r.coach) : ''}</span></div></div>
          <p class="fmuted">wants: ${esc(wantLine(r))}</p>
          ${r.note ? `<p class="fine">"${esc(r.note)}"</p>` : ''}
          <p class="fine">Their exact seat is revealed only after the swap completes.</p>
          <button type="button" class="fbtn block" data-accept="${esc(r.id)}" data-online>Accept this swap</button>
        </div>`).join('')}
        ${!mine && !others.length && !completed.length ? `<div class="fcard fcard--ghost"><p class="fmuted">No live requests yet on this journey. Yours could be the first.</p></div>` : ''}
        <p class="safe-note">Agreement here is coordination. Nothing changes a reservation - the crew/operator decides on board.</p>
      </div>`;
    },
    wire(root) {
      const b = Flow.ctx.booking; if (!b) return;
      if (Auth.isAvailable() === false) return;
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => { Flow.ctx.afterLogin = 'board'; Flow.show(x.dataset.goScr); }));
      if (!Auth.signedIn()) return;
      /* Refresh on every visit, but only re-render when the board actually
         changed - so the fetch below can never loop the router. */
      const reload = async () => {
        try {
          const d = await Auth.api('/api/swap-requests?journeyKey=' + encodeURIComponent(b.service));
          const sig = JSON.stringify(d);
          const changed = sig !== Flow.ctx.boardSig;
          Flow.ctx.boardData = d; Flow.ctx.boardSig = sig;
          if (changed && Flow.current === 'board') Flow.show('board');
        } catch (e) {
          const changed = !Flow.ctx.boardData;
          Flow.ctx.boardData = Flow.ctx.boardData || { requests: [], error: e.message };
          if (changed && Flow.current === 'board') Flow.show('board');
        }
      };
      reload();
      const pub = root.querySelector('#boardPublish');
      if (pub) pub.addEventListener('click', () => Flow.show('publish'));
      root.querySelectorAll('[data-accept]').forEach((x) => x.addEventListener('click', async () => {
        x.disabled = true;
        try {
          await Auth.api('/api/swap-requests/' + x.dataset.accept + '/accept', { method: 'POST', body: ownSeatPayload(b) });
          Flow.ctx.boardData = null; Flow.ctx.boardSig = null;
          toast('Accepted. The traveller who listed completes the swap.');
          reload();
        } catch (e) { toast(e.message); x.disabled = false; }
      }));
      root.querySelectorAll('[data-complete]').forEach((x) => x.addEventListener('click', async () => {
        x.disabled = true;
        try {
          await Auth.api('/api/swap-requests/' + x.dataset.complete + '/complete', { method: 'POST' });
          Flow.ctx.boardData = null; Flow.ctx.boardSig = null;
          toast('Swap completed - seats revealed to both of you.');
          reload();
        } catch (e) { toast(e.message); x.disabled = false; }
      }));
      root.querySelectorAll('[data-cancel]').forEach((x) => x.addEventListener('click', async () => {
        x.disabled = true;
        try {
          await Auth.api('/api/swap-requests/' + x.dataset.cancel + '/cancel', { method: 'POST' });
          Flow.ctx.boardData = null; Flow.ctx.boardSig = null;
          toast('Listing withdrawn.');
          reload();
        } catch (e) { toast(e.message); x.disabled = false; }
      }));
    },
  });

  /* Boot: probe the API once so every surface knows whether sign-in exists. */
  Auth.probe().then(() => { if (Flow.current === 'board' || Flow.current === 'login') Flow.show(Flow.current); });
})();
