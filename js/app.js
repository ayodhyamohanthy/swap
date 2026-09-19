/* SwapSeat app controller — journeys resolve to data.js specs; maps render them. */
const $ = (s) => document.querySelector(s);
const state = {
  mode: 'train',
  journey: null,      // {kind:'train', train, date} | {kind:'flight', flight, date} | {kind, custom, date}
  coach: null,
  craft: 'A20N',
  mine: null, mineFlight: null,
  wantTypes: [], wantSeats: [],
  zoomBay: null, filter: 'all',
};

const store = {
  all() {
    let local = [];
    try { local = JSON.parse(localStorage.getItem('swapseat_swaps') || '[]'); } catch {}
    return [...local, ...SEED_SWAPS];
  },
  add(s) {
    let cur = [];
    try { cur = JSON.parse(localStorage.getItem('swapseat_swaps') || '[]'); } catch {}
    cur.unshift(s); localStorage.setItem('swapseat_swaps', JSON.stringify(cur.slice(0, 60)));
  }
};

function fmtDate(d) { try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } }
function trainOf(swap) { return TRAIN_INDEX[String(swap.trainNo)] || GENERIC_TRAIN; }

/* ---------- mode tabs ---------- */
document.querySelectorAll('.mode-tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.mode-tabs button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); state.mode = b.dataset.mode;
  $('#numField label').textContent = state.mode === 'flight' ? 'Flight number' : state.mode === 'train' ? 'Train number' : state.mode === 'bus' ? 'Bus / route no.' : 'Event name';
  $('#journeyNo').placeholder = state.mode === 'flight' ? 'e.g. 6E2031' : state.mode === 'train' ? 'e.g. 12951 Rajdhani' : state.mode === 'bus' ? 'e.g. VRL-442' : 'e.g. Coldplay Mumbai';
  $('#journeyNo').value = state.mode === 'flight' ? '6E2031' : state.mode === 'train' ? '12951' : '';
}));

/* ---------- lookup ---------- */
function findTrain(q) {
  const query = (q || '').trim().toUpperCase();
  if (!query) return null;
  const digits = (query.match(/\d+/) || [null])[0];
  if (digits && TRAIN_INDEX[digits]) return TRAIN_INDEX[digits];
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  let best = null, bestScore = 0;
  for (const t of TRAINS) {
    const hay = `${t.no} ${t.name} ${t.from} ${t.to} ${t.keys}`.toLowerCase();
    let sc = 0;
    for (const w of words) if (hay.includes(w)) sc += w.length;
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  if (best && bestScore >= 3) return best;
  if (digits) return { ...GENERIC_TRAIN, no: digits, name: `Train ${digits}` };
  return null;
}

$('#lookupBtn').addEventListener('click', () => {
  const no = ($('#journeyNo').value || '').trim().toUpperCase().replace(/\s+/g, '');
  const date = $('#journeyDate').value || new Date().toISOString().slice(0, 10);
  if (state.mode === 'flight') {
    const f = FLIGHT_INDEX[no] || FLIGHTS.find(x => x.no === no) || { no: no || 'XX000', airline: 'Custom airline', from: 'AAA', to: 'BBB', craft: 'A20N', country: 'GLOBAL' };
    state.journey = { kind: 'flight', flight: f, date };
    state.craft = f.craft; state.mineFlight = null; state.wantTypes = ['W'];
  } else if (state.mode === 'train') {
    const t = findTrain(no) || { ...GENERIC_TRAIN, no: no || '00000' };
    state.journey = { kind: 'train', train: t, date };
    state.coach = t.coaches[0];
    const spec = specOf(t, state.coach);
    state.mine = null;
    state.wantTypes = isBerthSpec(spec) ? ['LB', 'SL'] : ['W'];
    state.wantSeats = []; state.zoomBay = null;
  } else {
    state.journey = { kind: state.mode, custom: no, date };
    state.coach = 'C1'; state.mine = null; state.wantTypes = ['W']; state.wantSeats = [];
  }
  renderJourney(); renderGoals(); renderMap();
  $('#mapSection').hidden = false; $('#postSection').hidden = false;
  $('#mapSection').scrollIntoView({ behavior: 'smooth' });
  renderMarket();
});

function renderJourney() {
  const j = state.journey; if (!j) return;
  if (j.kind === 'flight') {
    const f = j.flight, spec = AIRCRAFT[f.craft];
    $('#journeyCard').innerHTML = `<div class="card" style="margin-top:12px;background:#0b1530">
      <b>✈️ ${f.no} · ${f.airline}</b> <span class="muted">${f.from} → ${f.to} · ${fmtDate(j.date)} · ${spec.label} (${spec.layout})</span>
      <div class="fine">Aircraft derived from flight number — exits, wings, lavs drawn below. Tap your seat.</div></div>`;
    $('#mapLegend').innerHTML = `<span><i style="background:#00f0ff"></i>Window</span><span><i style="background:#22c55e"></i>Aisle</span><span><i style="background:#7886a4"></i>Middle</span><span><i style="background:linear-gradient(90deg,#b026ff,#00f0ff)"></i>Yours</span><span>🟡 outline = wanted type</span><span>🟩 outline = live swapper</span>`;
  } else if (j.kind === 'train') {
    const t = j.train;
    $('#journeyCard').innerHTML = `<div class="card" style="margin-top:12px;background:#0b1530">
      <b>🚂 ${t.no} · ${t.name}</b> <span class="muted">${t.from} → ${t.to} · ${fmtDate(j.date)} · ${t.operator}${t.dur ? ' · ' + t.dur : ''}</span>
      <div class="fine">Coach composition from train number${t.rake ? ` (${t.rake} rake)` : ''}. Pick a coach — map redraws with real berth positions.</div></div>`;
    $('#mapLegend').innerHTML = `<span><i style="background:#00f0ff"></i>Lower/Window</span><span><i style="background:#b026ff"></i>Upper</span><span><i style="background:#f59e0b"></i>Middle</span><span><i style="background:#22c55e"></i>Side Lower/Aisle</span><span><i style="background:#fb7185"></i>Side Upper</span><span>Tap a berth = yours · tap again to zoom its bay</span>`;
  } else {
    $('#journeyCard').innerHTML = `<div class="card" style="margin-top:12px">🚌/🎪 <b>${j.custom || 'Custom'}</b> — generic open-saloon map below.</div>`;
    $('#mapLegend').innerHTML = `<span><i style="background:#00f0ff"></i>Window</span><span><i style="background:#22c55e"></i>Aisle</span><span><i style="background:#7886a4"></i>Middle</span>`;
  }
}

/* ---------- map ---------- */
function peersForJourney() {
  const all = store.all();
  if (!state.journey) return [];
  if (state.journey.kind === 'flight') return all.filter(s => s.mode === 'flight' && s.flightNo === state.journey.flight.no).map(s => s.seat);
  if (state.journey.kind === 'train') return all.filter(s => s.mode === 'train' && String(s.trainNo) === String(state.journey.train.no) && s.coach === state.coach).map(s => s.seat);
  return [];
}

function genericSpec() { return COACH_SPECS.CN_2ND; }

function renderMap() {
  const j = state.journey; if (!j) return;
  const peers = peersForJourney();
  if (j.kind === 'flight') {
    $('#mapTitle').textContent = `Cabin map — ${j.flight.no} (${AIRCRAFT[state.craft].label})`;
    $('#coachPills').innerHTML = Object.entries(AIRCRAFT).map(([k, v]) => `<button data-c="${k}" class="${k === state.craft ? 'on' : ''}">${k} · ${v.label}</button>`).join('');
    $('#coachPills').querySelectorAll('button').forEach(b => b.onclick = () => { state.craft = b.dataset.c; renderMap(); });
    renderFlightCabin($('#seatmap'), { craft: state.craft, mine: state.mineFlight, wantedTypes: state.wantTypes, peerSeats: peers, onPick: (id) => { state.mineFlight = id; renderMap(); updateSummary(); } });
    $('#zoombox').hidden = true;
  } else {
    const train = j.kind === 'train' ? j.train : null;
    const specFor = (c) => train ? specOf(train, c) : genericSpec();
    const coaches = train ? train.coaches : ['C1'];
    $('#mapTitle').textContent = train ? `Coach map — ${train.no} ${train.name}` : 'Seat map';
    $('#coachPills').innerHTML = coaches.map(c => {
      const s = specFor(c);
      return `<button data-c="${c}" class="${c === state.coach ? 'on' : ''}">${c} · ${s.short || s.label}</button>`;
    }).join('');
    $('#coachPills').querySelectorAll('button').forEach(b => b.onclick = () => {
      state.coach = b.dataset.c; state.mine = null; state.zoomBay = null;
      const s = specFor(state.coach);
      state.wantTypes = isBerthSpec(s) ? ['LB', 'SL'] : ['W'];
      state.wantSeats = [];
      renderGoals(); renderMap(); updateSummary();
    });
    const spec = specFor(state.coach);
    renderTrainCoach($('#seatmap'), {
      train, coach: state.coach, mine: state.mine, wanted: state.wantSeats, peerSeats,
      highlightBay: state.zoomBay,
      onPick: (n) => {
        state.mine = n;
        state.zoomBay = isBerthSpec(spec) ? bayOfSpec(spec, n) : null;
        renderMap(); updateSummary();
      }
    });
    const zb = $('#zoombox');
    if ((isBerthSpec(spec) && state.zoomBay) || (!isBerthSpec(spec) && state.mine)) {
      zb.hidden = false;
      renderCompartmentZoom(zb, { train, coach: state.coach, bay: state.zoomBay || 1, mine: state.mine, wanted: state.wantSeats });
      zb.querySelectorAll('[data-seat]').forEach(sEl => sEl.onclick = () => {
        const n = parseInt(sEl.dataset.seat, 10);
        const i = state.wantSeats.indexOf(n);
        if (i >= 0) state.wantSeats.splice(i, 1); else state.wantSeats.push(n);
        renderMap(); updateSummary();
      });
    } else zb.hidden = true;
  }
  updateSummary();
}

function renderGoals() {
  const j = state.journey;
  let list;
  if (!j) list = ['LB', 'SL'];
  else if (j.kind === 'flight') list = ['W', 'A', 'M'];
  else {
    const spec = j.kind === 'train' ? specOf(j.train, state.coach) : genericSpec();
    list = isBerthSpec(spec) ? [...new Set(spec.layout)] : ['W', 'A', 'M'];
  }
  $('#goalChips').innerHTML = list.map(t => `<button data-t="${t}" class="${state.wantTypes.includes(t) ? 'on' : ''}">${berthMeta(t).icon} ${t} · ${berthMeta(t).name}</button>`).join('');
  $('#goalChips').querySelectorAll('button').forEach(b => b.onclick = () => {
    const t = b.dataset.t, i = state.wantTypes.indexOf(t);
    if (i >= 0) state.wantTypes.splice(i, 1); else state.wantTypes.push(t);
    renderGoals(); renderMap();
  });
}

function updateSummary() {
  const j = state.journey; if (!j) return;
  if (j.kind === 'flight') {
    const m = state.mineFlight ? flightSeatMeta(state.mineFlight.slice(-1), parseInt(state.mineFlight, 10), state.craft) : null;
    $('#pickSummary').innerHTML = state.mineFlight
      ? `✈️ Yours: <b>${state.mineFlight}</b> · ${m.name}${m.exit ? ' · EXIT legroom' : ''}${m.wing ? ' · over wing' : ''} → want: <b>${state.wantTypes.join(', ') || '—'}</b>`
      : `Tap your current seat on the cabin map, then tap goal types.`;
  } else {
    if (!state.mine) { $('#pickSummary').textContent = 'Tap your current berth on the map, then tap goal types (or tap target seats).'; return; }
    const train = j.kind === 'train' ? j.train : null;
    const desc = train ? describeSeat(train, state.coach, state.mine) : `Seat ${state.mine}`;
    $('#pickSummary').innerHTML = `🚃 Yours: ${desc} → want: <b>${state.wantTypes.join(', ') || state.wantSeats.join(', ') || '—'}</b>${state.wantSeats.length ? ` · target seats ${state.wantSeats.join(', ')}` : ''}`;
  }
}

/* ---------- post ---------- */
$('#postBtn').addEventListener('click', () => {
  if (!state.journey) return toast('Find your journey first');
  const seat = state.journey.kind === 'flight' ? state.mineFlight : state.mine;
  if (!seat) return toast('⚠️ Tap your seat on the map first');
  if (!Wallet.canPost()) {
    const modal = $('#modal');
    modal.innerHTML = `<div class="sheet">${paywallHTML()}<div class="row"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
    modal.hidden = false;
    bindPayButtons(); refreshWallet(); return;
  }
  const pnr = ($('#pnr').value || '').trim();
  if (state.journey.kind === 'train' && pnr && !/^\d{10}$/.test(pnr)) return toast('⚠️ Train PNR is 10 digits (demo validates format)');
  if (state.journey.kind === 'flight' && pnr && !/^[A-Z0-9]{6}$/i.test(pnr)) return toast('⚠️ Flight PNR is 6 characters');
  const rec = state.journey.kind === 'flight'
    ? { id: 'u' + Date.now(), mode: 'flight', flightNo: state.journey.flight.no, craft: state.craft, seat, want: [...state.wantTypes], name: $('#pname').value || 'You', note: $('#pnote').value || '', verified: !!pnr, plus: Wallet.get().plan === 'plus', ts: Date.now(), mine: true }
    : { id: 'u' + Date.now(), mode: 'train', trainNo: state.journey.kind === 'train' ? state.journey.train.no : 'BUS', coach: state.coach, seat, want: [...state.wantTypes], wantSeats: [...state.wantSeats], name: $('#pname').value || 'You', note: $('#pnote').value || '', verified: !!pnr, plus: Wallet.get().plan === 'plus', ts: Date.now(), mine: true };
  store.add(rec); Wallet.consumePost(); refreshWallet(); renderMarket(); renderMap();
  toast('🎉 Swap request live!');
});

$('#previewBtn').addEventListener('click', () => {
  const cands = scoreAll().slice(0, 3);
  const modal = $('#modal');
  modal.innerHTML = `<div class="sheet"><h3>🔮 Top matches for you</h3>${cands.length ? cands.map(c => `<div class="swap"><b>${c.s.name}</b> · ${c.label}<div class="scorebar"><i style="width:${c.score}%"></i></div><small class="muted">${c.why}</small></div>`).join('') : '<p class="muted">No candidates yet — post yours first, others will match.</p>'}<div class="row" style="margin-top:10px"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
  modal.hidden = false;
});

/* ---------- marketplace ---------- */
$('#filters').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('#filters').querySelectorAll('button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); state.filter = b.dataset.f; renderMarket();
});

function mySeatType() {
  const j = state.journey;
  if (!j) return null;
  if (j.kind === 'flight' && state.mineFlight) return flightSeatMeta(state.mineFlight.slice(-1), parseInt(state.mineFlight, 10), state.craft).type;
  if (j.kind === 'train' && state.mine) return berthTypeOf(specOf(j.train, state.coach), state.mine);
  if (state.mine) return berthTypeOf(genericSpec(), state.mine);
  return null;
}

function scoreAll() {
  const all = store.all();
  return all.map(s => {
    let score = 50, why = [], label = '';
    if (state.journey?.kind === 'train' && s.mode === 'train' && String(s.trainNo) === String(state.journey.train.no)) {
      score += 20; why.push('same train');
      const spec = specOf(state.journey.train, s.coach);
      if (s.coach === state.coach && state.mine) {
        const p = proximityLabel(spec, state.mine, s.seat);
        score += p.score * 0.3; why.push(p.txt); label = `${s.coach} · ${s.seat}`;
      } else { if (s.coach !== state.coach) { score += 5; why.push('different coach'); } label = `${s.coach} · ${s.seat}`; }
      const myType = mySeatType();
      if (myType && (s.want || []).includes(myType)) { score += 15; why.push('wants your berth'); }
      if ((s.want || []).some(w => (state.wantTypes || []).includes(w))) { score += 5; }
    } else if (state.journey?.kind === 'flight' && s.mode === 'flight' && s.flightNo === state.journey.flight.no) {
      score += 20; why.push('same flight'); label = s.seat;
      const mt = mySeatType();
      if (mt && (s.want || []).includes(mt)) { score += 15; why.push('wants your seat'); }
    } else {
      label = s.mode === 'flight' ? `${s.flightNo} · ${s.seat}` : `${s.trainNo} · ${s.coach} ${s.seat}`;
      why.push('other journey');
    }
    if (s.verified) { score += 5; why.push('verified'); }
    if (s.plus) { score += 4; }
    if (Date.now() - s.ts < 36e5) { score += 3; why.push('fresh'); }
    return { s, score: Math.min(99, Math.round(score)), why: why.join(' · '), label };
  }).sort((a, b) => b.score - a.score);
}

function renderMarket() {
  let rows = scoreAll();
  if (state.filter === 'verified') rows = rows.filter(r => r.s.verified);
  if (state.filter === 'mine' && state.journey) {
    rows = rows.filter(r => state.journey.kind === 'train' ? (r.s.mode === 'train' && String(r.s.trainNo) === String(state.journey.train.no)) : (r.s.mode === 'flight' && r.s.flightNo === state.journey.flight.no));
  }
  if (state.filter === 'sameCoach' && state.journey?.kind === 'train') rows = rows.filter(r => r.s.coach === state.coach);
  if (state.filter === 'sameBay' && state.journey?.kind === 'train' && state.mine) {
    rows = rows.filter(r => {
      if (r.s.mode !== 'train' || r.s.coach !== state.coach) return false;
      const spec = specOf(state.journey.train, state.coach);
      if (!isBerthSpec(spec)) return Math.abs(r.s.seat - state.mine) <= spec.perRow * 2;
      return bayOfSpec(spec, r.s.seat) === bayOfSpec(spec, state.mine);
    });
  }
  $('#swapList').innerHTML = rows.map(({ s, score, why, label }) => {
    const info = s.mode === 'flight' ? { seat: s.seat, craft: s.craft || 'A20N' } : { train: trainOf(s), coach: s.coach, seat: s.seat };
    return `<div class="swap">
      <div class="top"><b>${s.name}</b>
        ${s.verified ? '<span class="badge ok">✓ verified</span>' : '<span class="badge">unverified</span>'}
        ${s.plus ? '<span class="badge plus">💎 plus</span>' : ''}</div>
      <div class="fine">${s.mode === 'flight' ? '✈️ ' + s.flightNo : '🚂 ' + s.trainNo} · ${label} · wants <b>${(s.want || []).join(', ')}</b></div>
      ${miniMapHTML(s.mode, info)}
      <div class="scorebar"><i style="width:${score}%"></i></div>
      <div class="fine">${score}% · ${why}</div>
      <p class="muted" style="font-size:13px">${s.note || ''}</p>
      <div class="row">
        <button class="btn small primary" data-req="${s.id}">Request swap</button>
        <button class="btn small ghost" data-chat="${s.id}">Chat</button>
        ${s.mine ? '' : '<button class="btn small ghost" data-boost>⬆ Boost</button>'}
      </div></div>`;
  }).join('') || '<p class="muted">No swaps match this filter yet. Post yours — you\'ll be first.</p>';

  $('#swapList').querySelectorAll('[data-req]').forEach(b => b.onclick = () => requestSwap(b.dataset.req));
  $('#swapList').querySelectorAll('[data-chat]').forEach(b => b.onclick = () => openChat(b.dataset.chat));
  $('#swapList').querySelectorAll('[data-boost]').forEach(b => b.onclick = () => checkout('boost', () => {}));
}

function requestSwap(id) {
  const s = store.all().find(x => x.id === id); if (!s) return;
  checkout('reveal', () => {
    const modal = $('#modal');
    modal.innerHTML = `<div class="sheet"><h3>🤝 Swap pass — mutual consent</h3>
      <p>Share with <b>${s.name}</b> at boarding. Both confirm in person; TTE / crew approve.</p>
      <div class="upi-box"><b>${s.mode === 'flight' ? s.flightNo + ' · ' + s.seat : s.trainNo + ' · ' + s.coach + ' ' + s.seat}</b><br/><span class="muted">Template chat only · no seat payments · report misuse</span><div class="qr-fake">▦ SWAP ▦</div></div>
      <div class="row"><button class="btn primary" onclick="document.getElementById('modal').hidden=true">Done</button></div></div>`;
    modal.hidden = false;
  });
}

function openChat(id) {
  const s = store.all().find(x => x.id === id); if (!s) return;
  const modal = $('#modal');
  const tpl = ['Hi! I\'m in the same coach — open to swap? 🙏', 'My berth is {mine}. Yours suits my family — can we exchange?', 'Happy to meet at the door at boarding with ID + ticket.'];
  modal.innerHTML = `<div class="sheet"><h3>💬 Safe chat — ${s.name}</h3><p class="fine">Template-only messages (XchangeSeat model). No phone numbers until both consent.</p>
    ${tpl.map(t => `<button class="btn ghost small" style="margin:4px" data-t="${t}">${t}</button>`).join('')}
    <div class="row" style="margin-top:10px"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
  modal.hidden = false;
  modal.querySelectorAll('[data-t]').forEach(b => b.onclick = () => toast('✉️ Sent (demo)'));
}

/* ---------- monetization UI ---------- */
function refreshWallet() {
  const w = Wallet.get();
  $('#walletPill').textContent = w.plan === 'plus' ? `💎 Plus · ${w.gateway || 'unlimited'}` : `Free · ${Math.max(0, 1 - w.used)} left`;
  let tx = [];
  try { tx = (typeof Payments !== 'undefined' ? Payments.txns() : []).slice(0, 3); } catch {}
  $('#plusPlans').innerHTML = paywallHTML(w.plan === 'plus' ? `✅ Plus active${w.gateway ? ' via ' + w.gateway : ''} — unlimited swaps + priority` : 'Free to swap. Pay to jump the queue.')
    + `<div class="row" style="margin-top:10px">
        <button class="btn ghost small" id="manageSub">Manage subscription</button>
        <button class="btn ghost small" id="billingKeys">⚙ Billing keys</button>
        <span class="fine">${tx.length ? 'Recent: ' + tx.map(t => `${t.gateway}·${t.kind}`).join(', ') : 'No payments yet on this device'}</span>
      </div>`;
  bindPayButtons();
}
function bindPayButtons() {
  document.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const k = b.dataset.pay;
    if (k === 'plus') checkout('plus', () => refreshWallet());
    else if (k === 'plusYearly') checkout('plusYearly', () => refreshWallet());
    else if (k === 'single') checkout('single', () => { const w = Wallet.get(); w.used = Math.max(0, w.used - 1); Wallet.set(w); refreshWallet(); });
    else if (k === 'boost') checkout('boost', () => {});
    else if (k === 'reveal') checkout('reveal', () => {});
  });
  const mp = document.getElementById('manageSub');
  if (mp) mp.onclick = () => Payments.openPortal(() => toast('Portal needs backend + Chargebee keys'));
  const kb = document.getElementById('billingKeys');
  if (kb) kb.onclick = () => Payments.openKeySettings();
}
$('#plusBtn').addEventListener('click', () => { $('#plus').scrollIntoView({ behavior: 'smooth' }); });

/* ---------- PWA ---------- */
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; $('#installBar').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (deferred) { deferred.prompt(); deferred = null; } });
$('#installGo').addEventListener('click', async () => { if (deferred) { deferred.prompt(); deferred = null; } $('#installBar').hidden = true; });
$('#installNo').addEventListener('click', () => $('#installBar').hidden = true);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

/* ---------- init ---------- */
$('#journeyDate').value = new Date().toISOString().slice(0, 10);
refreshWallet(); renderMarket();
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.hidden = true; });
