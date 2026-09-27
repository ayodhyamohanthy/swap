/* SeatSwap screens 2 — acceptor, payments, locked swap (chat, meet,
   summary, confirm, done, share, rate). Pay only after acceptance; the swap
   locks the moment payment succeeds. */
(() => {
  const H = SeatSwapApp.helpers;
  const { esc, Art, innerHead, footer, fmtDate, bindBack } = H;
  const T = SeatSwapApp.T;
  const E = () => SeatSwapEngine;
  const P = () => SeatSwapPay;

  function needAuth(here) {
    if (!E().authed()) { SeatSwapAuth.requireAuth(here); return true; }
    return false;
  }
  function reqTrip(req) { return SeatSwapStore.get(req.booking_id); }
  function seedLine(offer, trip) {
    const s = SeatSwapDemo.seedOf(offer.acceptor_id, trip.id);
    if (!s) return null;
    return s;
  }

  /* ---------- INCOMING (acceptor) ---------- */
  /** Display name of the requester: users-table name when shared, else generic. */
  function incomingName(req) {
    const ruser = ((E().db().users) || {})[req.requester_id] || {};
    const full = [ruser.first_name, ruser.last_initial ? ruser.last_initial + '.' : ''].filter(Boolean).join(' ');
    return full || T('incoming.requester');
  }
  SeatSwapApp.screen('incoming', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const o = E().getOffer(r.id);
      const req = E().getRequest(o.request_id);
      /* "Yours" is MY berth from MY trip (the acceptor side) — never the
         requester's trip, which is not on this device. Their exact berth is
         unknown until the backend lands, so it stays masked (rule 13). */
      const myT = SeatSwapStore.get(o.acceptor_booking_id);
      const mine = (myT ? myT.passengers[0] : null) || {};
      const yours = mine.berth_type && myT ? SeatSwapPNR.berthLabel(mine.berth_type, myT.class) : null;
      const accName = incomingName(req);
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('incoming.title'))}</h1>
        <section class="card center">
          <span class="avatar">${esc((req.reason || 'S').slice(0, 1))}</span>
          <p><b>${esc(T('incoming.giveGet', { yours: yours || T('trip.berthMasked'), theirs: T('trip.berthMasked') }))}</b></p>
          ${req.reason ? `<p class="subtitle">“${esc(req.reason)}”</p>` : ''}
          <p class="pill">${esc(T('incoming.earn'))}</p>
          ${o.status !== 'sent' ? `<p class="subtitle">${esc(T('incoming.' + (o.status === 'accepted' ? 'waiting' : 'closed')))}</p>` : ''}
        </section>
        ${o.status === 'sent' ? `<button type="button" class="btn" id="accBtn">${esc(T('incoming.accept'))}</button>
        <button type="button" class="btn btn--ghost" id="decBtn">${esc(T('incoming.decline'))}</button>` : ''}
        ${o.status === 'accepted' ? `<section class="card card--green center"><p>${esc(T('incoming.waiting', { name: accName }))}</p>
          <button type="button" class="linklike" id="backoutBtn">${esc(T('incoming.backout'))}</button></section>` : ''}
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const acc = el.querySelector('#accBtn');
      if (acc) acc.addEventListener('click', () => {
        E().acceptOffer(r.id);
        try {
          const req = E().getRequest(E().getOffer(r.id).request_id);
          toast(T('incoming.waiting', { name: incomingName(req) }));
        } catch { toast(T('incoming.waiting', { name: T('incoming.requester') })); }
        SeatSwapApp.render();
      });
      const dec = el.querySelector('#decBtn');
      if (dec) dec.addEventListener('click', () => { E().declineOffer(r.id); location.hash = '#/swaps'; });
      const bo = el.querySelector('#backoutBtn');
      if (bo) bo.addEventListener('click', () => { E().backOutOffer(r.id); location.hash = '#/swaps'; });
    },
  });

  /* ---------- PAY: someone said yes ---------- */
  function reqGuard(r) {
    const req = E().getRequest(r.id);
    if (req.requester_id !== E().meId()) throw new Error('not_yours');
    return req;
  }
  SeatSwapApp.screen('pay', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'home' };
      const req = reqGuard(r);
      if (req.status === 'locked' || req.status === 'confirmed') { location.hash = '#/swaps/' + req.id; return { html: '', tab: 'home' }; }
      const trip = reqTrip(req);
      const accepted = E().offersFor(req.id).filter((o) => o.status === 'accepted');
      const first = accepted[0];
      const nm = first ? SeatSwapDemo.seedName(first.acceptor_id, trip.id) : '';
      const rank = first ? (first.matched_choice_rank || 0) : 0;
      const bal = E().myBalance();
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <div class="paybox"><div style="font-size:30px" aria-hidden="true">🎉</div>
          <h1 class="h-title">${esc(T('pay.saidYes', { name: nm }))}</h1>
          ${rank > 0 ? `<p><span class="pill">${esc(T('pay.rank' + (rank + 1)))}</span></p>
          <p class="subtitle">${esc(T('pay.rankAsk'))}</p>` : ''}
          <div class="big">${esc(P().inr(9900))}</div>
          <div style="text-align:left;margin-top:10px">
            <div class="bkrow"><span>${esc(T('pay.fee'))}</span><b>${esc(P().inr(4900))}</b></div>
            <div class="bkrow"><span>${esc(T('pay.thanks', { name: nm }))}</span><b>${esc(P().inr(5000))}</b></div>
            ${bal > 0 ? `<div class="bkrow"><span>${esc(T('pay.creditLine', { amount: (bal / 100).toFixed(0) }))}</span><b>−${esc(P().inr(Math.min(bal, 9900)))}</b></div>` : ''}
          </div>
        </div>
        <p class="fine center">${esc(T('pay.noSwap'))}</p>
        <p class="fine center">${esc(T('pay.lockNote'))}</p>
        ${rank > 0 ? `<button type="button" class="btn btn--ghost" id="keepWaiting">${esc(T('pay.keepWaiting'))}</button>` : ''}
        <a class="btn" href="#/pay/${req.id}/method">${esc(T('pay.continue'))}</a>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const kw = el.querySelector('#keepWaiting');
      if (kw) kw.addEventListener('click', () => { location.hash = '#/request/' + r.id; });
    },
  });

  /* ---------- PAY method ---------- */
  SeatSwapApp.screen('paymethod', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'home' };
      const req = reqGuard(r);
      const bal = E().myBalance();
      const due = Math.max(0, 9900 - bal);
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('paymethod.title'))}</h1>
        <div class="paybox"><div class="big">${esc(P().inr(due))}</div>
          <small style="color:var(--muted)">${esc(T('pay.noSwap'))}</small></div>
        ${due <= 0 ? `<button type="button" class="btn" id="payCredit">${esc(T('paymethod.payCredit'))}</button>`
          : P().methods().map((m) => `<button type="button" class="pmrow" data-m="${m.id}">
            <span class="pmic">${esc(m.icon)}</span><span style="flex:1"><b>${esc(m.title)}</b><small>${esc(m.sub)}</small></span><span class="chev">›</span></button>`).join('') +
          `<button type="button" class="linklike linklike--center" id="payPal">${esc(T('paymethod.paypal'))}</button>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const go = (provider) => {
        try {
          const p = E().createPayment(r.id, { provider, useCredit: true });
          if (p.status === 'paid') { location.hash = '#/pay/' + r.id + '/done'; return; }
          if (provider === 'paypal') location.hash = '#/pay/' + r.id + '/paypal?pid=' + p.id;
          else { sessionStorage.setItem('seatswap_pid', p.id); location.hash = '#/pay/' + r.id + '/upi'; }
        } catch (e) { toast(e.message); }
      };
      el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => go('demo')));
      const pp = el.querySelector('#payPal');
      if (pp) pp.addEventListener('click', () => go('paypal'));
      const pc = el.querySelector('#payCredit');
      if (pc) pc.addEventListener('click', () => go('credit'));
    },
  });

  /* ---------- UPI waiting (demo bank) ---------- */
  SeatSwapApp.screen('payupi', {
    render(r) {
      const pid = sessionStorage.getItem('seatswap_pid');
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <div class="paybox"><div style="font-size:34px" aria-hidden="true">◉</div>
          <h1 class="h-title">${esc(T('payupi.title'))}</h1>
          <p class="subtitle">${esc(T('payupi.body'))}</p>
          <p class="pill" id="upiState">${esc(T('payupi.waiting'))}</p></div>
        <div class="sharerow">
          <button type="button" class="sharebtn" data-sim="auto">${esc(T('payupi.simOk'))}</button>
          <button type="button" class="sharebtn" data-sim="pending">${esc(T('payupi.simPending'))}</button>
          <button type="button" class="sharebtn" data-sim="fail">${esc(T('payupi.simFail'))}</button>
        </div>
        <p class="fine">${esc(T('payupi.demo'))}</p>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const pid = sessionStorage.getItem('seatswap_pid');
      const done = (st) => {
        if (st === 'paid') location.hash = '#/pay/' + r.id + '/done';
        else if (st === 'failed' || st === 'pending') location.hash = '#/pay/' + r.id + '/status?pid=' + pid;
      };
      el.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => {
        P().chargeDemo(pid, b.dataset.sim, done);
        el.querySelector('#upiState').textContent = T('payupi.sent');
      }));
    },
  });

  /* ---------- PayPal (demo until keys+server) ---------- */
  SeatSwapApp.screen('paypaypal', {
    render(r) {
      const pid = new URLSearchParams((location.hash.split('?')[1] || '')).get('pid') || sessionStorage.getItem('seatswap_pid');
      sessionStorage.setItem('seatswap_pid', pid || '');
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <h1 class="h-title">${esc(T('paypal.title'))}</h1>
        <p class="subtitle">${esc(T('paypal.body'))}</p>
        <div class="paybox"><div class="big">${esc(P().inr(9900))} <small style="font-size:13px;color:var(--muted)">INR</small></div>
          <p class="fine">${esc(T('paypal.fx'))}</p></div>
        <button type="button" class="btn" id="ppGo">${esc(T('paypal.approve'))}</button>
        <p class="fine">${esc(T('payupi.demo'))}</p>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      el.querySelector('#ppGo').addEventListener('click', () => {
        const pid = sessionStorage.getItem('seatswap_pid');
        P().chargeDemo(pid, 'auto', (st) => {
          if (st === 'paid') location.hash = '#/pay/' + r.id + '/done';
          else location.hash = '#/pay/' + r.id + '/status?pid=' + pid;
        });
      });
    },
  });

  /* ---------- payment status (pending / failed) ---------- */
  SeatSwapApp.screen('paystatus', {
    render(r) {
      const pid = new URLSearchParams((location.hash.split('?')[1] || '')).get('pid');
      let st = 'pending';
      try {
        const p = E().db().payments[pid];
        st = p ? p.status : 'pending';
      } catch {}
      const failed = st === 'failed';
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <h1 class="h-title">${esc(failed ? T('paystatus.failedT') : T('paystatus.pendingT'))}</h1>
        <p class="subtitle">${esc(failed ? T('paystatus.failedB') : T('paystatus.pendingB'))}</p>
        ${failed ? `<button type="button" class="btn" id="retryPay">${esc(T('paystatus.retry'))}</button>
          <a class="btn btn--ghost" href="#/pay/${r.id}/method">${esc(T('paystatus.otherWay'))}</a>`
          : `<button type="button" class="btn" id="checkPay">${esc(T('paystatus.check'))}</button>
          <p class="fine">${esc(T('paystatus.noDouble'))}</p>`}
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const pid = new URLSearchParams((location.hash.split('?')[1] || '')).get('pid');
      const rt = el.querySelector('#retryPay');
      if (rt) rt.addEventListener('click', () => {
        sessionStorage.setItem('seatswap_pid', pid);
        P().chargeDemo(pid, 'auto', (st) => {
          if (st === 'paid') location.hash = '#/pay/' + r.id + '/done';
          else SeatSwapApp.render();
        });
      });
      const ck = el.querySelector('#checkPay');
      if (ck) ck.addEventListener('click', () => {
        let st = 'pending';
        try { st = E().db().payments[pid].status; } catch {}
        if (st === 'paid') location.hash = '#/pay/' + r.id + '/done';
        else SeatSwapApp.render();
      });
    },
  });

  /* ---------- payment done + receipt ---------- */
  SeatSwapApp.screen('paydone', {
    render(r) {
      const req = reqGuard(r);
      const pays = E().paymentsFor(req.id).filter((p) => p.status === 'paid');
      const p = pays[pays.length - 1];
      const rc = p ? E().receiptFor(p.id) : null;
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <div style="font-size:52px" aria-hidden="true">✓</div>
        <h1 class="h-title">${esc(T('paydone.title'))}</h1>
        <p class="subtitle">${esc(T('paydone.body'))}</p>
        ${p ? `<section class="card" style="text-align:left">
          <b>${esc(T('paydone.receipt'))} ${esc(rc ? rc.number : '')}</b>
          ${P().receiptLines(p).map((l) => `<div class="bkrow ${l.total ? 'total' : ''}"><span>${esc(l.label)}</span><b>${esc(P().inr(l.amount))}</b></div>`).join('')}
        </section>` : ''}
        <a class="btn" href="#/swaps/${req.id}">${esc(T('paydone.openSwap'))}</a>
        ${footer(false)}</main>`,
      };
    },
    wire(el) { bindBack(el); },
  });

  /* ---------- SWAP detail (locked + terminals) ---------- */
  function partyNames(req) {
    const trip = SeatSwapStore.get(req.booking_id);
    const offer = req.locked_offer_id ? E().getOffer(req.locked_offer_id) : null;
    const aname = offer ? SeatSwapDemo.seedName(offer.acceptor_id, req.booking_id) : '';
    return { trip, offer, aname };
  }
  SeatSwapApp.screen('swapdetail', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const req = E().getRequest(r.id);
      const { trip, offer, aname } = partyNames(req);
      const mine = trip ? (trip.passengers[0] || {}) : {};
      let banner = '';
      if (req.status === 'voided') banner = `<section class="card card--green center"><b>${esc(T('swap.toCredit'))}</b><p class="fine">${esc(T('swap.valid12'))}</p></section>`;
      else if (req.status === 'disputed') banner = `<section class="card card--peach center"><b>${esc(T('swap.diffT'))}</b><p>${esc(T('swap.diffB'))}</p></section>`;
      else if (req.status === 'confirmed') banner = `<section class="card card--green center"><b>${esc(T('swapdone.swappedT'))}</b></section>`;
      const revealed = ['locked', 'confirmed', 'disputed'].includes(req.status);
      return {
        tab: 'swaps',
        html: `${innerHead('bell')}<main class="body">
        <h1 class="h-title">${esc(T('swap.title'))}</h1>
        ${banner}
        <section class="card"><div class="iconcard"><span class="tripthumb">${Art.train}</span>
          <span style="flex:1"><b>${esc(trip ? trip.train_no : '')} · ${esc(aname)}</b><br/>
          <small style="color:var(--muted)">${revealed && offer ? esc(seedBerth(offer, trip)) : esc(T('trip.berthMasked'))} · ${esc(req.status)}</small></span></div></section>
        ${req.status === 'locked' ? `<div class="menu">
          <a class="mrow" href="#/chat/${E().chatFor(req.id).id}"><span class="mico">${Art.swapArrows}</span><span class="mlab">${esc(T('chat.title'))}</span>${Art.chevR}</a>
          <a class="mrow" href="#/swaps/${req.id}/meet"><span class="mico">${Art.people}</span><span class="mlab">${esc(T('meet.title'))}</span>${Art.chevR}</a>
          <a class="mrow" href="#/swaps/${req.id}/summary"><span class="mico">${Art.doc}</span><span class="mlab">${esc(T('summary.title'))}</span>${Art.chevR}</a>
          <a class="mrow" href="#/swaps/${req.id}/confirm"><span class="mico">${Art.check}</span><span class="mlab">${esc(T('confirm.title'))}</span>${Art.chevR}</a>
          <a class="mrow mrow--danger" href="#/swaps/${req.id}/cancel"><span class="mico">✕</span><span class="mlab">${esc(T('swapcancel.title'))}</span>${Art.chevR}</a>
        </div>` : ''}
        ${['confirmed', 'voided'].includes(req.status) ? `<a class="btn btn--ghost" href="#/swaps/${req.id}/rate">${esc(T('rate.title'))}</a>
        <a class="btn btn--ghost" href="#/swaps/${req.id}/share">${esc(T('shr.cardTitle'))}</a>` : ''}
        ${footer(false)}</main>`,
      };
    },
    wire(el) { bindBack(el, '#/swaps'); },
  });
  function seedBerth(offer, trip) {
    const s = SeatSwapDemo.seedOf(offer.acceptor_id, trip.id);
    return s ? (s.coach + ' · ' + SeatSwapData.berthLabel(s.berth_type, trip.class)) : '';
  }

  /* ---------- cancel swap ---------- */
  SeatSwapApp.screen('swapcancel', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const req = E().getRequest(r.id);
      const { aname } = partyNames(req);
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <h1 class="h-title">${esc(T('swapcancel.title'))}</h1>
        <p class="subtitle">${esc(T('swapcancel.body', { name: aname }))}</p>
        <section class="card card--green"><b>${esc(T('swapcancel.toCredit'))}</b><br/>
          <small>${esc(T('swapcancel.noCredit'))}</small></section>
        <button type="button" class="btn btn--danger" id="cancelGo">${esc(T('swapcancel.go'))}</button>
        <button type="button" class="btn btn--ghost" id="cancelKeep">${esc(T('swapcancel.keep'))}</button>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      el.querySelector('#cancelKeep').addEventListener('click', () => history.back());
      el.querySelector('#cancelGo').addEventListener('click', () => {
        E().cancelSwap(r.id, E().meId());
        location.hash = '#/swaps/' + r.id;
      });
    },
  });

  /* ---------- CHAT ---------- */
  const QUICK = ['meetDoor', 'atBerth', 'onWay', 'thanks'];
  SeatSwapApp.screen('chat', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const chat = E().db().chats[r.id];
      if (!chat) return { html: '', tab: 'swaps' };
      const req = E().getRequest(chat.request_id);
      const msgs = E().messagesFor(chat.id);
      const me = E().meId();
      /* Cash-word guard (docs/08): the warning persists while any of my sent
         messages is flagged — setting innerHTML then re-rendering would wipe
         a one-shot banner, so the card derives from stored message state. */
      const risked = msgs.some((m) => m.flagged_risky && m.sender_id === me);
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('chat.title'))}</h1>
        ${risked ? `<section class="card card--peach"><b>${esc(T('chat.riskT'))}</b><p>${esc(T('chat.riskB'))}</p></section>` : ''}
        <div class="chatlist">${msgs.map((m) => `<div class="bubble ${m.sender_id === me ? 'me' : ''} ${m.flagged_risky ? 'bubble--flag' : ''}">
          ${esc(m.text)}<small>${esc(m.sender_name)} · ${esc(new Date(m.created_at).toLocaleTimeString())}</small></div>`).join('') || `<p class="subtitle">${esc(T('chat.empty'))}</p>`}</div>
        <div id="riskBox"></div>
        <div class="quickchips">${QUICK.map((k) => `<button type="button" class="chipbtn" data-q="${esc(T('chat.q_' + k))}">${esc(T('chat.q_' + k))}</button>`).join('')}</div>
        <form class="composer" id="composer"><input id="msgIn" class="input" maxlength="500" placeholder="${esc(T('chat.ph'))}" autocomplete="off" />
          <button class="btn send" type="submit" aria-label="${esc(T('chat.send'))}">↑</button></form>
        <div class="menu">
          <button type="button" class="mrow" id="repBtn"><span class="mico">⊘</span><span class="mlab">${esc(T('chat.report'))}</span>${Art.chevR}</button>
        </div>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const chat = E().db().chats[r.id];
      const req = E().getRequest(chat.request_id);
      const me = E().me();
      const send = (text) => {
        E().postMessage(chat.id, me.id, me.first_name, text);
        SeatSwapDemo.onUserMessage(req.id, text);
        SeatSwapApp.render();
      };
      el.querySelector('#composer').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = el.querySelector('#msgIn').value.trim();
        if (v) send(v);
      });
      el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => send(b.dataset.q)));
      el.querySelector('#repBtn').addEventListener('click', () => {
        const reason = window.prompt(T('chat.report') + '?') || '';
        const offer = req.locked_offer_id ? E().getOffer(req.locked_offer_id) : null;
        E().reportBlock(me.id, offer ? offer.acceptor_id : 'seed', req.id, reason);
        toast(T('chat.reported'));
      });
    },
  });

  /* ---------- MEET ---------- */
  SeatSwapApp.screen('meet', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const req = E().getRequest(r.id);
      const { aname } = partyNames(req);
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <h1 class="h-title">${esc(T('meet.title'))}</h1>
        <button type="button" class="btn" id="metYes">${esc(T('meet.met', { name: aname }))}</button>
        <button type="button" class="btn btn--ghost" id="metNo">${esc(T('meet.notMet'))}</button>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      el.querySelector('#metYes').addEventListener('click', () => { E().setMet(r.id, E().meId(), true); location.hash = '#/swaps/' + r.id + '/confirm'; });
      el.querySelector('#metNo').addEventListener('click', () => { E().setMet(r.id, E().meId(), false); location.hash = '#/swaps/' + r.id + '/confirm'; });
    },
  });

  /* ---------- SUMMARY (offline-friendly) ---------- */
  SeatSwapApp.screen('summary', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const req = E().getRequest(r.id);
      const trip = reqTrip(req);
      const mine = trip ? (trip.passengers[0] || {}) : {};
      const { offer, aname } = partyNames(req);
      const tl = [
        T('summary.t_sent'), T('summary.t_accepted'), T('summary.t_paid'), T('summary.t_locked'),
      ];
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('summary.title'))}</h1>
        <section class="card"><div class="bkrow"><span>${esc(trip ? trip.train_no : '')}</span><b>${esc(trip ? fmtDate(trip.journey_date) : '')}</b></div>
          <div class="bkrow"><span>${esc(T('summary.you'))}</span><b>${esc(mine.coach || '')} · ${esc(SeatSwapPNR.berthLabel(mine.berth_type, trip ? trip.class : 'SL'))}</b></div>
          <div class="bkrow"><span>${esc(aname)}</span><b>${esc(offer && trip ? seedBerth(offer, trip) : T('trip.berthMasked'))}</b></div></section>
        <div class="timeline">${tl.map((t) => `<div class="tlrow"><span class="tldot">✓</span><span>${esc(t)}</span></div>`).join('')}</div>
        ${footer(false)}</main>`,
      };
    },
    wire(el) { bindBack(el); },
  });

  /* ---------- CONFIRM ---------- */
  const OUTCOMES = ['swapped', 'no_show', 'not_possible', 'changed_mind'];
  SeatSwapApp.screen('confirm', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body">
        <h1 class="h-title">${esc(T('confirm.title'))}</h1>
        ${OUTCOMES.map((o) => `<button type="button" class="pmrow" data-oc="${o}">
          <span style="flex:1"><b>${esc(T('confirm.' + o))}</b></span><span class="chev">›</span></button>`).join('')}
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      el.querySelectorAll('[data-oc]').forEach((b) => b.addEventListener('click', () => {
        const req = E().submitOutcome(r.id, E().meId(), b.dataset.oc);
        SeatSwapDemo.onUserOutcome(r.id, b.dataset.oc);
        if (req.status === 'confirmed') location.hash = '#/swaps/' + r.id + '/done';
        else location.hash = '#/swaps/' + r.id;
      }));
    },
  });

  /* ---------- DONE (swapped / earned) ---------- */
  SeatSwapApp.screen('swapdone', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const req = E().getRequest(r.id);
      const { aname } = partyNames(req);
      const mine = E().meId() !== req.requester_id;
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <div style="font-size:52px" aria-hidden="true">🎉</div>
        <h1 class="h-title">${esc(mine ? T('swapdone.earnedT') : T('swapdone.swappedT'))}</h1>
        <p class="subtitle">${esc(mine ? T('swapdone.earnedB', { name: '' }) : T('swapdone.swappedB'))}</p>
        ${mine ? `<section class="card card--peach center"><b>${esc(T('swapdone.earnedCard'))}</b></section>` : ''}
        <a class="btn" href="#/swaps/${req.id}/share">${esc(T('swapdone.share'))}</a>
        <a class="btn btn--ghost" href="#/trips/add">${esc(T('swapdone.another'))}</a>
        ${footer(false)}</main>`,
      };
    },
    wire(el) { bindBack(el); },
  });

  /* ---------- SHARE card ---------- */
  SeatSwapApp.screen('swapshare', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      const req = E().getRequest(r.id);
      const trip = reqTrip(req);
      const text = T('shr.cardText', { train: trip ? trip.train_no : '' });
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <h1 class="h-title">${esc(T('shr.cardTitle'))}</h1>
        <section class="card card--green"><b>${esc(text)}</b><br/><small>${esc(T('home.travelBetter'))}</small></section>
        <div class="sharerow" id="shrRow"></div>
        <a class="btn btn--ghost" href="#/swaps/${req.id}/rate">${esc(T('rate.title'))}</a>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      const req = E().getRequest(r.id);
      SeatSwapApp.share.paintShare(el.querySelector('#shrRow'), 'request', req.id, { train: (reqTrip(req) || {}).train_no });
    },
  });

  /* ---------- RATE ---------- */
  SeatSwapApp.screen('rate', {
    render(r) {
      if (needAuth(location.hash)) return { html: '', tab: 'swaps' };
      return {
        tab: 'swaps',
        html: `${innerHead()}<main class="body center">
        <h1 class="h-title">${esc(T('rate.title'))}</h1>
        <div class="stars" id="stars">${[1, 2, 3, 4, 5].map((s) => `<button type="button" class="star" data-s="${s}" aria-label="${s}">★</button>`).join('')}</div>
        <button type="button" class="btn" id="rateGo">${esc(T('rate.send'))}</button>
        ${footer(false)}</main>`,
      };
    },
    wire(el, r) {
      bindBack(el);
      let stars = 5;
      const paint = () => el.querySelectorAll('.star').forEach((s) => s.classList.toggle('on', Number(s.dataset.s) <= stars));
      el.querySelectorAll('.star').forEach((s) => s.addEventListener('click', () => { stars = Number(s.dataset.s); paint(); }));
      paint();
      el.querySelector('#rateGo').addEventListener('click', () => {
        const req = E().getRequest(r.id);
        const offer = req.locked_offer_id ? E().getOffer(req.locked_offer_id) : null;
        E().rateSwap(r.id, E().meId(), stars, offer ? offer.acceptor_id : null);
        toast(T('rate.thanks'));
        location.hash = '#/swaps';
      });
    },
  });
})();
