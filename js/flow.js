/* SwapSeat · mobile-first screen flow (the product designs).
   ---------------------------------------------------------------------------
   One router, many screens. Requester screens live here; the accepter screens
   register from js/accept.js and the post-confirmation screens from
   js/journey.js — all through Flow.register(), so a screen can be added without
   touching this file.

   PRODUCT CONTRACT (unchanged, enforced everywhere):
     · A seat is a PLACE. Maps first, abbreviations second.
     · Matching is per service instance (mode + number + date + segment).
     · Agreement in-app is coordination — the crew/operator decides.
     · Prices/eligibility/privacy come from Policy, never from markup.
     · An offline tap is never shown as confirmed. */
const Flow = (() => {
  const screens = {};
  const history = [];
  const ctx = {
    mode: 'flight', booking: null, seats: [], prefs: null, reason: '',
    matchId: null, matchIds: [], requestId: null, incomingId: null, swap: null, request: null, journey: null,
  };
  let currentId = null;

  const $f = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- registry + router ---------- */
  function register(def) {
    if (!def || !def.id || typeof def.render !== 'function') throw new Error('Flow.register needs { id, render }');
    screens[def.id] = def;
  }
  function show(id, params) {
    const def = screens[id];
    if (!def) { console.warn('[flow] unknown screen:', id); return; }
    if (currentId && currentId !== id) history.push(currentId);
    if (params) Object.assign(ctx, params);
    currentId = id;

    const mount = document.getElementById('flowScreen');
    if (!mount) return;
    mount.setAttribute('data-screen', id);
    mount.setAttribute('role', def.role || 'group');
    mount.setAttribute('aria-label', def.title || 'SwapSeat');
    mount.innerHTML = def.render(ctx) || '';

    const title = document.getElementById('fsTitle');
    if (title) title.textContent = def.title || 'SwapSeat';
    const back = document.getElementById('fsBack');
    if (back) back.hidden = id === 'home';
    document.title = (def.title ? def.title + ' · ' : '') + 'SwapSeat';

    if (def.wire) def.wire(mount, ctx);
    syncNav();
    if (typeof updateOnlineUI === 'function') updateOnlineUI();
    if (typeof Metrics !== 'undefined') Metrics.log('screen_' + id);
    window.scrollTo(0, 0);
  }
  function back() {
    const prev = history.pop();
    show(prev || 'home');
  }
  function syncNav() {
    document.querySelectorAll('#flowNav [data-go]').forEach((b) => {
      const also = (b.dataset.also || '').split(',');
      const on = b.dataset.go === currentId || also.indexOf(currentId) >= 0;
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  /* ---------- engine bridge ----------
     The flow and the classic map/marketplace share one state object, so a
     booking fetched here drives scoreAll(), the seat maps and the marketplace
     exactly as a manual lookup does. */
  function syncEngine(b) {
    if (typeof state === 'undefined' || !b) return;
    state.mode = b.mode;
    const t = Bookings.vehicleOf(b);
    if (b.mode === 'flight') {
      state.journey = { kind: 'flight', flight: (typeof FLIGHT_INDEX !== 'undefined' && FLIGHT_INDEX[b.no]) || b, date: b.date };
      state.craft = b.craft;
      state.mineFlight = b.primary ? b.primary.seat : null;
      state.mine = null;
    } else {
      state.journey = { kind: b.mode, train: t, date: b.date };
      state.coach = b.coach || b.deck || (t.coaches && t.coaches[0]);
      state.mine = b.primary ? b.primary.seat : null;
      state.mineFlight = null;
    }
    state.wantTypes = (Bookings.prefs(b.id).kinds || []).slice();
    state.wantSeats = Bookings.claims(b.id).slice();
    state.filter = 'all';
    const f = $f('#segFrom'), t2 = $f('#segTo');
    if (f) f.value = b.from;
    if (t2) t2.value = b.to;
  }

  /* ---------- shared bits ---------- */
  const money = () => Policy.fees();
  function walletPill() {
    const w = Wallet.get();
    return w.plan === 'plus' ? '💎 Plus' : ('👛 ₹' + (w.balance || 0));
  }
  function bookingLine(b) {
    if (!b) return '';
    return `${modeIcon(b.mode)} ${esc(b.carrier)} ${esc(b.serviceNo)} · ${esc(b.from)} → ${esc(b.to)} · ${fmtDate(b.date)}`;
  }
  function seatLabel(b) {
    if (!b || !b.primary) return '—';
    const raw = b.primary.seatLabel || b.primary.seat;
    const coach = myCoach(b);
    if (coach && /^[0-9]+$/.test(String(raw))) return coach + '-' + raw;
    return raw;
  }
  /* Comfort score for the boards: window + lower + position. Never a promise,
     just a visual insight like the designs. */
  function comfortOf(b, seatId) {
    const info = b && b.primary && b.primary.info;
    let s = 6;
    const t = String(seatId == null ? (b && b.primary && b.primary.seat) : seatId);
    if (info) {
      if (/window/i.test(info.blurb || '') || info.pos === 'W' || info.type === 'LB') s += 2;
      if (/lower/i.test(info.blurb || '') || info.type === 'LB' || info.level === 1) s += 1;
      if (/middle/i.test(info.blurb || '')) s += 1;
    } else {
      if (/A|C|F/i.test(t.slice(-1))) s += 1;
    }
    return Math.max(1, Math.min(10, s));
  }
  function comfortBullets(b) {
    if (b.mode === 'train') return ['Good for long journeys', 'Less disturbance', 'Easy to sleep', 'Keep luggage under seat'];
    if (b.mode === 'flight') return ['More legroom when possible', 'Easy aisle access', 'Quicker exit after landing'];
    return ['Good visibility', 'Easy boarding', 'Less disturbance'];
  }

  /* Recent journeys (privacy-safe): Bookings.remember() stores only a masked
     reference, so Home can offer a one-tap resume without keeping the PNR. */
  function recentHTML() {
    const refs = (typeof Bookings !== 'undefined' && Bookings.refs ? Bookings.refs() : []).slice(0, 3);
    if (!refs.length) return '';
    return `<div class="fcard fcard--ghost">
      <div class="frow"><b>🕘 ${T('home.recent')}</b></div>
      <p class="fmuted">${T('home.recent.sub')}</p>
      ${refs.map((r) => `<button type="button" class="chip" data-recent="${esc(r.pnrHash)}">${modeIcon(r.mode)} ${esc(r.carrier)} ${esc(r.no)} · ${esc(r.from)} → ${esc(r.to)}${r.seatLabel ? ' · ' + esc(r.seatLabel) : ''}</button>`).join(' ')}
    </div>`;
  }
  function myCoach(b) { return b ? (b.coach || b.deck || null) : null; }

  /* ---------- compact seat grid ----------
     Mobile-first and windowed around the traveller's own seat, so a phone never
     has to scroll 31 rows to find itself. Markup only — no availability claim. */
  function compactGrid(b, selected) {
    const sel = (selected || []).map(String);
    if (b.mode === 'flight') {
      const spec = AIRCRAFT[b.craft];
      const sec = sectionForRow(b.craft, b.primary.info.row) || spec.sections[spec.sections.length - 1];
      const flat = sec.letters.map((g) => g.join('|')).join('|').split('|');
      const myRow = b.primary.info.row;
      const from = Math.max(sec.from, myRow - 5), to = Math.min(sec.to, myRow + 5);
      let h = '<div class="seatgrid" role="group" aria-label="Cabin rows ' + from + ' to ' + to + '">';
      h += '<div class="sgr"><span class="rno"></span>' + flat.map((L) => '<span class="sgh">' + L + '</span>').join('') + '</div>';
      for (let r = from; r <= to; r++) {
        h += '<div class="sgr"><span class="rno">' + r + '</span>';
        let seen = 0;
        sec.groups.forEach((g) => {
          for (let i = 0; i < g; i++) {
            if (r === sec.to && sec.endRow && seen + i >= sec.endRow) { seen += 0; continue; }
            const L = flat[seen + i];
            const id = r + L;
            const cls = ['seat'];
            if (id === String(b.primary.seat)) cls.push('mine');
            if (sel.indexOf(id) >= 0) cls.push('sel');
            h += `<button type="button" class="${cls.join(' ')}" data-seat="${id}" aria-pressed="${sel.indexOf(id) >= 0}">${L}</button>`;
          }
          seen += g;
          if (seen < flat.length) h += '<span class="sga" aria-hidden="true"></span>';
        });
        h += '</div>';
      }
      return h + '</div>';
    }
    /* berth deck: the traveller's bay and its neighbours */
    const t = Bookings.vehicleOf(b);
    const spec = specOf(t, myCoach(b));
    const info = b.primary.info;
    const bays = info.bayCount || 1;
    const lo = Math.max(1, info.bay - 1), hi = Math.min(bays, info.bay + 1);
    let h = '<div class="seatgrid seatgrid--berth" role="group" aria-label="Berths near bay ' + info.bay + '">';
    for (let by = lo; by <= hi; by++) {
      h += '<div class="sgr sgr--bay"><span class="rno">' + by + '</span>';
      baySeats(spec, by).nums.forEach((n) => {
        const type = berthAt(spec, n);
        const cls = ['seat', 'sb-' + type];
        if (String(n) === String(b.primary.seat)) cls.push('mine');
        if (sel.indexOf(String(n)) >= 0) cls.push('sel');
        h += `<button type="button" class="${cls.join(' ')}" data-seat="${n}" aria-pressed="${sel.indexOf(String(n)) >= 0}"
          aria-label="Berth ${n}, ${berthMeta(type).name}">${n}<i aria-hidden="true">${type}</i></button>`;
      });
      h += '</div>';
    }
    return h + '</div>';
  }

  /* One selection model for every seat grid: single-select by default, up to
     `max` seats when the traveller is listing several. */
  function bindSeatGrid(root, opts) {
    const o = opts || {};
    const max = o.max || 1;
    let picked = (o.initial || []).map(String);
    root.querySelectorAll('[data-seat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = String(btn.dataset.seat);
        const at = picked.indexOf(id);
        if (at >= 0) picked.splice(at, 1);
        else if (picked.length < max) picked.push(id);
        else { if (typeof toast === 'function') toast('Up to ' + max + ' seats in one swap.'); return; }
        root.querySelectorAll('[data-seat]').forEach((b) => {
          const on = picked.indexOf(String(b.dataset.seat)) >= 0;
          b.classList.toggle('sel', on);
          b.setAttribute('aria-pressed', String(on));
        });
        if (o.onChange) o.onChange(picked.slice());
      });
    });
  }

  /* ---------- small view helpers ---------- */
  function screenHead(eyebrow, h2, sub) {
    return `<div class="fs-head"><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(h2)}</h2>${sub ? `<p class="fmuted">${sub}</p>` : ''}</div>`;
  }
  function offlineNote() {
    return `<p class="safe-note" data-offline-note hidden>📴 Reconnect to confirm availability and requests. Nothing below is confirmed while offline.</p>`;
  }
  function stepsBar(active, list) {
    return `<div class="steps-bar" aria-hidden="true">${list.map((s, i) => `<span class="${i <= active ? 'on' : ''}">${s}</span>`).join('')}</div>`;
  }

  /* ======================================================================
     REQUESTER FLOW — booking-first wizard. Thin views over the shared engine;
     Policy decides price/eligibility, Bookings owns data.
     ====================================================================== */

  /* ---------- HOME ---------- */
  register({
    id: 'home', title: 'SwapSeat',
    render() {
      const b = Bookings.current();
      const inc = Bookings.incoming(b);
      const pending = inc.filter((x) => x.state === 'pending').length;
      const tag = ctx.mode === 'train' ? 'Same trains. Happier journeys.'
        : ctx.mode === 'bus' ? 'Bus journeys. Kinder people.' : 'Journeys are better together.';
      return `
      <div class="fs-head fs-head--home">
        <div class="brand-row"><span class="brand-mark" aria-hidden="true">${modeIcon(ctx.mode === 'train' ? 'train' : ctx.mode)}</span>
          <div><h1>SwapSeat</h1><p class="fmuted">${tag}</p></div></div>
        <p class="tagline">${T('app.promise')}</p>
        <div class="mode-tabs mode-tabs--flow" role="tablist" aria-label="Transport mode">
          ${['train', 'bus', 'flight'].map((m) => `<button type="button" data-mode="${m}" role="tab" class="${ctx.mode === m ? 'on' : ''}" aria-selected="${ctx.mode === m}">${modeIcon(m)}<span>${m === 'train' ? 'Trains' : m === 'bus' ? 'Buses' : 'Flights'}</span></button>`).join('')}
        </div>
      </div>
      <div class="fs-body">
        <div class="trust-row" role="list">
          <span role="listitem">🛡️ ${T('trust.verified')}</span>
          <span role="listitem">🔒 ${T('trust.safe')}</span>
          <span role="listitem">🔁 ${T('trust.same')}</span>
          <span role="listitem">💰 ₹${money().SEARCH_FEE} ${T('trust.searchfee')}</span>
          <span role="listitem">🚫 ${T('trust.noleak')}</span>
        </div>
        ${(typeof Auth !== 'undefined' && Auth.isAvailable() !== false) ? `
        <div class="fcard fcard--ghost" id="acctCard">
          ${Auth.signedIn() ? `
          <div class="frow"><b>Signed in · ${esc(Auth.user().phoneMasked)}</b></div>
          <p class="fmuted">Your number is never shown to other travellers.</p>
          <div class="chips">
            <button type="button" class="chip" data-go-scr="x-journey">🚆 Start a real exchange</button>
            <button type="button" class="chip" data-go-scr="board">Journey board</button>
            <button type="button" class="chip" id="acctOut">Sign out</button>
          </div>` : `
          <div class="frow"><b>Swap for real</b></div>
          <p class="fmuted">Sign in with a one-time code to publish your seat and accept swaps with other signed-in travellers on your journey.</p>
          <div class="chips">
            <button type="button" class="chip" data-go-scr="board">Journey board</button>
            <button type="button" class="chip" data-go-scr="login">Sign in</button>
          </div>`}
        </div>` : ''}
        ${recentHTML()}
        <div class="fcard fcard--ghost">
          <div class="frow"><b>🗺️ ${T('home.sample.title')}</b></div>
          <p class="fmuted">${T('home.sample.sub')}</p>
          <button type="button" class="fbtn ghost block" data-sample>${T('home.sample')}</button>
        </div>

        ${b ? `
        <div class="fcard fcard--booking">
          <div class="frow"><b>${bookingLine(b)}</b></div>
          <p class="fmuted">${esc(b.dur)} · ${esc(b.stops)} · ${esc(b.classCode)} · your seat <b>${esc(seatLabel(b))}</b></p>
          <div class="chips">
            <button type="button" class="chip" data-go-scr="seats">${T('home.choose')}</button>
            <button type="button" class="chip" data-go-scr="prefs">${T('home.setprefs')}</button>
            <button type="button" class="chip" data-go-scr="search">${T('home.searchnow')}</button>
          </div>
        </div>` : ''}

        ${pending ? `
        <div class="fcard fcard--notif">
          <div class="frow"><b>🔔 ${pending} ${T('home.pending')}</b></div>
          <p class="fmuted">Someone on your ${ctx.mode === 'flight' ? 'flight' : ctx.mode === 'bus' ? 'bus' : 'train'} wants your seat.</p>
          <button type="button" class="fbtn block" data-go-scr="notif">${T('home.review')}</button>
        </div>` : ''}

        <div class="fcard">
          <div class="frow"><b>${T('home.find')}</b></div>
          <p class="fmuted">${T('home.find.sub')}</p>
          <button type="button" class="fbtn block" data-go-scr="booking">Get Started</button>
          <p class="fine" style="text-align:center">Verified travellers · Same destination · Secure payments</p>
        </div>

        <div class="fcard fcard--ghost">
          <div class="frow"><b>👥 ${T('home.group')}</b></div>
          <p class="fmuted">${T('home.group.sub')}</p>
          <button type="button" class="fbtn ghost block" data-go-scr="manual">${T('home.manual')}</button>
        </div>

        <p class="safe-note">${T('home.safety')}</p>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
        root.querySelectorAll('[data-mode]').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-selected', 'true');
        ctx.mode = b.dataset.mode;
      }));
      root.querySelectorAll('[data-go-scr]').forEach((b) => b.addEventListener('click', () => show(b.dataset.goScr)));
      const sampleBtn = root.querySelector('[data-sample]');
      if (sampleBtn) sampleBtn.addEventListener('click', () => {
        /* One-tap demo journey: resolve the seeded booking through the normal
           lookup path so hydration, geometry validation and engine sync stay
           identical to a real PNR fetch. */
        const demo = (Bookings.DEMO || []).find((d) => d.mode === ctx.mode);
        if (!demo) return;
        const res = Bookings.find(demo.mode, demo.pnr, demo.surname);
        if (res.error) return;
        ctx.booking = res.booking;
        Bookings.setCurrent(res.booking);
        Bookings.remember(res.booking);
        Flow.syncEngine(res.booking);
        show('flightdetails');
      });
      const acctOut = root.querySelector('#acctOut');
      if (acctOut) acctOut.addEventListener('click', async () => {
        if (typeof Auth !== 'undefined') await Auth.logout();
        ctx.boardData = null;
        toast('Signed out.');
        show('home');
      });
      root.querySelectorAll('[data-recent]').forEach((b) => b.addEventListener('click', () => {
        const r = (Bookings.refs ? Bookings.refs() : []).find((x) => x.pnrHash === b.dataset.recent);
        if (!r) { show('booking'); return; }
        /* Refs are masked; re-resolve through the normal lookup so hydration,
           geometry validation and engine sync stay on one code path. */
        const demo = (Bookings.DEMO || []).find((d) => d.mode === r.mode && d.no === r.no);
        const res = demo ? Bookings.find(r.mode, demo.pnr, demo.surname) : { error: 'not found' };
        if (res.error) { show('booking'); return; }
        ctx.booking = res.booking;
        Bookings.setCurrent(res.booking);
        Bookings.remember(res.booking);
        Flow.syncEngine(res.booking);
        show('flightdetails');
      }));
    },
  });

  /* ---------- BOOKING: PNR + surname ---------- */
  register({
    id: 'booking', title: 'Plan your Journey',
    render() {
      const dflt = ctx.mode === 'train' ? { pnr: '6532198745', from: 'VSKP', to: 'HYB', no: '20833' }
        : ctx.mode === 'flight' ? { pnr: '6E4F3B', from: 'DEL', to: 'BLR', no: '6E2135' }
        : { pnr: 'KRT8821', from: 'HYD', to: 'BLR', no: 'KSRTC' };
      return `
      ${screenHead('Step 1 · Your booking', 'Plan your Journey', '')}
      <div class="fs-body">
        <div class="ftabs" role="tablist" aria-label="Lookup method">
          <button type="button" class="on" data-tab="pnr" role="tab" aria-selected="true">PNR / Booking ID</button>
          <button type="button" data-tab="id" role="tab" aria-selected="false">Manual Entry</button>
        </div>
        <div class="fcard">
          <label class="flabel" for="bPnr">Enter PNR / Booking ID</label>
          <input id="bPnr" class="finput" inputmode="text" autocomplete="off" value="${esc(dflt.pnr)}"
            placeholder="${ctx.mode === 'flight' ? 'e.g. 6E4F3B' : ctx.mode === 'train' ? 'e.g. 6532198745' : 'e.g. KRT8821'}"/>
          <label class="flabel" for="bSurname" style="margin-top:12px">Passenger surname (as on ticket)</label>
          <input id="bSurname" class="finput" autocomplete="family-name" placeholder="e.g. Mohanty"/>
          <div class="frow" style="margin-top:10px">
            <div style="flex:1"><label class="flabel" for="bFrom">From</label><input id="bFrom" class="finput" style="text-transform:uppercase" value="${esc(dflt.from)}"/></div>
            <div style="flex:1"><label class="flabel" for="bTo">To</label><input id="bTo" class="finput" style="text-transform:uppercase" value="${esc(dflt.to)}"/></div>
          </div>
          <label class="flabel" for="bNo" style="margin-top:10px">${ctx.mode === 'flight' ? 'Flight' : ctx.mode === 'train' ? 'Train' : 'Bus'} (number / name)</label>
          <input id="bNo" class="finput" value="${esc(dflt.no)}"/>
          <label class="flabel" for="bDate" style="margin-top:10px">Date of journey</label>
          <input id="bDate" class="finput" type="date" value="${new Date().toISOString().slice(0, 10)}"/>
          <p class="fine">🔒 We read your booking to find your seat. We never store or share your PNR.</p>
          <p class="ferr" id="bErr" role="alert" hidden></p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="bFetch" data-online>Find My Seats</button>
          <button type="button" class="fbtn ghost block" data-go-scr="manual">Add journey manually instead</button>
        </div>
        <p class="safe-note">Secure · Encrypted · On-device. A real booking replaces the demo lookup when a licensed PNR provider is connected.</p>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
        if (t.dataset.tab === 'id') { show('manual'); return; }
        root.querySelectorAll('[data-tab]').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
        t.classList.add('on'); t.setAttribute('aria-selected', 'true');
      }));
      root.querySelectorAll('[data-go-scr]').forEach((b) => b.addEventListener('click', () => show(b.dataset.goScr)));
      const fetchBtn = root.querySelector('#bFetch');
      const err = root.querySelector('#bErr');
      fetchBtn.addEventListener('click', () => {
        if (!online()) { err.textContent = '📴 You are offline — reconnect to look up a booking.'; err.hidden = false; return; }
        const res = Bookings.find(ctx.mode, root.querySelector('#bPnr').value, root.querySelector('#bSurname').value);
        if (res.error) { err.textContent = res.error; err.hidden = false; return; }
        err.hidden = true;
        ctx.booking = res.booking;
        Bookings.setCurrent(res.booking);
        Bookings.remember(res.booking);
        Flow.syncEngine(res.booking);
        Metrics.log('journey_started'); Metrics.log('layout_viewed');
        show('flightdetails');
      });
    },
  });

  /* ---------- BOOKING RETRIEVED ---------- */
  register({
    id: 'flightdetails', title: ctx.mode === 'flight' ? 'Your Flight Details' : ctx.mode === 'bus' ? 'Bus Details' : 'Your Train Details',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const p = b.primary;
      const info = p && p.info;
      return `
      ${screenHead('Step 2 · Retrieved', ctx.mode === 'flight' ? 'Your Flight Details' : ctx.mode === 'bus' ? 'Bus Details' : 'Your Train Details', '')}
      <div class="fs-body">
        <div class="fcard fcard--booking">
          <div class="frow"><span class="fpill">${esc(b.carrier)} ${esc(b.serviceNo)}</span><span class="fpill">${esc(b.classCode)}</span></div>
          <div class="route"><b>${esc(b.from)}</b><span class="rline" aria-hidden="true"></span><b>${esc(b.to)}</b></div>
          <p class="fmuted">${fmtDate(b.date)} · ${esc(b.dur)} · ${esc(b.stops)}</p>
          <div class="times"><span>${esc(b.dep)}</span><span class="rarrow" aria-hidden="true">→</span><span>${esc(b.arr)}</span></div>
          <div class="frow" style="margin-top:8px">
            <span class="avatar" aria-hidden="true">${esc((p.name || 'Y')[0])}</span>
            <div><b>${esc(p.name)}</b><br/><span class="fmuted">Seat ${esc(p.seatLabel || p.seat)} · ${esc(b.classCode)}</span></div>
          </div>
          ${b.amenities ? `<div class="chips">${b.amenities.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>` : ''}
          ${b.boarding ? `<p class="fine" style="margin-top:8px">Boarding: ${esc(b.boarding)} · Dropping: ${esc(b.dropping)}</p>` : ''}
          ${info ? `<p class="fine" style="margin-top:8px">${esc(info.blurb)}</p>` : ''}
          <p class="fine">Reference ${esc(b.pnrMasked)} · verified booking · stored on this device only.</p>
        </div>
        <div class="fs-actions"><button type="button" class="fbtn block" data-go-scr="seats">Continue</button></div>
      </div>`;
    },
    wire(root) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr))); },
  });

  /* ---------- CHOOSE SEAT(S) ---------- */
  register({
    id: 'seats', title: 'Select Your Seat(s)',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const sel = Bookings.claims(b.id);
      const t = Bookings.vehicleOf(b);
      const coaches = (t && t.coaches ? t.coaches.slice(0, 8) : [myCoach(b)]).filter(Boolean);
      const cur = myCoach(b);
      return `
      ${screenHead('Step 3 · Your seat', 'Select Your Seat(s)', 'Choose one or more seats')}
      <div class="fs-body">
        <div class="coachline"><span class="fpill">Coach ${esc(cur || b.classCode || '')} (${esc(b.classCode || '')})</span></div>
        <div class="cls-tabs" role="tablist" aria-label="Coach">${coaches.map((c) => `<button type="button" role="tab" class="${c === cur ? 'on' : ''}" data-coach="${esc(c)}" aria-selected="${c === cur}">${esc(c)}</button>`).join('')}</div>
        ${compactGrid(b, sel)}
        <div class="legendrow" role="list">
          <span role="listitem"><i class="lk lk-mine"></i>Your seat</span>
          <span role="listitem"><i class="lk lk-sel"></i>Selected</span>
          <span role="listitem"><i class="lk lk-other"></i>Other seats</span>
        </div>
        <p class="fmuted">Tap the seat(s) you're willing to swap from. Your booked seat is highlighted.</p>
        <p class="fine" id="seatSummary">${sel.length ? 'Selected: <b>' + esc(sel.map((s) => (cur ? cur + '-' + s : s)).join(', ')) + ' (' + sel.length + ')' : 'Your booked seat is preselected — tap to add others (up to 3).'}</p>
        <button type="button" class="fbtn ghost block" id="fullLayout">View full coach layout</button>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="seatNext">Continue</button>
        </div>
      </div>`;
    },
    wire(root) {
      const b = ctx.booking;
      if (!b) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr))); return; }
      root.querySelectorAll('[data-coach]').forEach((c) => c.addEventListener('click', () => {
        if (b) { b.coach = c.dataset.coach; b.deck = c.dataset.coach; Bookings.setCurrent(b); Flow.syncEngine(b); }
        show('seats');
      }));
      let picked = (Bookings.claims(b.id).length ? Bookings.claims(b.id) : [b.primary.seat]).map(String);
      const summary = () => {
        const cur = myCoach(b);
        const el = root.querySelector('#seatSummary');
        if (el) el.innerHTML = picked.length ? 'Selected: <b>' + esc(picked.map((s) => (cur ? cur + '-' + s : s)).join(', ')) + ' (' + picked.length + ')' : 'Tap a seat to swap from.';
      };
      bindSeatGrid(root, {
        max: 3, initial: picked,
        onChange(sel) {
          picked = sel;
          Bookings.setClaims(b.id, sel);
          summary();
        },
      });
      const full = root.querySelector('#fullLayout');
      if (full) full.addEventListener('click', () => show('manualmap'));
      root.querySelector('#seatNext').addEventListener('click', () => {
        if (!picked.length) { toast('Pick the seat(s) you are willing to swap from.'); return; }
        ctx.seats = picked.slice();
        show('seatdetails');
      });
    },
  });

  /* ---------- SEAT DETAILS + COMFORT (boards step 4) ---------- */
  register({
    id: 'seatdetails', title: 'Your Seat(s)',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p></div></div>`;
      const sel = (ctx.seats && ctx.seats.length ? ctx.seats : Bookings.claims(b.id)).map(String);
      const cur = myCoach(b);
      const score = comfortOf(b);
      return `
      ${screenHead('Step 4 · Insights', 'Your Seat(s)', sel.length + ' seat' + (sel.length === 1 ? '' : 's') + ' selected')}
      <div class="fs-body">
        <div class="seatchips">${sel.map((s) => `<span class="seatchip">${esc(cur ? cur + '-' + s : s)}</span>`).join('')}</div>
        <div class="rev">
          <div class="rrow"><span class="fmuted">Coach</span><b>${esc(cur || b.classCode || '—')} (${esc(b.classCode || '')})</b></div>
          <div class="rrow"><span class="fmuted">Position</span><b>${esc(b.primary && b.primary.info ? b.primary.info.blurb : 'Window · Middle')}</b></div>
        </div>
        <div class="comfort">
          <div class="crow"><b>Comfort Score</b><span class="score"><b>${score}</b>/10</span></div>
          <div class="cbar" role="img" aria-label="Comfort ${score} out of 10"><i style="width:${score * 10}%"></i></div>
          <ul class="cbul">${comfortBullets(b).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
        <div class="fs-actions"><button type="button" class="fbtn block" data-go-scr="prefs">Continue</button></div>
      </div>`;
    },
    wire(root) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr))); },
  });

  /* ---------- PREFERENCES ---------- */
  const PREF_KINDS = {
    flight: ['Window seat', 'Aisle seat', 'Middle seat'],
    train: ['Lower berth', 'Middle berth', 'Upper berth', 'Window seat', 'Same coach only', 'Any seat'],
    bus: ['Window seat', 'Aisle seat', 'Lower deck', 'Upper deck'],
  };
  const PREF_WHERE = {
    flight: ['Front rows', 'Middle rows', 'Back rows', 'Exit / legroom rows'],
    train: ['Same coach only', 'Any seat'],
    bus: ['Front rows', 'Middle rows', 'Back rows'],
  };
  const PREF_EXTRA = ['Travelling with family', 'Quiet environment', 'More legroom'];
  const PREF_REASONS = ['Travelling with family', 'Knee / medical issue', 'Senior citizen', 'Need side-by-side seats', 'Prefer lower berths', 'Other'];
  register({
    id: 'prefs', title: 'What are you looking for?',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p></div></div>`;
      const p = Bookings.prefs(b.id);
      const kinds = PREF_KINDS[ctx.mode] || PREF_KINDS.flight;
      const where = PREF_WHERE[ctx.mode] || PREF_WHERE.flight;
      const chip = (list, on, group) => list.map((x) => `<button type="button" class="prefchip ${on ? 'on' : ''}" data-g="${group}" data-v="${esc(x)}" aria-pressed="${on}">${esc(x)}</button>`).join('');
      return `
      ${screenHead('Step 5 · Preferences', 'What are you looking for?', 'Seat type & reason')}
      <div class="fs-body">
        <div class="fgroup"><div class="fsub">Preferred seat type</div><div class="chips">${chip(kinds, false, 'kinds')}</div></div>
        ${ctx.mode === 'train' ? '' : `<div class="fgroup"><div class="fsub">Preferred location</div><div class="chips">${chip(where, false, 'where')}</div></div>`}
        <div class="fgroup"><div class="fsub">Why do you want to swap?</div><div class="chips">${chip(PREF_REASONS, false, 'extra')}</div></div>
        <label class="flabel" for="prefNote">Note for swappers (optional)</label>
        <input id="prefNote" class="finput" placeholder="e.g. Travelling with elderly parent" value="${esc(p.note || '')}"/>
        <p class="fine">More flexible preferences give better matches. Nothing here is shared until you send a request.</p>
        <div class="fs-actions"><button type="button" class="fbtn block" id="prefNext">Continue</button></div>
      </div>`;
    },
    wire(root) {
      const b = ctx.booking; if (!b) return;
      const sel = { kinds: new Set(Bookings.prefs(b.id).kinds), where: new Set(Bookings.prefs(b.id).where), extra: new Set(Bookings.prefs(b.id).extra) };
      root.querySelectorAll('.prefchip').forEach((c) => c.addEventListener('click', () => {
        const g = c.dataset.g, v = c.dataset.v, set = sel[g];
        if (g === 'extra') { sel.extra = new Set([v]); root.querySelectorAll('.prefchip[data-g="extra"]').forEach((x) => { const on = x.dataset.v === v; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); return; }
        const on = !set.has(v);
        if (on) set.add(v); else set.delete(v);
        c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
      }));
      root.querySelector('#prefNext').addEventListener('click', () => {
        const prefs = {
          kinds: [...sel.kinds], where: [...sel.where], extra: [...sel.extra],
          note: (root.querySelector('#prefNote').value || '').trim(),
        };
        Bookings.setPrefs(b.id, prefs);
        ctx.prefs = prefs;
        ctx.reason = (sel.extra.values().next().value) || '';
        state.wantTypes = prefs.kinds.map((k) => k.split(' ')[0]).filter(Boolean);
        Metrics.log('preferences_saved');
        show('review');
      });
    },
  });

  /* ---------- REVIEW REQUEST (boards step 6) ---------- */
  register({
    id: 'review', title: 'Review Your Request',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p></div></div>`;
      const sel = (ctx.seats && ctx.seats.length ? ctx.seats : Bookings.claims(b.id)).map(String);
      const cur = myCoach(b);
      const p = ctx.prefs || Bookings.prefs(b.id);
      const want = (p.kinds[0] || 'Lower berth') + ' (Any coach)';
      return `
      ${screenHead('Step 6 · Confirm', 'Review Your Request', '')}
      <div class="fs-body">
        <div class="rev">
          <div class="rrow"><span class="fmuted">${esc(b.from)} → ${esc(b.to)}</span><b>${esc(b.carrier)} ${esc(b.serviceNo)} (${esc(b.no)})</b></div>
          <div class="rrow"><span class="fmuted">${fmtDate(b.date)}</span><b>${esc(b.dep)} → ${esc(b.arr)}</b></div>
          <div class="rrow"><span class="fmuted">Your seats (${sel.length})</span><b>${esc(sel.map((s) => (cur ? cur + '-' + s : s)).join(', '))}</b></div>
          <div class="rrow"><span class="fmuted">Looking for</span><b>${esc(want)}</b></div>
          <div class="rrow"><span class="fmuted">Reason</span><b>${esc(ctx.reason || p.extra[0] || 'Travelling with family')}</b></div>
        </div>
        <label class="checkline"><input type="checkbox" id="revOnly" checked/> I only want travellers travelling till ${esc(b.to)} (or beyond)</label>
        <div class="fs-actions"><button type="button" class="fbtn block" id="revGo">Find Matches</button></div>
      </div>`;
    },
    wire(root) {
      root.querySelector('#revGo').addEventListener('click', () => show('search'));
    },
  });

  /* ---------- SEARCH GATE (₹49 to activate matching) ---------- */
  register({
    id: 'search', title: 'Complete Payment',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const f = money();
      const paid = Policy.hasPaidSearch(b.service);
      return `
      ${screenHead('Step 7 · Payment', 'Complete Payment', '')}
      <div class="fs-body">
        <div class="paycard">
          <div style="font-size:28px" aria-hidden="true">🎫</div>
          <div class="big-amount">₹${f.SEARCH_FEE}<span class="fine">for your entire journey (not per request)</span></div>
          <div class="checklist" role="list">
            <div class="ck" role="listitem"><i class="cki">✓</i>Send to multiple travellers</div>
            <div class="ck" role="listitem"><i class="cki">✓</i>Valid till destination (${esc(b.to)})</div>
            <div class="ck" role="listitem"><i class="cki">✓</i>Secure and trusted payments</div>
            <div class="ck" role="listitem"><i class="cki">✓</i><b>₹${f.SEARCH_FEE} wallet credit</b> if no matches found</div>
          </div>
          <div class="paymethods">
            <div class="pm">🟣 UPI (GPay / PhonePe / Paytm)</div>
            <div class="pm">💳 Credit / Debit Card</div>
            <div class="pm">🏦 Net Banking</div>
          </div>
        </div>
        ${offlineNote()}
        <div class="fs-actions">
          ${paid
            ? `<button type="button" class="fbtn block" id="goSearch">Find my matches</button>`
            : `<button type="button" class="fbtn block" id="paySearch" data-online>Pay ₹${f.SEARCH_FEE}</button>`}
        </div>
        <p class="fine" style="text-align:center">By continuing, you agree to our Terms &amp; Privacy Policy.</p>
      </div>`;
    },
    wire(root) {
      const b = ctx.booking; if (!b) { return; }
      const go = () => show('searching');
      const pay = root.querySelector('#paySearch');
      const goBtn = root.querySelector('#goSearch');
      if (goBtn) goBtn.addEventListener('click', go);
      if (pay) pay.addEventListener('click', () => {
        if (!online()) { toast('📴 Payments need a connection.'); return; }
        Metrics.log('checkout_started');
        checkout('search', (res) => {
          Policy.markSearchPaid(b.service, res && (res.id || res.razorpay_payment_id || res.orderID));
          Metrics.log('payment_succeeded');
          toast('🔍 Matching active for this service.');
          go();
        });
      });
    },
  });

  /* ---------- SEARCHING (interstitial) ---------- */
  register({
    id: 'searching', title: 'Finding Matches',
    render() {
      return `
      ${screenHead('Step 6 · Matching', 'Finding Matches', '')}
      <div class="fs-body">
        <div class="search-orb" aria-hidden="true">${modeIcon(ctx.mode)}</div>
        <p class="fmuted" style="text-align:center">Searching travellers on your ${ctx.mode === 'flight' ? 'flight' : ctx.mode === 'bus' ? 'bus' : 'train'}…</p>
        <div class="checklist" role="list">
          <div class="ck" role="listitem"><i class="cki">✓</i>Matching seat preferences</div>
          <div class="ck" role="listitem"><i class="cki">✓</i>Verified travellers only</div>
          <div class="ck" role="listitem"><i class="cki">✓</i>This may take a few seconds</div>
        </div>
        <p class="fine" style="text-align:center;margin-top:12px">💡 More flexible preferences give better matches.</p>
      </div>`;
    },
    wire() { setTimeout(() => { if (currentId === 'searching') show('matches'); }, 900); },
  });

  /* ---------- MATCHES ---------- */
  register({
    id: 'matches', title: 'Potential Matches',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const rows = scoreAll();
      const tab = ctx.matchTab || 'best';
      const list = rows.length ? rows.map((c) => {
        const s = c.s;
        const on = (ctx.matchIds || []).indexOf(s.id) >= 0;
        return `<label class="pickcard ${on ? 'sel' : ''}" role="group" aria-label="${esc(s.name)}, ${c.score} percent match">
          <input type="checkbox" data-pick="${s.id}" ${on ? 'checked' : ''} aria-label="Select ${esc(s.name)}"/>
          <span class="avatar" aria-hidden="true">${esc((s.name || 'T')[0])}</span>
          <span class="pwho"><b>${esc(s.name)}</b><br/><span class="fmuted">${esc(c.why)}</span></span>
          <span class="mscore">${c.score}% match</span>
        </label>`;
      }).join('') : noMatchFlowHTML(b);
      return `
      ${screenHead('Step 8 · Matches', rows.length ? 'Potential Matches' : 'No match yet', rows.length ? 'View travellers (no seat nos.)' : '')}
      <div class="fs-body">
        ${rows.length ? `<div class="mtabs" role="tablist" aria-label="Match filter">
          <button type="button" data-mtab="best" class="${tab === 'best' ? 'on' : ''}" role="tab" aria-selected="${tab === 'best'}">Best Match</button>
          <button type="button" data-mtab="coach" class="${tab === 'coach' ? 'on' : ''}" role="tab" aria-selected="${tab === 'coach'}">Same Coach</button>
          <button type="button" data-mtab="all" class="${tab === 'all' ? 'on' : ''}" role="tab" aria-selected="${tab === 'all'}">All</button>
        </div>` : ''}
        ${list}
        ${rows.length ? `<p class="fine">We'll keep trying even if the top match doesn't respond.</p>
        <div class="fs-actions"><button type="button" class="fbtn block" id="sendSel">Send Requests (${(ctx.matchIds || []).length || rows.length})</button></div>` : ''}
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-mtab]').forEach((t) => t.addEventListener('click', () => { ctx.matchTab = t.dataset.mtab; show('matches'); }));
      const sync = () => {
        const ids = root.querySelectorAll('[data-pick]:checked');
        ctx.matchIds = [...ids].map((x) => x.dataset.pick);
        root.querySelectorAll('.pickcard').forEach((card) => {
          const box = card.querySelector('[data-pick]');
          card.classList.toggle('sel', box && box.checked);
        });
        const btn = root.querySelector('#sendSel');
        if (btn) btn.textContent = `Send Requests (${ctx.matchIds.length || scoreAll().length})`;
      };
      root.querySelectorAll('[data-pick]').forEach((box) => box.addEventListener('change', sync));
      if (!ctx.matchIds || !ctx.matchIds.length) ctx.matchIds = scoreAll().map((c) => c.s.id);
      const send = root.querySelector('#sendSel');
      if (send) send.addEventListener('click', () => {
        const ids = (ctx.matchIds && ctx.matchIds.length ? ctx.matchIds : scoreAll().map((c) => c.s.id));
        ctx.matchId = ids[0] || null;
        ctx.sentCount = ids.length;
        show('requestSent', { matchId: ctx.matchId });
      });
      const share = root.querySelector('#shareInvite');
      if (share) share.addEventListener('click', async () => {
        const link = (typeof buildInvite === 'function' && buildInvite()) || location.href;
        try { await navigator.clipboard.writeText(link); toast('🔗 Invite copied — no names or PNRs inside.'); }
        catch { toast('Copy this page URL to share.'); }
      });
      if (ctx.booking && scoreAll().length === 0) maybeNoMatchCredit();
    },
  });

  function maybeNoMatchCredit() {
    const svc = ctx.booking && ctx.booking.service;
    if (!svc || Policy.wasCredited(svc)) return;
    Wallet.credit(money().SEARCH_FEE, 'No match — search refund');
    Policy.markCredited(svc);
    Metrics.log('nomatch_credit');
  }
  function noMatchFlowHTML(b) {
    return `<div class="fcard fcard--ghost">
      <div class="frow"><b>😶 No match yet</b><span class="fpill">₹${money().SEARCH_FEE} wallet credited</span></div>
      <p class="fmuted">Nobody compatible on this service right now. Your search fee is now <b>wallet credit</b> for a future search — and more travellers join closer to departure.</p>
      <p class="fmuted"><b>Need more matches?</b> Invite your co-passengers.</p>
      <button type="button" class="fbtn ghost block" id="shareInvite">Share journey link</button>
      <p class="fine">Enable Watch service for new-traveller alerts.</p>
    </div>`;
  }

  /* ---------- REQUEST SENT ---------- */
  register({
    id: 'requestSent', title: 'Payment Successful',
    render() {
      const n = ctx.sentCount || 1;
      return `
      ${screenHead('Step 9 · Live', "You're all set!", '')}
      <div class="fs-body">
        <div class="fcard fcard--ok">
          <div class="big-ok" aria-hidden="true">✅</div>
          <h3 style="text-align:center">You're all set!</h3>
          <p class="fmuted" style="text-align:center">We've sent your requests to ${n} traveller${n === 1 ? '' : 's'}. We'll keep trying with more travellers too.</p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-scr="inprogress">View My Requests</button>
          <button type="button" class="fbtn ghost block" data-go-scr="share">Share with Friends</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr)));
      if (ctx.matchId && typeof requestSwap === 'function') requestSwap(ctx.matchId);
      Metrics.log('swap_request_created');
    },
  });

  /* ---------- IN PROGRESS (boards step 11) ---------- */
  register({
    id: 'inprogress', title: 'Requests in Progress',
    render() {
      const b = ctx.booking;
      const n = ctx.sentCount || 1;
      return `
      ${screenHead('Step 10 · Waiting', "We're reaching out to more travellers…", '')}
      <div class="fs-body">
        <div class="prog">
          <div class="pr"><i>✓</i>Sent to ${n} traveller${n === 1 ? '' : 's'}</div>
          <div class="pr"><i>✓</i>We'll keep trying with more</div>
          <div class="pr"><i>✓</i>You'll be notified in real time</div>
          <div class="pr"><i>✓</i>Valid till destination (${esc(b ? b.to : '')})</div>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="waShare">Share on WhatsApp</button>
          <button type="button" class="fbtn ghost block" data-go-scr="trips">Track status</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr)));
      const wa = root.querySelector('#waShare');
      if (wa) wa.addEventListener('click', () => show('share'));
    },
  });

  /* ---------- SHARE (boards step 12) ---------- */
  register({
    id: 'share', title: 'Need More Matches?',
    render() {
      const b = ctx.booking;
      const sel = (ctx.seats || []).map(String);
      const cur = b ? myCoach(b) : null;
      const txt = b ? `Looking for lower berth seats ${b.from} → ${b.to} | ${sel.length || 1} seat${sel.length === 1 ? '' : 's'} ${fmtDate(b.date)} Join me on SwapSeat!` : 'Join me on SwapSeat!';
      return `
      ${screenHead('Step 11 · Share', 'Need more matches?', 'Share your request and get help from fellow travellers.')}
      <div class="fs-body">
        <div class="sharerow" aria-hidden="true"><button type="button" tabindex="-1">💬</button><button type="button" tabindex="-1">𝕏</button><button type="button" tabindex="-1">📘</button><button type="button" tabindex="-1">📸</button></div>
        <div class="rev"><div class="rrow"><span class="fmuted">Message</span></div><p class="fmuted">${esc(txt)}</p></div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="copyLink">Copy Link</button>
          <button type="button" class="fbtn ghost block" data-go-scr="trips">Track status</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr)));
      const cp = root.querySelector('#copyLink');
      if (cp) cp.addEventListener('click', async () => {
        const link = (typeof buildInvite === 'function' && buildInvite()) || location.href;
        try { await navigator.clipboard.writeText(link); toast('🔗 Invite copied — no names or PNRs inside.'); }
        catch { toast('Copy this page URL to share.'); }
      });
    },
  });

  /* ---------- SWAP CONFIRMED ---------- */
  register({
    id: 'confirmed', title: 'Swap Confirmed',
    render() {
      const b = ctx.booking;
      const inc = Bookings.incoming(b);
      const acc = inc.find((x) => x.state === 'accepted');
      const mine = seatLabel(b);
      const theirs = acc ? acc.theirSeat : null;
      return `
      ${screenHead('Confirmed', 'Swap Confirmed', '')}
      <div class="fs-body">
        <div class="fcard fcard--ok">
          <div class="big-ok" aria-hidden="true">🎉</div>
          <h3 style="text-align:center">Great! It's a swap!</h3>
          <p class="fmuted" style="text-align:center">Both travellers have completed the required steps.</p>
          <div class="seatpair" role="group" aria-label="Seat swap">
            <div class="sp"><span class="fmuted">Your seat</span><b>${esc(mine || '—')}</b></div>
            <div class="sp sp--swap" aria-hidden="true">⇄</div>
            <div class="sp"><span class="fmuted">Their seat</span><b>${esc(theirs != null ? theirs : 'revealed at confirmation')}</b></div>
          </div>
          <p class="fine" style="text-align:center">${bookingLine(b)}</p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-scr="track">Track journey</button>
          <button type="button" class="fbtn ghost block" data-go-scr="chat">Open chat</button>
        </div>
      </div>`;
    },
    wire(root) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr))); },
  });


  /* ---------- expose ---------- */
  const api = { register, show, back, ctx, syncEngine, compactGrid, bindSeatGrid,
    bookingLine, seatLabel, myCoach, walletPill, money, esc, screenHead, offlineNote, stepsBar,
    comfortOf, comfortBullets,
    onAccepted: null,
    get current() { return currentId; },
    get screens() { return screens; } };

  /* Boot: wire chrome + land on Home. Called from index.html after every flow
     module has registered its screens. */
  api.boot = function () {
    const backBtn = document.getElementById('fsBack');
    if (backBtn) backBtn.addEventListener('click', () => Flow.back());
    document.querySelectorAll('#flowNav [data-go]').forEach((b) => b.addEventListener('click', () => Flow.show(b.dataset.go)));
    Flow.show('home');
  };
  return api;
})();
