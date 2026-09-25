/* SwapSeat · tab screens (My Trips, Wallet, Profile) + manual-journey fallback.
   Loads after js/flow.js and registers through the same Flow router. */
(() => {
  if (typeof Flow === 'undefined') return;
  const esc = Flow.esc;

  /* ---------- MY TRIPS ---------- */
  Flow.register({
    id: 'trips', title: 'My Requests',
    render() {
      const b = Bookings.current();
      const inc = Bookings.incoming(b).filter((x) => x.state !== 'declined');
      const myReqs = reqStore.all().filter((r) => ['requested', 'accepted', 'crew'].includes(r.state));
      const tab = Flow.ctx.tripsTab || 'active';
      const sel = (Flow.ctx.seats || []).map(String);
      const cur = b ? (b.coach || b.deck) : null;
      const card = (x) => `
        <div class="fcard" role="group" aria-label="${esc(x.fromName || 'Traveller')} request">
          <div class="frow"><span class="avatar" aria-hidden="true">${esc((x.fromName || 'T')[0])}</span>
            <div style="flex:1"><b>${esc(x.fromName)}</b> <span class="fpill">${esc(x.state)}</span><br/>
            <span class="fmuted">${modeIcon(x.mode)} ${esc(x.serviceNo)} · ${esc(x.from)} → ${esc(x.to)} · ${fmtDate(x.date)}</span></div></div>
          <p class="fmuted">wants your seat · ${esc((x.theirWant || []).map((w) => (typeof wantLabel !== 'undefined' ? wantLabel(w) : w)).join(', '))}</p>
          <div class="frow">
            ${x.state === 'pending' ? `<button type="button" class="fbtn" data-view="${x.id}">Review</button><button type="button" class="fbtn ghost" data-dec="${x.id}">Decline</button>`
            : x.state === 'accepted' ? `<button type="button" class="fbtn" data-ok="${x.id}">View swap</button>`
            : ''}
          </div>
        </div>`;
      return `
      ${Flow.screenHead('Track', 'My Requests', b ? Flow.bookingLine(b) : 'All your requests')}
      <div class="fs-body">
        <div class="ttabs" role="tablist" aria-label="Request status">
          <button type="button" data-ttab="active" class="${tab === 'active' ? 'on' : ''}" role="tab" aria-selected="${tab === 'active'}">Active (${inc.length + myReqs.length || 1})</button>
          <button type="button" data-ttab="done" class="${tab === 'done' ? 'on' : ''}" role="tab" aria-selected="${tab === 'done'}">Completed (0)</button>
        </div>
        ${!b ? `<div class="fcard fcard--ghost"><p class="fmuted">No active journey yet.</p><button type="button" class="fbtn block" data-go-scr="booking">Find your booking</button></div>` : `
        <div class="fcard">
          <div class="frow"><b>${esc(b.carrier)} (${esc(b.no)})</b><span class="statuspill live">● Active</span></div>
          <p class="fmuted">${esc(b.from)} → ${esc(b.to)} · ${fmtDate(b.date)}</p>
          <p class="fmuted">${sel.length || 1} seat${sel.length === 1 ? '' : 's'}: ${esc(sel.map((s) => (cur ? cur + '-' + s : s)).join(', ') || Flow.seatLabel(b))} · Looking for: Lower berth</p>
          <p class="fine">Status: Searching for matches…</p>
          <button type="button" class="fbtn ghost block" data-go-scr="track">View Details</button>
        </div>`}
        ${inc.map(card).join('')}
        ${myReqs.length ? myReqs.map((r) => `
          <div class="fcard" role="group" aria-label="My request">
            <div class="frow"><b>Request · ${esc(r.snap && r.snap.name)}</b> <span class="fpill">${esc(r.state)}</span></div>
            <p class="fmuted">${modeIcon(r.snap && r.snap.mode)} ${esc(r.snap && r.snap.no)} · ${leftIn(r.expires)}</p>
          </div>`).join('') : ''}
        ${b && !inc.length && !myReqs.length ? `<p class="fine" style="text-align:center">No requests yet. Search for matches to send one.</p>` : ''}
        ${b ? `<button type="button" class="fbtn ghost block" data-go-scr="track">Track current journey</button>` : ''}
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => Flow.show(x.dataset.goScr)));
      root.querySelectorAll('[data-ttab]').forEach((t) => t.addEventListener('click', () => { Flow.ctx.tripsTab = t.dataset.ttab; Flow.show('trips'); }));
      root.querySelectorAll('[data-view]').forEach((x) => x.addEventListener('click', () => Flow.show('request', { incomingId: x.dataset.view })));
      root.querySelectorAll('[data-dec]').forEach((x) => x.addEventListener('click', () => { Bookings.declineIncoming(x.dataset.dec); Flow.show('trips'); }));
      root.querySelectorAll('[data-ok]').forEach((x) => x.addEventListener('click', () => { Flow.ctx.incomingId = x.dataset.ok; Flow.show('accepted'); }));
    },
  });

  /* ---------- WALLET ---------- */
  Flow.register({
    id: 'wallet', title: 'Wallet',
    render() {
      const w = Wallet.get();
      const rows = (w.ledger || []).slice(0, 10).map((t) => `<div class="frow frow--line"><span>${esc(t.reason)}</span><b>${t.amount > 0 ? '+' : ''}${t.amount}</b></div>`).join('');
      return `
      ${Flow.screenHead('Account', 'Wallet', 'credits-only: no top-ups in v1')}
      <div class="fs-body">
        <div class="fcard fcard--search"><div class="big-amount">₹${w.balance || 0}<span class="fine">available credit</span></div>
          <p class="fmuted" style="text-align:center">No-match refunds and admin grants. Credits apply to a future search automatically.</p></div>
        ${rows ? `<div class="fcard"><div class="fsub">Recent activity</div>${rows}</div>` : '<div class="fcard fcard--ghost"><p class="fmuted">No transactions yet.</p></div>'}
      </div>`;
    },
  });

  /* ---------- PROFILE ---------- */
  Flow.register({
    id: 'profile', title: 'Profile',
    render() {
      const b = Bookings.current();
      const w = Wallet.get();
      const inr = Flow.money();
      const free = typeof MONETIZE !== 'undefined' ? MONETIZE.freeListings : 5;
      const left = Math.max(0, free - Wallet.activeListings());
      return `
      ${Flow.screenHead('Account', 'Profile', '')}
      <div class="fs-body">
        <div class="fcard">
          <div class="frow"><span class="avatar" aria-hidden="true">${esc((b && b.primary && b.primary.name || 'G')[0])}</span>
            <div><b>${esc((b && b.primary && b.primary.name) || 'Guest traveller')}</b><br/>
            <span class="fmuted">${w.plan === 'plus' ? '💎 Plus member' : 'Free · ' + left + ' listings'}</span></div></div>
        </div>
        ${(typeof Auth !== 'undefined' && Auth.isAvailable() !== false) ? `
        <div class="fcard">
          <div class="frow"><b>Account</b></div>
          ${Auth.signedIn() ? `
          <p class="fmuted">Signed in as ${esc(Auth.user().phoneMasked)} - your number is never shown to other travellers.</p>
          <div class="chips"><button type="button" class="chip" id="profOut">Sign out</button></div>` : `
          <p class="fmuted">Sign in with a one-time code to publish swaps and coordinate with other travellers for real.</p>
          <div class="chips"><button type="button" class="chip" data-go-scr="login">Sign in</button></div>`}
        </div>` : ''}
        <div class="fcard">
          <div class="frow"><b>Billing</b></div>
          <p class="fmuted">Search ₹${inr.SEARCH_FEE} · one-sided swap ₹${inr.ONE_SIDED_SWAP_FEE} · Boost ₹29 · Plus ₹99/mo.</p>
          <div class="chips">
            <button type="button" class="chip" id="goPlus">💎 Plus</button>
            <button type="button" class="chip" id="goKeys">⚙ Billing keys</button>
          </div>
        </div>
        <div class="fcard">
          <div class="frow"><b>Safety</b></div>
          <p class="fmuted">Crew/operator approval is always required. Agreement here is coordination, not a reassignment.</p>
          <div class="chips"><button type="button" class="chip" data-go-scr="home">Safety guide</button><button type="button" class="chip" data-go-scr="home">Privacy</button></div>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => Flow.show(x.dataset.goScr)));
      const profOut = root.querySelector('#profOut');
      if (profOut) profOut.addEventListener('click', async () => {
        if (typeof Auth !== 'undefined') await Auth.logout();
        Flow.ctx.boardData = null;
        toast('Signed out.');
        Flow.show('profile');
      });
      const plus = root.querySelector('#goPlus');
      if (plus) plus.addEventListener('click', () => {
        if (typeof paywallHTML === 'function') {
          const m = document.getElementById('modal');
          m.innerHTML = `<div class="sheet">${paywallHTML('Free matching. Paid convenience.')}<div class="row"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
          m.hidden = false;
          if (typeof bindPayButtons === 'function') bindPayButtons();
        }
      });
      const keys = root.querySelector('#goKeys');
      if (keys) keys.addEventListener('click', () => { if (typeof Payments !== 'undefined' && Payments.openKeySettings) Payments.openKeySettings(); });
    },
  });

  /* ---------- MANUAL JOURNEY (fallback: no PNR) ---------- */
  Flow.register({
    id: 'manual', title: 'Add a Journey',
    render() {
      return `
      ${Flow.screenHead('Manual entry', 'Add a Journey', 'No PNR? Draw the map from the service number.')}
      <div class="fs-body">
        <div class="fcard">
          <label class="flabel" for="mNo">${Flow.ctx.mode === 'flight' ? 'Flight number' : Flow.ctx.mode === 'train' ? 'Train number' : 'Operator / service'}</label>
          <input id="mNo" class="finput" placeholder="${Flow.ctx.mode === 'flight' ? 'e.g. 6E2031' : Flow.ctx.mode === 'train' ? 'e.g. 12951' : 'e.g. VRL:HYD42'}" value=""/>
          <div class="frow" style="margin-top:10px">
            <div style="flex:1"><label class="flabel" for="mFrom">Boarding</label><input id="mFrom" class="finput" style="text-transform:uppercase" placeholder="e.g. MMCT"/></div>
            <div style="flex:1"><label class="flabel" for="mTo">Destination</label><input id="mTo" class="finput" style="text-transform:uppercase" placeholder="e.g. NDLS"/></div>
          </div>
          <p class="ferr" id="mErr" role="alert" hidden></p>
        </div>
        <div class="fs-actions"><button type="button" class="fbtn block" id="mGo">Draw my map</button></div>
        <p class="fine">Same maps, same matching — you'll just choose your coach and seat on the map instead of from a booking.</p>
      </div>`;
    },
    wire(root) {
      root.querySelector('#mGo').addEventListener('click', () => {
        const no = root.querySelector('#mNo').value.trim().toUpperCase().replace(/\s+/g, '');
        const err = root.querySelector('#mErr');
        if (!no) { err.textContent = 'Enter a service number.'; err.hidden = false; return; }
        err.hidden = true;
        const from = root.querySelector('#mFrom').value.trim().toUpperCase() || '···';
        const to = root.querySelector('#mTo').value.trim().toUpperCase() || '···';
        const date = new Date().toISOString().slice(0, 10);
        const manual = {
          id: 'manual-' + no + '-' + date, mode: Flow.ctx.mode, no, serviceNo: no,
          carrier: Flow.ctx.mode === 'flight' ? 'Airline' : Flow.ctx.mode === 'train' ? 'Indian Railways' : (no.split(':')[0] || 'Bus'),
          from, to, date, dur: '—', stops: '—',
          classCode: Flow.ctx.mode === 'train' ? 'SL' : Flow.ctx.mode === 'flight' ? 'Economy' : 'Seats',
          pnrMasked: 'manual', pnrHash: 'manual-' + no,
          primary: null, service: serviceKey(Flow.ctx.mode, no, date, from + '→' + to),
          fetchedAt: Date.now(), confidence: 'illustrative', source: 'manual entry', manual: true,
        };
        Flow.ctx.booking = manual;
        Bookings.setCurrent(manual);
        Flow.syncEngine(manual);
        Flow.show('manualmap');
      });
    },
  });

  /* Manual map desk — reuses the classic map/marketplace (the honest path when
     there's no booked seat to start from). */
  Flow.register({
    id: 'manualmap', title: 'Pick your seat on the map',
    render() {
      return `
      ${Flow.screenHead('Manual entry', 'Pick your seat on the map', 'The classic seat map + marketplace, with your service already loaded.')}
      <div class="fs-body">
        <div class="fcard">
          <p class="fmuted">The full map engine is below — tap your seat on it, then come back here to search matches.</p>
          <button type="button" class="fbtn block" id="openMapDesk">Open the seat map</button>
          <button type="button" class="fbtn ghost block" data-go-scr="search">Search matches</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelector('#openMapDesk').addEventListener('click', () => {
        document.getElementById('flow').hidden = true;
        const classic = document.getElementById('classicShell');
        if (classic) classic.hidden = false;
        if (typeof renderJourney === 'function') renderJourney();
        if (typeof renderMap === 'function') renderMap();
        const ms = document.getElementById('mapSection');
        if (ms) { ms.hidden = false; ms.scrollIntoView({ behavior: 'smooth' }); }
      });
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => Flow.show(x.dataset.goScr)));
    },
  });
})();
