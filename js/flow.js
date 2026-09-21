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
    mode: 'flight', booking: null, seats: [], prefs: null,
    matchId: null, requestId: null, incomingId: null, swap: null, request: null, journey: null,
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
    return b.primary.seatLabel || b.primary.seat;
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
      return `
      <div class="fs-head fs-head--home">
        <div class="brand-row"><span class="brand-mark" aria-hidden="true">${modeIcon('flight')}</span>
          <div><h1>SwapSeat</h1><p class="fmuted">${T('app.tagline')}</p></div></div>
        <p class="tagline">${T('app.promise')}</p>
        <div class="mode-tabs mode-tabs--flow" role="tablist" aria-label="Transport mode">
          ${['train', 'bus', 'flight'].map((m) => `<button type="button" data-mode="${m}" role="tab" class="${ctx.mode === m ? 'on' : ''}" aria-selected="${ctx.mode === m}">${modeIcon(m)}<span>${T('mode.' + m)}</span></button>`).join('')}
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
          <button type="button" class="fbtn block" data-go-scr="booking">${T('home.getstarted')}</button>
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
    id: 'booking', title: 'Find Your Booking',
    render() {
      return `
      ${screenHead('Step 1 · Your booking', 'Find Your Booking', '')}
      <div class="fs-body">
        <div class="ftabs" role="tablist" aria-label="Lookup method">
          <button type="button" class="on" data-tab="pnr" role="tab" aria-selected="true">By PNR</button>
          <button type="button" data-tab="id" role="tab" aria-selected="false">By Booking ID</button>
        </div>
        <div class="fcard">
          <label class="flabel" for="bPnr">PNR / Booking reference</label>
          <input id="bPnr" class="finput" inputmode="text" autocomplete="off"
            placeholder="${ctx.mode === 'flight' ? 'e.g. 6E4F3B' : ctx.mode === 'train' ? 'e.g. 2718284018' : 'e.g. KRT8821'}"/>
          <label class="flabel" for="bSurname" style="margin-top:12px">Passenger surname (as on ticket)</label>
          <input id="bSurname" class="finput" autocomplete="family-name" placeholder="e.g. Mohanty"/>
          <p class="fine">🔒 We read your booking to find your seat. We never store or share your PNR.</p>
          <p class="ferr" id="bErr" role="alert" hidden></p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="bFetch" data-online>Fetch booking</button>
          <button type="button" class="fbtn ghost block" data-go-scr="manual">Add journey manually instead</button>
        </div>
        <p class="safe-note">Secure · Encrypted · On-device. A real booking replaces the demo lookup when a licensed PNR provider is connected.</p>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
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
      return `
      ${screenHead('Step 3 · Your seat', 'Select Your Seat(s)', 'from your booking')}
      <div class="fs-body">
        ${ctx.mode !== 'bus' ? `<div class="cls-tabs" role="tablist" aria-label="Class"><button type="button" class="on" role="tab" aria-selected="true">${esc(b.classCode)}</button></div>` : `<div class="cls-tabs" role="tablist" aria-label="Deck"><button type="button" class="on" role="tab" aria-selected="true">${b.busType === 'sleeper' ? 'Lower deck' : 'Seats'}</button></div>`}
        ${compactGrid(b, sel)}
        <div class="legendrow" role="list">
          <span role="listitem"><i class="lk lk-mine"></i>Your seat</span>
          <span role="listitem"><i class="lk lk-sel"></i>Willing to swap</span>
          <span role="listitem"><i class="lk lk-other"></i>Other seats</span>
        </div>
        <p class="fmuted">Tap the seat(s) you're willing to swap from. Your booked seat is highlighted.</p>
        <p class="fine" id="seatSummary">${sel.length ? 'Swapping from: <b>' + esc(sel.join(', ')) + '</b>' : 'Your booked seat is preselected — tap to add others.'}</p>
        <div class="fs-actions">
          <button type="button" class="fbtn block" id="seatNext">Continue</button>
        </div>
      </div>`;
    },
    wire(root) {
      const b = ctx.booking;
      if (!b) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr))); return; }
      let picked = (Bookings.claims(b.id).length ? Bookings.claims(b.id) : [b.primary.seat]).map(String);
      bindSeatGrid(root, {
        max: 3, initial: picked,
        onChange(sel) {
          picked = sel;
          Bookings.setClaims(b.id, sel);
          const el = root.querySelector('#seatSummary');
          if (el) el.innerHTML = sel.length ? 'Swapping from: <b>' + esc(sel.join(', ')) + '</b>' : 'Tap a seat to swap from.';
        },
      });
      root.querySelector('#seatNext').addEventListener('click', () => {
        if (!picked.length) { toast('Pick the seat(s) you are willing to swap from.'); return; }
        ctx.seats = picked.slice();
        show('prefs');
      });
    },
  });

  /* ---------- PREFERENCES ---------- */
  const PREF_KINDS = { flight: ['Window seat', 'Aisle seat', 'Middle seat'], train: ['Lower berth', 'Side berth', 'Upper berth', 'Same coach'], bus: ['Window seat', 'Aisle seat', 'Lower deck', 'Upper deck'] };
  const PREF_WHERE = { flight: ['Front rows', 'Middle rows', 'Back rows', 'Exit / legroom rows'], train: ['Same bay', 'Same coach', 'Away from toilet', 'Away from door'], bus: ['Front rows', 'Middle rows', 'Back rows'] };
  const PREF_EXTRA = ['Travelling with family', 'Quiet environment', 'More legroom'];
  register({
    id: 'prefs', title: 'Set Your Preferences',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p></div></div>`;
      const p = Bookings.prefs(b.id);
      const kinds = PREF_KINDS[ctx.mode] || PREF_KINDS.flight;
      const where = PREF_WHERE[ctx.mode] || PREF_WHERE.flight;
      const chip = (list, on, group) => list.map((x) => `<button type="button" class="prefchip ${on ? 'on' : ''}" data-g="${group}" data-v="${esc(x)}" aria-pressed="${on}">${esc(x)}</button>`).join('');
      return `
      ${screenHead('Step 4 · Preferences', 'Set Your Preferences', 'What kind of seat are you open to?')}
      <div class="fs-body">
        <div class="fgroup"><div class="fsub">Seat kind</div><div class="chips">${chip(kinds, false, 'kinds')}</div></div>
        <div class="fgroup"><div class="fsub">Preferred location</div><div class="chips">${chip(where, false, 'where')}</div></div>
        <div class="fgroup"><div class="fsub">Other preferences (optional)</div><div class="chips">${chip(PREF_EXTRA, false, 'extra')}</div></div>
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
        state.wantTypes = prefs.kinds.map((k) => k.split(' ')[0]).filter(Boolean);
        Metrics.log('preferences_saved');
        show('search');
      });
    },
  });

  /* ---------- SEARCH GATE (₹49 to activate matching) ---------- */
  register({
    id: 'search', title: 'Search for Matches',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const f = money();
      const paid = Policy.hasPaidSearch(b.service);
      return `
      ${screenHead('Step 5 · Activate matching', 'Search for Matches', '')}
      <div class="fs-body">
        <div class="fcard fcard--search">
          <div class="big-amount">₹${f.SEARCH_FEE}<span class="fine">one-time search fee</span></div>
          <div class="checklist" role="list">
            <div class="ck" role="listitem"><i class="cki">✓</i>We'll find the best matches on your ${ctx.mode === 'flight' ? 'flight' : ctx.mode === 'bus' ? 'bus' : 'train'}</div>
            <div class="ck" role="listitem"><i class="cki">✓</i>Matching seat preferences</div>
            <div class="ck" role="listitem"><i class="cki">✓</i>Verified travellers only</div>
            <div class="ck" role="listitem"><i class="cki">✓</i><b>₹${f.SEARCH_FEE} wallet credit</b> if no matches found</div>
            <div class="ck" role="listitem"><i class="cki">✓</i>No extra payment unless needed</div>
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
    id: 'matches', title: 'Matches Found',
    render() {
      const b = ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const rows = scoreAll();
      const list = rows.length ? rows.map((c) => {
        const s = c.s;
        return `<div class="matchcard" role="group" aria-label="${esc(s.name)}, ${c.score} percent match">
          <div class="mrow"><span class="avatar" aria-hidden="true">${esc((s.name || 'T')[0])}</span>
            <div class="mwho"><b>${esc(s.name)}</b><span class="fmuted">${esc(c.why)}</span></div>
            <span class="mscore">${c.score}%</span></div>
          <p class="fmuted">${modeIcon(s.mode)} wants ${esc((s.want || []).map((w) => (typeof wantLabel !== 'undefined' ? wantLabel(w) : w)).join(', '))}</p>
          <div class="mrow"><span class="mseat">${esc(s.mode === 'flight' ? s.seat : (s.coach + ' · ' + s.seat))}</span></div>
          <button type="button" class="fbtn block" data-match="${s.id}">View &amp; Request</button>
        </div>`;
      }).join('') : noMatchFlowHTML(b);
      return `
      ${screenHead('Step 7 · Matches', rows.length ? 'Matches Found' : 'No match yet', rows.length ? `${rows.length} traveller${rows.length === 1 ? '' : 's'} match your preferences` : '')}
      <div class="fs-body">${list}</div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-match]').forEach((b2) => b2.addEventListener('click', () => { ctx.matchId = b2.dataset.match; show('requestSent', { matchId: b2.dataset.match }); }));
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
    id: 'requestSent', title: 'Request Sent',
    render() {
      const m = ctx.matchId && store.all().find((x) => x.id === ctx.matchId);
      return `
      ${screenHead('Step 8 · Sent', 'Request Sent', '')}
      <div class="fs-body">
        <div class="fcard fcard--ok">
          <div class="big-ok" aria-hidden="true">📨</div>
          <h3 style="text-align:center">Your request is sent!</h3>
          <p class="fmuted" style="text-align:center">${m ? esc(m.name) : 'The traveller'} will be notified instantly.</p>
        </div>
        <div class="checklist" role="list">
          <div class="ck" role="listitem"><i class="cki">✓</i>You can track the status in My Trips</div>
          <div class="ck" role="listitem"><i class="cki">✓</i>We'll notify you instantly</div>
          <div class="ck" role="listitem"><i class="cki">✓</i>If they accept and haven't paid yet, you'll be requested to pay ₹${money().ONE_SIDED_SWAP_FEE}</div>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-scr="trips">Go to My Requests</button>
          <button type="button" class="fbtn ghost block" data-go-scr="matches">Back to matches</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => show(x.dataset.goScr)));
      if (ctx.matchId && typeof requestSwap === 'function') requestSwap(ctx.matchId);
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
