/* SwapSeat · ACCEPTER FLOW (the product designs, screens 1-6).
   Someone wants your seat. Review, compare, accept — the fee decision always
   comes from Policy: if you were also searching, no payment; otherwise the
   REQUESTER completes the one-sided swap fee after your acceptance.
   Exact seat numbers never appear before the reveal conditions are met. */
(() => {
  if (typeof Flow === 'undefined') return;
  const esc = Flow.esc;

  function incomingById(id) {
    const inc = Bookings.incoming(Flow.ctx.booking);
    return inc.find((x) => x.id === id) || (Flow.ctx.incomingId && inc.find((x) => x.id === Flow.ctx.incomingId)) || inc[0] || null;
  }
  /* Reveal rule: both travellers have completed payment. Option A means the
     accepter was searching too (search paid on this device). Option B means the
     requester completes the one-sided fee — tracked on the request record. */
  function revealFor(x) {
    if (!x || x.state !== 'accepted') return { unlocked: false, reason: 'not-accepted' };
    if (Policy.hasPaidSearch(x.service)) return { unlocked: true, reason: 'also-looking' };
    if (x.completionPaid) return { unlocked: true, reason: 'completion-paid' };
    return { unlocked: false, reason: 'awaiting-requester' };
  }
  function confirmationRule(x) {
    const f = Policy.fees();
    if (Policy.hasPaidSearch(x.service)) return { option: 'A', amount: 0, kind: null };
    return { option: 'B', amount: f.ONE_SIDED_SWAP_FEE, kind: 'completion' };
  }

  /* ---------- 1 · NOTIFICATION ---------- */
  Flow.register({
    id: 'notif', title: 'Swap Request',
    render() {
      const x = incomingById(Flow.ctx.incomingId);
      if (!x) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">No swap requests right now. When someone on your service wants your seat, it lands here.</p><button class="fbtn ghost block" data-go-scr="home">Home</button></div></div>`;
      return `
      ${Flow.screenHead('Step 1 · Received', 'Swap Request', '')}
      <div class="fs-body">
        <div class="fcard fcard--notif">
          <div class="frow"><span class="avatar" aria-hidden="true">${esc(x.fromName[0])}</span>
            <div><b>${esc(x.fromName)}</b>${x.fromVerified ? ' <span class="fpill">✓ Verified traveller</span>' : ''}<br/>
            <span class="fmuted">${modeIcon(x.mode)} ${esc(x.carrier)} ${esc(x.serviceNo)}</span></div></div>
          <p class="fmuted" style="margin-top:8px">wants to swap seats with you on ${esc(x.carrier)} ${esc(x.serviceNo)} (${esc(x.from)} → ${esc(x.to)}).</p>
          <p class="fine">Tap to view. Declining is always one tap, and nothing is shared until you accept.</p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-req="${esc(x.id)}">View Details</button>
          <button type="button" class="fbtn ghost block" data-decline="${esc(x.id)}">Decline</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-req]').forEach((b) => b.addEventListener('click', () => Flow.show('request', { incomingId: b.dataset.goReq })));
      root.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => { Bookings.declineIncoming(b.dataset.decline); toast('Declined. Nothing was shared.'); Flow.show('home'); }));
      root.querySelectorAll('[data-go-scr]').forEach((b) => b.addEventListener('click', () => Flow.show(b.dataset.goScr)));
    },
  });

  /* ---------- 2 · VIEW REQUEST ---------- */
  Flow.register({
    id: 'request', title: 'View Request',
    render() {
      const x = incomingById(Flow.ctx.incomingId);
      if (!x) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">This request is no longer available.</p><button class="fbtn ghost block" data-go-scr="trips">My Trips</button></div></div>`;
      return `
      ${Flow.screenHead('Step 2 · Review', 'View Request', '')}
      <div class="fs-body">
        <div class="fcard">
          <div class="frow"><span class="avatar" aria-hidden="true">${esc(x.fromName[0])}</span>
            <div><b>${esc(x.fromName)}</b> ${x.fromVerified ? '<span class="fpill">⭐ Verified traveller</span>' : ''}<br/>
            <span class="fmuted">${modeIcon(x.mode)} ${esc(x.carrier)} ${esc(x.serviceNo)} · ${fmtDate(x.date)}</span></div></div>
          <div class="seatpair" style="margin-top:10px">
            <div class="sp"><span class="fmuted">Their seat</span><b>Approximate</b><span class="fine">${esc((x.theirWant || []).join(', ') || 'preference on file')}</span></div>
            <div class="sp"><span class="fmuted">Your seat</span><b>${esc(x.yourSeat || '—')}</b><span class="fine">${esc(x.yourCoach ? 'coach ' + x.yourCoach : '')}</span></div>
          </div>
          <p class="fine">Their exact seat stays private until the swap is confirmed.</p>
          <div class="fsub" style="margin-top:10px">Their preference</div>
          <div class="chips">${(x.theirWant || []).map((w) => `<span class="chip">${esc(typeof wantLabel !== 'undefined' ? wantLabel(w) : w)}</span>`).join('')}</div>
          ${x.note ? `<div class="fsub" style="margin-top:10px">About</div><p class="fmuted">${esc(x.note)}</p>` : ''}
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-layout="${esc(x.id)}">View Seat Layout</button>
          <button type="button" class="fbtn ghost block" data-decline="${esc(x.id)}">Decline</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-go-layout]').forEach((b) => b.addEventListener('click', () => Flow.show('seatlayout', { incomingId: b.dataset.goLayout })));
      root.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => { Bookings.declineIncoming(b.dataset.decline); toast('Declined. Nothing was shared.'); Flow.show('home'); }));
    },
  });

  /* ---------- 3 · YOUR SEAT DETAILS ---------- */
  Flow.register({
    id: 'seatlayout', title: 'Your Seat Details',
    render() {
      const b = Flow.ctx.booking;
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      return `
      ${Flow.screenHead('Step 3 · Your seat', 'Your Seat Details', 'from your booking')}
      <div class="fs-body">
        ${Flow.compactGrid(b, [])}
        <div class="legendrow" role="list">
          <span role="listitem"><i class="lk lk-mine"></i>Your seat</span>
          <span role="listitem"><i class="lk lk-other"></i>Other seats</span>
        </div>
        <p class="fmuted">Your seat is <b>${esc(Flow.seatLabel(b))}</b>${b.primary && b.primary.info ? ' — ' + esc(b.primary.info.blurb) : ''}</p>
        <div class="fs-actions"><button type="button" class="fbtn block" data-go-cmp="1">Continue</button></div>
      </div>`;
    },
    wire(root) { root.querySelectorAll('[data-go-cmp]').forEach((b) => b.addEventListener('click', () => Flow.show('compare'))); },
  });



  /* ---------- 4 · COMPARE & DECIDE ---------- */
  Flow.register({
    id: 'compare', title: 'Compare & Decide',
    render() {
      const x = incomingById(Flow.ctx.incomingId);
      if (!x) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">This request is no longer available.</p></div></div>`;
      const rule = confirmationRule(x);
      return `
      ${Flow.screenHead('Step 4 · Decide', 'Compare & Decide', '')}
      <div class="fs-body">
        <div class="seatpair">
          <div class="sp"><span class="fmuted">Your seat</span><b>${esc(x.yourSeat || '—')}</b><span class="fine">${esc(x.yourCoach ? 'coach ' + x.yourCoach : '')}</span></div>
          <div class="sp"><span class="fmuted">Requester's seat</span><b>${rule.option === 'A' ? esc(x.theirSeat) : 'Approximate'}</b><span class="fine">${rule.option === 'A' ? 'revealed' : 'revealed after confirmation'}</span></div>
        </div>
        <div class="checklist" role="list">
          <div class="ck" role="listitem"><i class="cki">✓</i>Same class (${esc(x.mode === 'flight' ? 'Economy' : x.mode === 'bus' ? 'AC Sleeper' : 'Reserved')})</div>
          <div class="ck" role="listitem"><i class="cki">✓</i>Good compatibility — same service, same segment</div>
          <div class="ck" role="listitem"><i class="cki">✓</i>${x.fromVerified ? 'Verified traveller' : 'Traveller on your service'}</div>
          <div class="ck" role="listitem"><i class="cki">✓</i>${rule.option === 'A' ? 'No payment needed — you are also looking to swap' : 'Requester completes ₹' + rule.amount + ' after your acceptance'}</div>
        </div>
        <p class="fine">Exact seat numbers will be revealed only after the swap is confirmed.</p>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-accept="${esc(x.id)}">Accept</button>
          <button type="button" class="fbtn ghost block" data-decline="${esc(x.id)}">Decline</button>
        </div>
      </div>`;
    },
    wire(root) {
      root.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.accept;
        Bookings.acceptIncoming(id);
        Flow.ctx.incomingId = id;
        Flow.show('acceptance');
      }));
      root.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => { Bookings.declineIncoming(b.dataset.decline); toast('Declined. Nothing was shared.'); Flow.show('home'); }));
    },
  });

  /* ---------- 5 · ACCEPTANCE (Policy decides which option applies) ---------- */
  Flow.register({
    id: 'acceptance', title: 'Acceptance',
    render() {
      const x = incomingById(Flow.ctx.incomingId);
      if (!x) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">This request is no longer available.</p></div></div>`;
      const rule = confirmationRule(x);
      const rev = revealFor(x);
      return `
      ${Flow.screenHead('Step 5 · Confirm', 'Acceptance', '')}
      <div class="fs-body">
        <div class="fcard">
          <div class="fsub">Option A · You're also looking to swap</div>
          <div class="checklist"><div class="ck"><i class="cki">✓</i>No payment needed!</div>
            <div class="ck"><i class="cki">✓</i>Since you're already looking to swap and have paid the search fee, you can accept without any additional payment.</div></div>
          <button type="button" class="fbtn block ${rule.option === 'A' ? '' : 'ghost'}" data-confirm="${esc(x.id)}" data-option="${rule.option}"
            ${rule.option === 'A' ? '' : 'aria-disabled="true" disabled title="Not applicable — this request needs the one-sided swap payment."'}>Confirm Acceptance</button>
          ${rule.option === 'A' ? '' : '<p class="fine">Not applicable for this request — use Option B below.</p>'}
        </div>
        <div class="fcard">
          <div class="fsub">Option B · You're not looking to swap</div>
          <div class="checklist"><div class="ck"><i class="cki">✓</i>Pay ₹${rule.amount} to confirm</div>
            <div class="ck"><i class="cki">✓</i>The requester will now complete a ₹${rule.amount} payment to confirm this swap.</div>
            <div class="ck"><i class="cki">✓</i>Secure &amp; encrypted payment · Verified traveller · You'll be notified instantly</div></div>
          ${rule.option === 'B' ? `<button type="button" class="fbtn block" id="awaitPayment">Waiting for requester's payment…</button>` : `<p class="fine">Not applicable — you already paid to search this service.</p>`}
        </div>
        ${rev.unlocked ? `<div class="fcard fcard--ok"><div class="frow"><b>Seats revealed</b><span class="fine">${esc(rev.reason)}</span></div>
          <button type="button" class="fbtn block" data-accepted="${esc(x.id)}">See the swap</button></div>` : ''}
      </div>`;
    },
    wire(root) {
      const x = incomingById(Flow.ctx.incomingId);
      root.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => {
        if (!online()) { toast('📴 Reconnect to confirm — an offline acceptance is never final.'); return; }
        /* The fee gate is decided by Policy, never by markup: Option A is only
           valid when the accepter is already searching this service. */
        const gate = confirmationRule(x);
        if (gate.option !== 'A') {
          toast('This request needs the one-sided swap payment (Option B).');
          return;
        }
        Bookings.setIncoming(x.id, { confirmedAt: Date.now() });
        if (typeof SwapLedger !== 'undefined') {
          SwapLedger.upsert({
            sourceId: 'req:' + x.id, mode: x.mode, serviceNumber: x.serviceNo, travelDate: x.date,
            coachOrCabin: (x.theirCoach || x.coach || '—'), ownSeat: (x.theirSeat || '—'), targetSeat: 'your seat',
            status: 'accepted', quoteSummary: 'option A · no additional fee',
            createdAt: x.ts ? new Date(x.ts).toISOString() : undefined,
          });
        }
        Metrics.log('swap_request_accepted');
        toast('🤝 Agreed by both — crew/operator approval still applies.');
        Flow.show('accepted');
      }));
      const wait = root.querySelector('#awaitPayment');
      if (wait) wait.addEventListener('click', () => {
        /* Demo path only: on a real deployment the requester's device completes
           the ₹99 and the backend flips completionPaid. Nothing here is faked
           as confirmed without payment. */
        if (!online()) { toast('📴 Payments need a connection.'); return; }
        checkout('completion', (res) => {
          Bookings.setIncoming(x.id, { completionPaid: true, paidRef: res && (res.id || res.razorpay_payment_id || res.orderID) });
          Metrics.log('payment_succeeded');
          toast('🔓 Payment received — seats revealed.');
          Flow.show('accepted');
        });
      });
      root.querySelectorAll('[data-accepted]').forEach((b) => b.addEventListener('click', () => Flow.show('accepted')));
    },
  });

  /* ---------- 6 · SWAP CONFIRMED (accepter side) ---------- */
  Flow.register({
    id: 'accepted', title: 'Swap Confirmed',
    render() {
      const x = incomingById(Flow.ctx.incomingId);
      if (!x) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">This request is no longer available.</p></div></div>`;
      const rev = revealFor(x);
      return `
      ${Flow.screenHead('Confirmed', 'Swap Confirmed', '')}
      <div class="fs-body">
        <div class="fcard fcard--ok">
          <div class="big-ok" aria-hidden="true">🎉</div>
          <h3 style="text-align:center">Great! It's confirmed!</h3>
          <p class="fmuted" style="text-align:center">Here are your seat details.</p>
          <div class="seatpair">
            <div class="sp"><span class="fmuted">Your seat</span><b>${esc(x.yourSeat || '—')}</b></div>
            <div class="sp"><span class="fmuted">Their seat</span><b>${rev.unlocked ? esc(x.theirSeat) : 'Hidden'}</b><span class="fine">${rev.unlocked ? 'revealed' : 'until both travellers complete payment'}</span></div>
          </div>
          <p class="fine" style="text-align:center">${modeIcon(x.mode)} ${esc(x.carrier)} ${esc(x.serviceNo)} · ${fmtDate(x.date)} · ${esc(x.dep)} → ${esc(x.arr)} · ${esc(x.from)} → ${esc(x.to)}</p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-scr="track">Track journey</button>
          <button type="button" class="fbtn ghost block" data-go-scr="chat">Open chat</button>
        </div>
      </div>`;
    },
    wire(root) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => Flow.show(x.dataset.goScr))); },
  });
})();
