/* SeatSwap screens 1 — requester: choices, matches, manage, updates,
   onboard board, groups, invites, share, train page. Registered into
   SeatSwapApp.screen(). Sending is always free; pay happens only after accept. */
(() => {
  const H = SeatSwapApp.helpers;
  const { esc, Art, innerHead, homeHead, footer, fmtDate, bindBack } = H;
  const T = SeatSwapApp.T;
  const E = () => SeatSwapEngine;
  const CFG = (typeof SeatSwapConfig !== 'undefined' ? SeatSwapConfig : {});

  function needAuth(here) {
    if (!E().authed()) { SeatSwapAuth.requireAuth(here); return true; }
    return false;
  }
  function myTrip(id) {
    const t = SeatSwapStore.get(id);
    if (!t) { location.hash = '#/'; return null; }
    return t;
  }
  function berthOpts(cls) {
    return SeatSwapPNR.isChair(cls)
      ? [['WINDOW', 'Window'], ['AISLE', 'Aisle'], ['MIDDLE_SEAT', 'Middle']]
      : [['LB', 'Lower'], ['MB', 'Middle'], ['UB', 'Upper'], ['SL', 'Side Lower'], ['SU', 'Side Upper']];
  }
  function seedLabel(s, cls) { return `${s.coach} · ${SeatSwapData.berthLabel(s.berth_type, cls)}`; }

  /* ---------- CHOICES (new + edit) ---------- */
  SeatSwapApp.screen('choices', {
    render(r) {
      /* Signed-out users can rank choices (rule 8: auth only at first send).
         A stashed draft is completed here right after login. */
      if (!r.req && r.resume && E().authed()) {
        try {
          const draft = JSON.parse(sessionStorage.getItem('seatswap_draft_v1') || 'null');
          if (draft && draft.tripId) {
            sessionStorage.removeItem('seatswap_draft_v1');
            const made = E().newRequest({ tripId: draft.tripId, choices: draft.choices, sameCoach: draft.sameCoach, keepTogether: draft.keepTogether, reason: draft.reason });
            location.hash = '#/request/' + made.id + '/matches';
            return { html: '', tab: 'home' };
          }
        } catch {}
      }
      const req = r.req ? E().getRequest(r.req) : null;
      const trip = myTrip(req ? req.booking_id : r.trip);
      if (!trip) return { html: '', tab: 'home' };
      const pre = req ? { choices: req.choices.slice(), same: req.same_coach, keep: req.keep_together, reason: req.reason }
        : { choices: [], same: true, keep: false, reason: '' };
      const opts = berthOpts(trip.class);
      const reasons = [T('req.r1'), T('req.r2'), T('req.r3'), T('req.r4'), T('req.r5'), T('req.r6')];
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('req.title'))}</h1>
        <p class="subtitle">${esc(trip.train_no)} · ${esc(trip.from_code || '')} → ${esc(trip.to_code || '')} · ${esc(fmtDate(trip.journey_date))}</p>
        <div class="label">${esc(T('req.rank'))}</div>
        <div class="chips" id="chRank">${opts.map(([v, l]) =>
          `<button type="button" class="chipbtn" data-b="${v}"><span class="rank" data-rk></span>${esc(l)}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" id="chSame" ${pre.same ? 'checked' : ''} /><span>${esc(T('req.sameCoach'))}</span></label>
        ${trip.passengers.length > 1 ? `<label class="check"><input type="checkbox" id="chKeep" ${pre.keep ? 'checked' : ''} /><span>${esc(T('req.keepTogether'))}</span></label>` : ''}
        <div class="label">${esc(T('req.reason'))}</div>
        <div class="chips" id="chReason">${reasons.map((x) =>
          `<button type="button" class="chipbtn" data-rsn="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <input id="chNote" class="input" maxlength="280" value="${esc(pre.reason)}" placeholder="${esc(T('req.notePh'))}" />
        <p class="err" id="chErr" role="alert" hidden></p>
        <button type="button" class="btn" id="chGo">${esc(T('req.continue'))}</button>
        <p class="fine center">${esc(T('reqm.free'))}</p>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const req = r.req ? E().getRequest(r.req) : null;
      const trip = SeatSwapStore.get(req ? req.booking_id : r.trip);
      let picks = req ? req.choices.slice() : (r.want ? [r.want] : []);
      let reason = req ? req.reason : '';
      const paint = () => {
        el.querySelectorAll('#chRank .chipbtn').forEach((b) => {
          const i = picks.indexOf(b.dataset.b);
          b.classList.toggle('on', i >= 0);
          b.querySelector('[data-rk]').textContent = i >= 0 ? (i + 1) + ' · ' : '';
        });
        el.querySelectorAll('#chReason .chipbtn').forEach((b) => {
          const on = reason === b.dataset.rsn;
          b.classList.toggle('on', on);
        });
      };
      el.querySelectorAll('#chRank .chipbtn').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.b;
        const at = picks.indexOf(v);
        if (at >= 0) picks.splice(at, 1);
        else if (picks.length < 3) picks.push(v);
        paint();
      }));
      el.querySelectorAll('#chReason .chipbtn').forEach((b) => b.addEventListener('click', () => {
        reason = (reason === b.dataset.rsn) ? '' : b.dataset.rsn;
        el.querySelector('#chNote').value = reason;
        paint();
      }));
      el.querySelector('#chNote').addEventListener('input', (e) => { reason = e.target.value; });
      paint();
      el.querySelector('#chGo').addEventListener('click', () => {
        const err = el.querySelector('#chErr');
        if (!picks.length) { err.textContent = T('req.needChoices'); err.hidden = false; return; }
        const note = el.querySelector('#chNote').value.trim() || reason;
        const same = el.querySelector('#chSame').checked;
        const keep = el.querySelector('#chKeep') ? el.querySelector('#chKeep').checked : false;
        /* Rule 8: sign-in happens at first send, not before. Stash the draft,
           sign in, then auto-complete on return (see render resume above). */
        if (!E().authed() && !req) {
          try { sessionStorage.setItem('seatswap_draft_v1', JSON.stringify({ tripId: trip.id, choices: picks, sameCoach: same, keepTogether: keep, reason: note })); } catch {}
          SeatSwapAuth.requireAuth('#/request/new?trip=' + encodeURIComponent(trip.id) + '&resume=1');
          return;
        }
        try {
          if (req) {
            E().updateRequest(req.id, { choices: picks, sameCoach: same, keepTogether: keep, reason: note });
            location.hash = '#/request/' + req.id + '/matches';
          } else {
            const made = E().newRequest({ tripId: trip.id, choices: picks, sameCoach: same, keepTogether: keep, reason: note });
            location.hash = '#/request/' + made.id + '/matches';
          }
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    },
  });

  /* ---------- MATCHES ---------- */
  function matchRows(req, trip, onlySame) {
    const prefs = (() => { try { return JSON.parse(localStorage.getItem('seatswap_prefs_v1') || '{}'); } catch { return {}; } })();
    const seeds = SeatSwapDemo.seedsForTrip(trip.id);
    return SeatSwapData.scoreMatches(req, trip, seeds, {
      blocked: E().blockedIds(E().meId()),
      womenOnly: prefs.women_only,
    }).filter((row) => !onlySame || row.seed.coach === (trip.passengers[0] || {}).coach);
  }
  SeatSwapApp.screen('matches', {
    render(r) {
      let req = null;
      try { req = E().getRequest(r.id); } catch { location.hash = '#/'; return { html: '', tab: 'home' }; }
      const trip = myTrip(req.booking_id);
      if (!trip) return { html: '', tab: 'home' };
      const rows = matchRows(req, trip, false);
      const mine = trip.passengers[0] || {};
      const list = rows.map(({ seed: s, rank, score }) => `
        <label class="matchrow"><input type="checkbox" data-pick="${s.id}" checked style="width:22px;height:22px;accent-color:var(--primary)" />
          <span class="avatar">${esc(s.first_name[0])}</span>
          <span class="mwho"><b>${esc(s.first_name)} ${esc(s.last_initial)}.</b>
          <small>${esc(SeatSwapData.berthLabel(s.berth_type, trip.class))} · ${esc(s.coach)} · ${rank === 0 ? esc(T('req.first')) : rank === 1 ? esc(T('req.second')) : esc(T('req.third'))}</small>
          <small>${esc(T('trip.berthMasked'))} · ✓ Google verified</small></span>
          <span class="mscore">${score}%</span></label>`).join('');
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(rows.length ? T('match.title') : T('match.nomatchT', { train: trip.train_no }))}</h1>
        ${rows.length ? `<p class="subtitle">${esc(T('match.sub'))}</p>${list}
          <button type="button" class="btn" id="sendBtn">${esc(T('match.sendFree', { n: rows.length }))}</button>
          <p class="fine center">${esc(T('reqm.free'))}</p>`
          : `${Art.scene}
          <p class="subtitle center">${esc(T('match.nomatchB'))}</p>
          <div class="sharerow" id="shrRow"></div>
          <button type="button" class="btn btn--ghost" id="copyCoach">${esc(T('match.copyLink'))}</button>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const req = E().getRequest(r.id);
      const trip = SeatSwapStore.get(req.booking_id);
      const send = el.querySelector('#sendBtn');
      if (send) {
        const sync = () => {
          const n = el.querySelectorAll('[data-pick]:checked').length;
          send.textContent = T('match.sendFree', { n: n || matchRows(req, trip, false).length });
        };
        el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('change', sync));
        send.addEventListener('click', () => {
          /* Rule 8: the send is the auth moment. After login the user lands
             back here and taps send again — sending itself stays free. */
          if (!E().authed()) { SeatSwapAuth.requireAuth(location.hash); return; }
          const ids = [...el.querySelectorAll('[data-pick]:checked')].map((b) => b.dataset.pick);
          try {
            const made = E().sendOffers(req.id, ids.length ? ids : matchRows(req, trip, false).map((x) => x.seed.id));
            made.forEach((o, i) => E().setOfferRank(o.id, (matchRows(req, trip, false).find((x) => x.seed.id === o.acceptor_id) || { rank: 0 }).rank));
            SeatSwapDemo.onOffersSent(req.id);
            toast(T('match.sent'));
            location.hash = '#/request/' + req.id;
          } catch (e) { toast(e.message); }
        });
      }
      const shr = el.querySelector('#shrRow');
      if (shr) paintShare(shr, 'board', trip.id, { train: trip.train_no });
      const cp = el.querySelector('#copyCoach');
      if (cp) cp.addEventListener('click', () => copyInvite('board', trip.id));
    },
  });

  /* ---------- REQUEST manage ---------- */
  SeatSwapApp.screen('request', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'home' };
      const req = E().getRequest(r.id);
      const trip = myTrip(req.booking_id);
      if (!trip) return { html: '', tab: 'home' };
      const mine = trip.passengers[0] || {};
      const accepted = E().offersFor(req.id).filter((o) => o.status === 'accepted');
      const sent = E().offersFor(req.id).filter((o) => ['sent', 'accepted'].includes(o.status)).length;
      let state = '';
      if (req.status === 'accepted_awaiting_payment' && accepted[0]) {
        const nm = SeatSwapDemo.seedName(accepted[0].acceptor_id, trip.id);
        state = `<section class="card card--green center"><b style="font-size:18px">${esc(T('reqm.acceptedT', { name: nm }))}</b>
          <p class="subtitle">${esc(T('reqm.acceptedB'))}</p>
          <a class="btn" href="#/pay/${req.id}">${esc(T('reqm.payNow'))}</a></section>`;
      } else if (req.status === 'locked' || req.status === 'confirmed') {
        state = `<a class="btn" href="#/swaps/${req.id}">${esc(T('reqm.lockedB'))}</a>`;
      } else if (req.status === 'searching' && sent === 0) {
        state = `${Art.scene}<h2 class="h-section center">${esc(T('reqm.noreplyT', { train: trip.train_no }))}</h2>
          <div class="sharerow" id="shrRow"></div>
          <a class="btn btn--ghost" href="#/request/new?trip=${trip.id}&req=${req.id}">${esc(T('reqm.tryOther'))}</a>`;
      }
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('reqm.title'))}</h1>
        <section class="card"><div class="iconcard"><span class="tile">${Art.train}</span>
          <span><b>${esc(req.choices.map((c) => SeatSwapPNR.berthLabel(c, trip.class)).join(' / ') || '—')} · ${esc(mine.coach || trip.class)}</b><br/>
          <span class="pill">${esc(req.paused ? T('reqm.paused') : T('reqm.waiting'))}</span></span></div></section>
        ${state}
        <section class="menu">
          <a class="mrow" href="#/request/new?trip=${trip.id}&req=${req.id}"><span class="mico">${Art.swapArrows}</span><span class="mlab">${esc(T('reqm.editChoices'))}</span>${Art.chevR}</a>
          <button type="button" class="mrow" id="pauseBtn"><span class="mico">${Art.bell}</span><span class="mlab">${esc(req.paused ? T('reqm.resume') : T('reqm.pause'))}</span>${Art.chevR}</button>
          <button type="button" class="mrow mrow--danger" id="wdBtn"><span class="mico">✕</span><span class="mlab">${esc(T('reqm.withdraw'))}</span>${Art.chevR}</button>
        </section>
        <section class="card card--green"><div class="iconcard"><span class="checkdot">i</span>
          <span>${esc(T('reqm.free'))}</span></div></section>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const req = E().getRequest(r.id);
      const shr = el.querySelector('#shrRow');
      if (shr) { const trip = SeatSwapStore.get(req.booking_id); paintShare(shr, 'board', trip.id, { train: trip.train_no }); }
      const pb = el.querySelector('#pauseBtn');
      if (pb) pb.addEventListener('click', () => {
        E().updateRequest(req.id, { paused: !req.paused });
        SeatSwapApp.render();
      });
      const wd = el.querySelector('#wdBtn');
      if (wd) wd.addEventListener('click', () => {
        if (!window.confirm(T('reqm.withdraw') + '?')) return;
        E().withdrawRequest(req.id);
        toast(T('reqm.withdrawn'));
        location.hash = '#/swaps';
      });
    },
  });

  /* ---------- TRAIN page upgrade ---------- */

  /* ---------- UPDATES ---------- */
  SeatSwapApp.screen('updates', {
    render() {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const list = E().myNotifs();
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('updates.title'))}</h1>
        ${list.length ? list.map((n) => `<button type="button" class="updrow ${n.read_at ? '' : 'unread'}" data-n="${n.id}">
          <span style="flex:1"><b>${esc(n.title)}</b><small>${esc(n.body)}</small>
          <time>${esc(new Date(n.created_at).toLocaleString())}</time></span>${Art.chevR}</button>`).join('')
          : `<section class="card card--ghost center"><p>${esc(T('updates.empty'))}</p></section>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el) {
      bindBack(el, '#/swaps');
      el.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => {
        const n = E().myNotifs().find((x) => x.id === b.dataset.n);
        E().markRead(b.dataset.n);
        location.hash = (n && n.link) || '#/swaps';
      }));
    },
  });

  /* ---------- ONBOARD board ---------- */
  SeatSwapApp.screen('onboard', {
    render(r) {
      const trip = myTrip(r.id);
      if (!trip) return { html: '', tab: 'home' };
      const mine = trip.passengers[0] || {};
      const isToday = trip.journey_date === new Date().toISOString().slice(0, 10);
      const seeds = SeatSwapDemo.seedsForTrip(trip.id).filter((s) => !E().blockedIds(E().meId()).includes(s.id));
      const myReq = E().authed() ? E().myRequests().find((x) => x.booking_id === trip.id && ['searching', 'accepted_awaiting_payment'].includes(x.status)) : null;
      return {
        tab: 'home',
        html: `${innerHead('bell')}<main class="body">
        <h1 class="h-title" style="margin-top:8px">${esc(T('onb.title'))}</h1>
        <p><span class="pill pill--live"><span class="dot"></span> ${esc(T('onb.live', { to: trip.to_code || '' }))}</span></p>
        <p class="subtitle">${esc(T('trip.coach', { coach: mine.coach || trip.class }))} · ${esc(trip.train_no)}</p>
        ${isToday ? `<section class="card center">${Art.doc}
          <b style="color:var(--accent);font-size:20px">${esc(T('onb.chartT'))}</b>
          <h2 class="h-section">${esc(T('onb.chartB', { n: seeds.length }))}</h2></section>` : ''}
        ${seeds.map((s) => `<div class="card"><div class="iconcard">
          <span class="avatar">${esc(s.first_name[0])}</span>
          <span style="flex:1"><b>${esc(s.first_name)} ${esc(s.last_initial)}.</b><br/>
          <small style="color:var(--muted)">${esc(T('onb.wantsGives', { w: SeatSwapData.berthLabel((s.wants[0] || 'LB'), trip.class), g: SeatSwapData.berthLabel(s.berth_type, trip.class) }))}</small><br/>
          <small style="color:var(--muted)">${esc(T('trip.berthMasked'))}</small></span>
          <button type="button" class="minibtn minibtn--go" data-swap="${s.id}">${esc(T('onb.swap'))}</button></div></div>`).join('')}
        <button type="button" class="btn ${trip.open_to_swap ? '' : 'btn--ghost'}" id="openToggle">
          ${esc(trip.open_to_swap ? T('trip.openOn') : T('trip.open'))}</button>
        ${myReq ? `<a class="btn btn--ghost" href="#/request/${myReq.id}">${esc(T('reqm.title'))}</a>`
          : `<a class="btn" href="#/request/new?trip=${trip.id}">${esc(T('trip.ask'))}</a>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const trip = SeatSwapStore.get(r.id);
      el.querySelectorAll('[data-swap]').forEach((b) => b.addEventListener('click', () => {
        if (needAuth(location.hash)) return;
        const s = SeatSwapDemo.seedOf(b.dataset.swap, trip.id);
        location.hash = '#/request/new?trip=' + trip.id + (s ? '&want=' + s.berth_type : '');
      }));
      const ot = el.querySelector('#openToggle');
      if (ot) ot.addEventListener('click', () => {
        const t = SeatSwapStore.get(r.id);
        SeatSwapStore.setOpen(r.id, !(t && t.open_to_swap));
        toast(t && t.open_to_swap ? T('trip.openOff') : T('trip.openOn'));
        SeatSwapApp.render();
      });
    },
  });

  /* ---------- GROUPS ---------- */
  SeatSwapApp.screen('groups', {
    render() {
      if (needAuth(location.hash)) return { html: '', tab: 'home' };
      const gs = E().myGroups();
      return {
        tab: 'home',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('grp.title'))}</h1>
        ${gs.length ? gs.map((g) => `<a class="card banner" href="#/groups/${g.id}" style="text-decoration:none;color:inherit">
          <span class="tile">${Art.people}</span><span class="btxt" style="flex:1"><b>${esc(g.name)}</b></span>${Art.chevR}</a>`).join('')
          : `<section class="card card--ghost center"><p>${esc(T('grp.empty'))}</p></section>`}
        <form id="newGroup" class="card"><label class="label" for="gName">${esc(T('grp.new'))}</label>
          <input id="gName" class="input" maxlength="60" placeholder="${esc(T('grp.namePh'))}" />
          <button class="btn" type="submit">${esc(T('grp.create'))}</button></form>
        ${footer(false)}</main>`,
      };
    },
    wire(el) {
      bindBack(el);
      el.querySelector('#newGroup').addEventListener('submit', (e) => {
        e.preventDefault();
        const g = E().newGroup(el.querySelector('#gName').value);
        location.hash = '#/groups/' + g.id;
      });
    },
  });
  SeatSwapApp.screen('group', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'home' };
      const g = E().db().groups[r.id];
      if (!g) return { html: '', tab: 'home' };
      const members = E().groupTrips(r.id);
      const mine = SeatSwapStore.trips().filter((t) => !members.find((m) => m.id === t.id));
      return {
        tab: 'home',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(g.name)}</h1>
        ${members.map((t) => { const p = t.passengers[0] || {}; return `<div class="card"><div class="iconcard">
          <span class="tripthumb">${Art.train}</span>
          <span style="flex:1"><b>${esc(t.train_no)} · ${esc(t.from_code || '')}→${esc(t.to_code || '')}</b><br/>
          <small style="color:var(--muted)">${esc(p.coach || '')} · ${esc(SeatSwapPNR.berthLabel(p.berth_type, t.class))}</small></span></div></div>`; }).join('')}
        ${mine.length ? `<form id="addMem" class="card"><label class="label" for="mTrip">${esc(T('grp.addTrip'))}</label>
          <select id="mTrip" class="input">${mine.map((t) => `<option value="${t.id}">${esc(t.train_no)} · ${esc(t.pnr_last4)}</option>`).join('')}</select>
          <button class="btn" type="submit">${esc(T('grp.addTrip'))}</button></form>` : ''}
        <a class="btn" href="#/groups/${g.id}/plan">${esc(T('grp.plan'))}</a>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const f = el.querySelector('#addMem');
      if (f) f.addEventListener('submit', (e) => {
        e.preventDefault();
        E().addGroupMember(r.id, el.querySelector('#mTrip').value);
        SeatSwapApp.render();
      });
    },
  });
  SeatSwapApp.screen('groupplan', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'home' };
      const g = E().db().groups[r.id];
      if (!g) return { html: '', tab: 'home' };
      const members = E().groupTrips(r.id);
      const rows = members.map((t) => {
        const fakeReq = { choices: ['LB', 'SL', 'MB'], same_coach: false, keep_together: true };
        const n = SeatSwapData.scoreMatches(fakeReq, t, SeatSwapDemo.seedsForTrip(t.id), {}).length;
        return { t, n };
      });
      const together = rows.filter((x) => x.n > 0).length;
      return {
        tab: 'home',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('grp.plan'))}</h1>
        <section class="card card--green center"><b style="font-size:20px">${esc(T('grp.together', { a: together, b: members.length }))}</b></section>
        ${rows.map(({ t, n }) => { const p = t.passengers[0] || {}; return `<div class="card"><b>${esc(t.train_no)} · ${esc(p.coach || '')}</b>
          <p class="subtitle">${esc(T('trip.peopleWant', { n }))}</p></div>`; }).join('')}
        <p class="fine center">${esc(T('grp.price'))}</p>
        ${footer(false)}</main>`,
      };
    },
    wire(el) { bindBack(el); },
  });

  /* ---------- INVITE landing (accept from a link) ---------- */
  SeatSwapApp.screen('invite', {
    render(r) {
      let inv = null;
      try { inv = E().resolveInvite(r.code); } catch { inv = null; }
      if (!inv) return { tab: 'home', html: `${innerHead()}<main class="body"><section class="card card--ghost center"><p>${esc(T('inv.bad'))}</p></section>${footer(false)}</main>` };
      if (inv.type === 'board') {
        location.hash = '#/onboard/' + inv.ref_id;
        return { html: '', tab: 'home' };
      }
      // request link -> ensure my own offer, then incoming screen
      if (needAuth(location.hash)) return { html: '', tab: 'home' };
      const d = E().db();
      let offer = Object.values(d.offers).find((o) => o.request_id === inv.ref_id && o.acceptor_id === E().meId() && ['sent', 'accepted'].includes(o.status));
      if (!offer) {
        const req = E().getRequest(inv.ref_id);
        const trip = SeatSwapStore.get(req.booking_id);
        offer = { id: 'o-' + Date.now().toString(36), request_id: req.id, acceptor_id: E().meId(), acceptor_booking_id: null, acceptor_passenger_id: null, matched_choice_rank: 0, status: 'sent', created_at: new Date().toISOString(), responded_at: null };
        d.offers[offer.id] = offer;
        E().notify(d, E().meId(), 'new_request', T('incoming.title'), trip ? trip.train_no : '', '#/incoming/' + offer.id);
        try { localStorage.setItem('seatswap_db_v1', JSON.stringify(d)); } catch {}
      }
      location.hash = '#/incoming/' + offer.id;
      return { html: '', tab: 'home' };
    },
    wire() {},
  });

  /* ---------- share helpers ---------- */
  function inviteLink(type, refId) {
    const code = E().createInvite(type, refId, {});
    return location.origin + location.pathname + '#/s/' + code;
  }
  function paintShare(el, type, refId, meta) {
    const link = inviteLink(type, refId);
    el.dataset.link = link;
    const btn = (id, label) => `<button type="button" class="sharebtn" data-sh="${id}">${esc(label)}</button>`;
    el.innerHTML = btn('wa', T('shr.wa')) + btn('tg', T('shr.tg')) + btn('sms', T('shr.sms')) + btn('copy', T('shr.copy')) + btn('more', T('shr.more'));
    const text = (meta && meta.train ? T('match.nomatchT', { train: meta.train }) + '. ' : '') + link;
    el.querySelectorAll('[data-sh]').forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.sh;
      if (k === 'copy') { await copyText(link); toast(T('match.copied')); }
      else if (k === 'wa') openShare('https://wa.me/?text=' + encodeURIComponent(text));
      else if (k === 'tg') openShare('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text));
      else if (k === 'sms') openShare('sms:?&body=' + encodeURIComponent(text));
      else if (navigator.share) { try { await navigator.share({ title: 'SeatSwap', text, url: link }); } catch {} }
      else { await copyText(link); toast(T('match.copied')); }
      try { SeatSwapStore.logActivity('share_clicked', { platform: k }); } catch {}
    }));
    // QR (online only)
    if (navigator.onLine !== false) {
      const qr = document.createElement('div');
      qr.className = 'qrbox';
      const img = document.createElement('img');
      img.alt = 'QR';
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(link);
      qr.appendChild(img);
      el.appendChild(qr);
    }
  }
  function copyInvite(type, refId) {
    copyText(inviteLink(type, refId)).then(() => toast(T('match.copied'))).catch(() => toast(T('match.copied')));
  }
  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = s; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
  }
  function openShare(url) { try { window.open(url, '_blank', 'noopener'); } catch { location.href = url; } }

  /* ---------- end screens 1 ---------- */

  // expose for other screen files
  SeatSwapApp.share = { paintShare, copyInvite, inviteLink };
})();
