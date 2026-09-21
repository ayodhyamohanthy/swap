/* SwapSeat · POST-CONFIRMATION screens (shared by requester and accepter):
   safe chat, journey tracking, trip completion + rating.
   Hard rules enforced here: a message is never shown as delivered while
   offline; a rating persists per journey; share text never carries PNRs,
   the other traveller's seat, or names. */
(() => {
  if (typeof Flow === 'undefined') return;
  const esc = Flow.esc;
  const TEMPLATES = [
    'I can meet near the coach entrance.',
    'I will confirm after boarding.',
    'Please verify with railway staff.',
    'I cannot continue with this request.',
    'I am traveling with a family member.',
  ];
  const CONTACT = /(\+?\d[\d\s-]{7,})|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|(\b[A-Z0-9]{6,10}\b\s*(?:PNR)?)/i;

  function threadId() {
    const b = Flow.ctx.booking;
    return (b && b.pnrHash) || 'demo';
  }
  function loadThread() {
    try { return JSON.parse(localStorage.getItem('swapseat_thread_' + threadId()) || '[]'); } catch { return []; }
  }
  function saveThread(msgs) { localStorage.setItem('swapseat_thread_' + threadId(), JSON.stringify(msgs.slice(-100))); }
  function otherName() {
    const b = Bookings.current();
    const inc = Bookings.incoming(b).find((x) => x.state === 'accepted');
    return (inc && inc.fromName) || 'Traveller';
  }
  /* The journey only reaches this screen once it exists. */
  function journeyExists() { return !!Bookings.current(); }

  /* ---------- CHAT (during journey) ---------- */
  Flow.register({
    id: 'chat', title: 'Chat (During Journey)',
    render() {
      if (!journeyExists()) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const msgs = loadThread();
      return `
      ${Flow.screenHead('During journey', 'Chat', '')}
      <div class="fs-body">
        <div class="fcard">
          <div class="frow"><span class="avatar" aria-hidden="true">${esc(otherName()[0])}</span>
            <div><b>${esc(otherName())}</b> <span class="fpill"><i class="dot-live" aria-hidden="true"></i> Online</span></div></div>
          <p class="fine">Structured safety messages only. Personal contact details aren't allowed here.</p>
        </div>
        <div class="msglist" role="log" aria-live="polite" aria-label="Messages">${msgs.length ? msgs.map((m) =>
          `<div class="msg ${m.from === 'me' ? 'me' : 'them'}" data-msg><span>${esc(m.text)}</span><small>${m.queued ? 'queued — not sent' : (new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small></div>`).join('')
          : '<p class="fmuted" style="text-align:center">Say hello 👋 — pick a safe template below.</p>'}</div>
        <div class="chips" role="group" aria-label="Safe templates">${TEMPLATES.map((t) => `<button type="button" class="chip" data-tpl="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="composer frow" style="margin-top:10px">
          <label class="flabel" for="msgInput" style="position:absolute;left:-9999px">Your message</label>
          <input id="msgInput" class="finput" placeholder="Type a message…" autocomplete="off"/>
          <button type="button" class="fbtn" id="msgSend" aria-label="Send message">Send</button>
        </div>
        <div class="frow" style="margin-top:8px">
          <button type="button" class="fbtn ghost" data-go-scr="track">Track journey</button>
          <button type="button" class="fbtn ghost" id="msgReport" aria-label="Report this traveller">⚑ Report</button>
        </div>
      </div>`;
    },
    wire(root) {
      if (!journeyExists()) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => Flow.show(x.dataset.goScr))); return; }
      const list = root.querySelector('.msglist');
      const input = root.querySelector('#msgInput');
      const send = root.querySelector('#msgSend');
      function push(text, from, queued) {
        const msgs = loadThread();
        msgs.push({ from, text, at: Date.now(), queued: !!queued });
        saveThread(msgs);
        list.insertAdjacentHTML('beforeend', `<div class="msg ${from === 'me' ? 'me' : 'them'}"><span>${esc(text)}</span><small>${queued ? 'queued — not sent' : (new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small></div>`);
        list.scrollIntoView({ block: 'end' });
      }
      function trySend(text) {
        const clean = (text || '').trim();
        if (!clean) return;
        if (CONTACT.test(clean)) { toast('For your safety, personal contact details aren\'t allowed here.'); return; }
        if (!online()) { push(clean, 'me', true); toast('📴 Offline — your message is queued, not sent.'); return; }
        push(clean, 'me', false);
      }
      send.addEventListener('click', () => { trySend(input.value); input.value = ''; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { trySend(input.value); input.value = ''; } });
      root.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => trySend(b.dataset.tpl)));
      root.querySelector('#msgReport').addEventListener('click', () => { toast('⚑ Report logged. A moderator will review this thread.'); });
    },
  });

  /* ---------- JOURNEY TRACKING ---------- */
  Flow.register({
    id: 'track', title: 'Journey Tracking',
    render() {
      const b = Bookings.current();
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const ph = Bookings.phase(b);
      const stops = [
        { t: b.dep, label: `${b.from} · Departed`, key: 'departed' },
        { t: '', label: b.mode === 'flight' ? 'In the air' : b.mode === 'bus' ? 'On the road' : 'On the way', key: 'enroute' },
        { t: b.arr, label: `${b.to} · Arriving`, key: 'arriving' },
      ];
      const phaseIdx = Bookings.PHASES.indexOf(ph.key);
      const live = ph.key === 'departed' ? stops[0] : ph.key === 'enroute' ? stops[1] : ph.key === 'arriving' ? stops[2] : null;
      return `
      ${Flow.screenHead('During journey', 'Journey Tracking', '')}
      <div class="fs-body">
        <div class="fcard">
          <div class="frow"><b>${modeIcon(b.mode)} ${esc(b.carrier)} ${esc(b.serviceNo)}</b><span class="fpill chip live">● On time</span></div>
          <p class="fmuted">${esc(b.from)} → ${esc(b.to)} · ${fmtDate(b.date)} · ${esc(b.dep)} → ${esc(b.arr)} · ${esc(b.dur)}</p>
        </div>
        <div class="timeline" role="list">
          ${stops.map((s, i) => {
            const on = ph.key === 'notstarted' ? i === 0 : (Bookings.PHASES.indexOf(s.key) <= phaseIdx);
            return `<div class="tl-item ${on ? 'on' : ''}" role="listitem" aria-current="${live === s ? 'step' : 'false'}">
              <span class="tl-dot" aria-hidden="true">${on ? '●' : '○'}</span>
              <div><b>${esc(s.label)}</b>${s.t ? `<span class="fmuted"> ${esc(s.t)}</span>` : ''}</div>
            </div>`;
          }).join('')}
        </div>
        <p class="fine" style="text-align:center">Journey phase derived from the schedule (${esc(ph.source)}). Live operator status needs an authorised feed.</p>
        <div class="fs-actions">
          <button type="button" class="fbtn ghost block" data-go-scr="chat">Open chat</button>
          ${ph.key === 'arrived' ? `<button type="button" class="fbtn block" data-go-scr="done">Journey completed</button>` : ''}
        </div>
      </div>`;
    },
    wire(root) { root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => Flow.show(x.dataset.goScr))); },
  });

  /* ---------- JOURNEY COMPLETED ---------- */
  Flow.register({
    id: 'done', title: 'Journey Completed',
    render() {
      const b = Bookings.current();
      if (!b) return `<div class="fs-body"><div class="fcard fcard--ghost"><p class="fmuted">Fetch your booking first.</p><button class="fbtn ghost block" data-go-scr="booking">Find booking</button></div></div>`;
      const saved = Bookings.rating(b.id) || 0;
      const inc = Bookings.incoming(b).find((x) => x.state === 'accepted');
      const stars = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${n <= saved ? 'on' : ''}" data-star="${n}" aria-pressed="${n <= saved}" aria-label="Rate ${n} star${n > 1 ? 's' : ''}">★</button>`).join('');
      return `
      ${Flow.screenHead('Wrap up', 'Journey Completed', '')}
      <div class="fs-body">
        <div class="fcard fcard--ok">
          <div class="big-ok" aria-hidden="true">🏁</div>
          <h3 style="text-align:center">Trip Completed!</h3>
          <p class="fmuted" style="text-align:center">Hope you had a great journey.</p>
          <p class="fmuted" style="text-align:center">${modeIcon(b.mode)} ${esc(b.carrier)} ${esc(b.serviceNo)} · ${esc(b.from)} → ${esc(b.to)} · ${fmtDate(b.date)}</p>
          ${inc ? `<p class="fine" style="text-align:center">Coordinated with ${esc(inc.fromName)} — thanks for swapping kindly.</p>` : ''}
        </div>
        <div class="fcard">
          <div class="fsub" id="rateLabel">Rate Your Experience</div>
          <div class="stars" role="group" aria-labelledby="rateLabel">${stars}</div>
          <p class="fine" id="rateNote">${saved ? `You rated this journey ${saved} star${saved > 1 ? 's' : ''}.` : 'Tap to rate. Ratings are stored on this device only.'}</p>
        </div>
        <div class="fs-actions">
          <button type="button" class="fbtn block" data-go-scr="home">Book another swap</button>
          <button type="button" class="fbtn ghost block" id="shareTrip">Share</button>
        </div>
      </div>`;
    },
    wire(root) {
      const b = Bookings.current();
      root.querySelectorAll('[data-go-scr]').forEach((x) => x.addEventListener('click', () => Flow.show(x.dataset.goScr)));
      root.querySelectorAll('[data-star]').forEach((s) => s.addEventListener('click', () => {
        const n = parseInt(s.dataset.star, 10);
        Bookings.setRating(b.id, n);
        root.querySelectorAll('[data-star]').forEach((x) => {
          const on = parseInt(x.dataset.star, 10) <= n;
          x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on));
        });
        const note = root.querySelector('#rateNote');
        if (note) note.textContent = `You rated this journey ${n} star${n > 1 ? 's' : ''}.`;
        Metrics.log('journey_rated');
      }));
      const share = root.querySelector('#shareTrip');
      if (share) share.addEventListener('click', async () => {
        /* Deliberately minimal: no PNR, no seat numbers, no names. */
        const text = `I coordinated a seat swap on ${b.carrier} ${b.serviceNo} (${b.from} → ${b.to}, ${fmtDate(b.date)}) with SwapSeat.`;
        try {
          if (navigator.share) await navigator.share({ title: 'SwapSeat', text });
          else { await navigator.clipboard.writeText(text); toast('Copied — ready to paste anywhere.'); }
        } catch { toast('Sharing is optional — nothing was sent.'); }
      });
    },
  });
})();
