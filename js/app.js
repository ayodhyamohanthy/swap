/* SwapSeat app controller.
   Product contract (see repo brief): map first, honest states, free matching.
   - Same service instance (mode+no+date+segment) or no match. Ever.
   - Agreement in-app is NOT a reassignment; crew decides.
   - Unknown seats render as unknown, never as free. */
const $ = (s) => document.querySelector(s);
const REQ_TTL = 24 * 36e5;
const NON_PAX_COACH = ['PC'];

const state = {
  mode: 'train',
  journey: null,      // {kind:'train'|'bus', train, date} | {kind:'flight', flight, date}
  coach: null,
  craft: 'A20N',
  busType: 'seater',
  mine: null, mineFlight: null,
  wantTypes: [], wantSeats: [],
  zoomBay: null, filter: 'all',
  group: 1,
};

/* Coach-map modes (train + bus) share one pipeline; flights have cabins. */
function usesCoach(j) { return j && (j.kind === 'train' || j.kind === 'bus'); }
function journeyNo(j) {
  if (!j) return '';
  if (j.kind === 'flight') return j.flight.no;
  return j.train.no;
}

/* Intercity bus as a pseudo-train: operator + service + type resolve to specs.
   (Implementation lives in js/data.js so booking seeds resolve at load time.) */
function busTrain(op, svc, type, from, to) { return busService(op, svc, type, from, to); }
function busTrainFromPost(s) {
  return busTrain(s.busOp, s.busSvc, s.busType, (s.seg || '→').split('→')[0], (s.seg || '→').split('→')[1]);
}

/* ---------- tiny metrics (§13): local funnel counts, no backend ---------- */
const Metrics = {
  log(ev) {
    try {
      const m = JSON.parse(localStorage.getItem('swapseat_metrics') || '{}');
      m[ev] = (m[ev] || 0) + 1;
      localStorage.setItem('swapseat_metrics', JSON.stringify(m));
    } catch {}
  },
  line() {
    try {
      const m = JSON.parse(localStorage.getItem('swapseat_metrics') || '{}');
      const parts = [];
      if (m.map) parts.push(`${m.map} maps`);
      if (m.activate) parts.push(`${m.activate} listings`);
      if (m.request) parts.push(`${m.request} requests`);
      if (m.complete) parts.push(`${m.complete} completed`);
      return parts.length ? 'This device: ' + parts.join(' · ') : '';
    } catch { return ''; }
  }
};

/* ---------- seeds → card shape ---------- */
function normSeed(s) {
  if (s.trainNo || s.flightNo || s.busNo) return s;
  const isBus = s.mode === 'bus';
  return {
    id: s.id, mode: s.mode,
    trainNo: s.mode === 'train' ? s.serviceNo : undefined,
    flightNo: s.mode === 'flight' ? s.serviceNo : undefined,
    busNo: isBus ? s.serviceNo : undefined,
    busOp: s.busOp, busSvc: s.busSvc, busType: s.busType,
    coach: s.coach, seat: s.seat, want: s.want || [], group: s.group || 1,
    name: s.alias || 'Traveller', note: s.note || '',
    verify: s.verify || 0, verified: (s.verify || 0) > 0, plus: !!s.plus,
    ts: Date.now() - ((s.dateOffset || 0) * 864e5),
    date: s.date, seg: s.seg, service: s.service,
    trust: s.trust || null,
  };
}

function dayOfTs(ts) { try { return new Date(ts).toISOString().slice(0, 10); } catch { return ''; } }

const store = {
  all() {
    let local = [];
    try { local = JSON.parse(localStorage.getItem('swapseat_swaps') || '[]'); } catch {}
    local = local.map(s => {
      if (!s.service) {
        const no = s.trainNo || s.busNo || s.flightNo || '';
        s.service = serviceKey(s.mode, no, s.date || dayOfTs(s.ts || Date.now()), s.seg || 'full');
      }
      return s;
    });
    const seeds = (typeof SEED_SWAPS !== 'undefined' ? SEED_SWAPS : []).map(normSeed);
    return [...local, ...seeds];
  },
  add(s) {
    let cur = [];
    try { cur = JSON.parse(localStorage.getItem('swapseat_swaps') || '[]'); } catch {}
    cur.unshift(s); localStorage.setItem('swapseat_swaps', JSON.stringify(cur.slice(0, 60)));
  },
  update(id, patch) {
    let cur = [];
    try { cur = JSON.parse(localStorage.getItem('swapseat_swaps') || '[]'); } catch {}
    cur = cur.map(s => s.id === id ? { ...s, ...patch } : s);
    localStorage.setItem('swapseat_swaps', JSON.stringify(cur.slice(0, 60)));
  }
};

/* ---------- swap requests: open → requested → accepted → crew → completed ---------- */
const reqStore = {
  all() { try { return JSON.parse(localStorage.getItem('swapseat_reqs') || '[]'); } catch { return []; } },
  save(a) { localStorage.setItem('swapseat_reqs', JSON.stringify(a.slice(0, 60))); },
  add(r) { const a = this.all(); a.unshift(r); this.save(a); },
  update(id, patch) { this.save(this.all().map(r => r.id === id ? { ...r, ...patch, upd: Date.now() } : r)); },
  forSwap(swapId) { return this.all().find(r => r.swapId === swapId && !['cancelled', 'declined', 'expired'].includes(r.state)); },
};
function expireSweep() {
  const now = Date.now();
  let changed = false;
  reqStore.save(reqStore.all().map(r => {
    if ((r.state === 'requested' || r.state === 'accepted') && r.expires && r.expires < now) { changed = true; return { ...r, state: 'expired', upd: now }; }
    return r;
  }));
  return changed;
}

/* ---------- blocks / reports ---------- */
function blocks() { try { return JSON.parse(localStorage.getItem('swapseat_blocks') || '[]'); } catch { return []; } }
function isBlocked(id) { return blocks().some(b => b.id === id); }

/* ---------- journey helpers ---------- */
function fmtDate(d) { try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } }
function trainOf(swap) {
  if (swap.mode === 'bus') return busTrainFromPost(swap);
  return TRAIN_INDEX[String(swap.trainNo)] || GENERIC_TRAIN;
}
function modeIcon(mode) { return mode === 'flight' ? '✈️' : mode === 'bus' ? '🚌' : '🚂'; }
function serviceNoOf(swap) { return swap.trainNo || swap.busNo || swap.flightNo || ''; }
function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 6e4));
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
function leftIn(expires) {
  const ms = Math.max(0, expires - Date.now());
  const h = Math.floor(ms / 36e5), m = Math.round((ms % 36e5) / 6e4);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
function currentSeg() {
  const f = ($('#segFrom')?.value || '').trim().toUpperCase();
  const t = ($('#segTo')?.value || '').trim().toUpperCase();
  if (f && t) return `${f}→${t}`;
  const j = state.journey;
  if (usesCoach(j)) return `${j.train.from}→${j.train.to}`;
  if (j?.kind === 'flight') return `${j.flight.from}→${j.flight.to}`;
  return 'full';
}
function myService() {
  const j = state.journey;
  if (!j) return null;
  const no = usesCoach(j) ? j.train.no : j.flight.no;
  return serviceKey(j.kind, no, j.date, currentSeg());
}
function vBadge(v) {
  const L = verifyLevel(v || 0);
  return `<span class="badge v${L.level}" title="${L.blurb}">${L.icon} ${L.label}</span>`;
}
function online() { return navigator.onLine !== false; }

/* ---------- mode tabs ---------- */
document.querySelectorAll('.mode-tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.mode-tabs button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); state.mode = b.dataset.mode;
  const isBus = state.mode === 'bus', isFlight = state.mode === 'flight';
  $('#numField label').textContent = isFlight ? 'Flight number' : isBus ? 'Bus service no.' : 'Train number';
  $('#journeyNo').placeholder = isFlight ? 'e.g. 6E2031' : isBus ? 'e.g. HYD-BLR-042' : 'e.g. 12951 Rajdhani';
  $('#journeyNo').value = isFlight ? '6E2031' : isBus ? '' : '12951';
  $('#journeyNo').inputMode = isFlight ? 'text' : isBus ? 'text' : 'numeric';
  $('#busRow').hidden = !isBus;
  $('#busTypeRow').hidden = !isBus;
}));
document.querySelectorAll('#busTypeRow button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#busTypeRow button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); state.busType = b.dataset.bt;
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

function findFlight(no) {
  if (FLIGHT_INDEX[no]) return { ...FLIGHT_INDEX[no], resolved: true };
  const pre = (no.match(/^[A-Z0-9]+/) || [''])[0];
  const hit = (typeof AIRLINE_PREFIX !== 'undefined') && (AIRLINE_PREFIX[pre.slice(0, 2)] || AIRLINE_PREFIX[pre]);
  if (hit) return { no, airline: hit.airline, from: '···', to: '···', craft: hit.craft, country: 'GLOBAL', illustrative: true, resolved: false };
  return { no: no || 'XX000', airline: 'Custom airline', from: '···', to: '···', craft: 'A20N', country: 'GLOBAL', illustrative: true, resolved: false };
}

$('#lookupBtn').addEventListener('click', () => {
  const no = ($('#journeyNo').value || '').trim().toUpperCase().replace(/\s+/g, '');
  const date = $('#journeyDate').value || new Date().toISOString().slice(0, 10);
  if (state.mode === 'flight') {
    const f = findFlight(no);
    state.journey = { kind: 'flight', flight: f, date };
    state.craft = f.craft; state.mineFlight = null; state.wantTypes = ['W'];
    $('#segFrom').value = f.from; $('#segTo').value = f.to;
    Metrics.log('lookup'); Metrics.log(f.resolved ? 'resolved' : 'generic');
  } else if (state.mode === 'train') {
    const t = findTrain(no) || { ...GENERIC_TRAIN, no: no || '00000' };
    state.journey = { kind: 'train', train: t, date };
    /* Open on the roomiest passenger coach — for most Indian trains that is the
       sleeper/3A coach people actually swap in, not the 24-berth AC First cabin.
       The coach pills let the traveller move anywhere. */
    const pax = t.coaches.filter((c) => !NON_PAX_COACH.includes(c));
    state.coach = pax.slice().sort((a, b) => specOf(t, b).seats - specOf(t, a).seats)[0] || t.coaches[0];
    const spec = specOf(t, state.coach);
    state.mine = null;
    state.wantTypes = isBerthSpec(spec) ? ['LB', 'SL'] : ['W'];
    state.wantSeats = []; state.zoomBay = null;
    $('#segFrom').value = t.from; $('#segTo').value = t.to;
  } else if (state.mode === 'bus') {
    let op = ($('#busOp').value || '').trim();
    let svc = no;
    const cut = no.indexOf(':');
    if (!op && cut > 0) { op = no.slice(0, cut); svc = no.slice(cut + 1).split('@')[0]; }
    const t = busTrain(op, svc, state.busType,
      $('#segFrom').value || 'SRC', $('#segTo').value || 'DST');
    const tim = ($('#busTime').value || '').trim();
    if (tim) t.no += `@${tim}`;
    state.journey = { kind: 'bus', train: t, date };
    state.coach = t.coaches[0];
    state.mine = null;
    state.wantTypes = ['W'];
    state.wantSeats = []; state.zoomBay = null;
    Metrics.log('lookup'); Metrics.log('expected');
  } else {
    state.journey = { kind: 'bus', train: busTrain('', no, 'seater', '', ''), date };
    state.coach = 'S'; state.mine = null; state.wantTypes = ['W']; state.wantSeats = [];
    Metrics.log('lookup'); Metrics.log('generic');
  }
  if (usesCoach(state.journey)) {
    Metrics.log('lookup');
    Metrics.log(state.journey.train.operator === 'Unknown operator' ? 'generic' : (state.journey.kind === 'bus' ? 'expected' : 'resolved'));
  }
  Metrics.log('map');
  renderJourney(); renderGoals(); renderMap();
  $('#mapSection').hidden = false; $('#postSection').hidden = false;
  $('#mapSection').scrollIntoView({ behavior: 'smooth' });
  renderMarket();
});

function renderJourney() {
  const j = state.journey; if (!j) return;
  if (j.kind === 'flight') {
    const f = j.flight, spec = AIRCRAFT[f.craft];
    const cabins = (spec.sections || []).map(s => s.name).join(' + ');
    $('#journeyCard').innerHTML = `<div class="card" style="margin-top:12px;background:#0b1530">
      <b>✈️ ${f.no} · ${f.airline}</b> <span class="muted">${f.from} → ${f.to} · ${fmtDate(j.date)} · ${spec.label} (${cabins})</span>
      <div class="fine">Your segment: <b>${currentSeg()}</b> · Aircraft from flight number — exits, wings, lavs below. Tap your seat. Crew approval is always required for moves.</div></div>`;
    $('#mapLegend').innerHTML = stateLegendHTML([
      { cls: 'lg-w', icon: '🪟', text: 'Window' },
      { cls: 'lg-a', icon: '🚶', text: 'Aisle' },
      { cls: 'lg-m', icon: '💺', text: 'Middle' },
      { cls: 'lg-exit', icon: '', text: 'Exit row — extra legroom, crew rules apply' },
    ]);
  } else if (usesCoach(j)) {
    const t = j.train, bus = j.kind === 'bus', icon = bus ? '🚌' : '🚂';
    $('#journeyCard').innerHTML = `<div class="card" style="margin-top:12px;background:#0b1530">
      <b>${icon} ${t.no} · ${t.name}</b> <span class="muted">${t.from} → ${t.to} · ${fmtDate(j.date)} · ${t.operator}${t.dur ? ' · ' + t.dur : ''}</span>
      <div class="fine">Your segment: <b>${currentSeg()}</b> · ${bus ? 'Layout from vehicle type — confirm the deck on board' : `Coach composition from train number${t.rake ? ` (${t.rake} rake)` : ''}`}. Pick a ${bus ? 'deck' : 'coach'} — map redraws below.</div></div>`;
    const spec0 = specOf(t, t.coaches.filter(c => !NON_PAX_COACH.includes(c))[0] || t.coaches[0]);
    const chair = !isBerthSpec(spec0);
    $('#mapLegend').innerHTML = chair ? stateLegendHTML([
      { cls: 'lg-w', icon: '🪟', text: 'Window' },
      { cls: 'lg-a', icon: '🚶', text: 'Aisle' },
      { cls: 'lg-m', icon: '💺', text: 'Middle' },
    ]) : stateLegendHTML([
      { cls: 'lg-lb', icon: '🛏️', text: 'Lower / window' },
      { cls: 'lg-mb', icon: '🛏️', text: 'Middle — folds away by day' },
      { cls: 'lg-ub', icon: '🛏️', text: 'Upper — private' },
      { cls: 'lg-sl', icon: '💺', text: 'Side berth — lengthwise on the corridor' },
    ]) + '<span class="lg lg-hint">Tap a berth = yours · its bay cross-section opens below</span>';
  } else {
    $('#journeyCard').innerHTML = `<div class="card" style="margin-top:12px">🚌 <b>Custom service</b> — generic open-saloon map below.</div>`;
    $('#mapLegend').innerHTML = `<span><i style="background:#00f0ff"></i>Window</span><span><i style="background:#22c55e"></i>Aisle</span><span><i style="background:#7886a4"></i>Middle</span>`;
  }
}

/* ---------- map ---------- */
function peersForJourney() {
  const all = store.all();
  if (!state.journey) return [];
  const svc = myService();
  if (state.journey.kind === 'flight') return all.filter(s => s.mode === 'flight' && s.service && svc && s.service === svc).map(s => s.seat);
  if (usesCoach(state.journey)) return all.filter(s => s.mode === state.journey.kind && s.service && svc && s.service === svc && s.coach === state.coach).map(s => s.seat);
  return [];
}

function genericSpec() { return COACH_SPECS.CN_2ND; }

function renderMap() {
  const j = state.journey; if (!j) return;
  const peers = peersForJourney();
  if (j.kind === 'flight') {
    $('#mapTitle').textContent = `Cabin map — ${j.flight.no} (${AIRCRAFT[state.craft].label})`;
    $('#coachPills').innerHTML = Object.entries(AIRCRAFT).map(([k, v]) => `<button data-c="${k}" class="${k === state.craft ? 'on' : ''}" aria-pressed="${k === state.craft}">${k} · ${v.label} · ${v.seats}</button>`).join('');
    $('#coachPills').querySelectorAll('button').forEach(b => b.onclick = () => { state.craft = b.dataset.c; renderMap(); });
    renderFlightCabin($('#seatmap'), { craft: state.craft, flight: j.flight, mine: state.mineFlight, wantedTypes: state.wantTypes, peerSeats: peers, onPick: (id) => { state.mineFlight = id; renderMap(); updateSummary(); renderMarket(); } });
    $('#zoombox').hidden = true;
    $('#mapList').innerHTML = mapListHTML(null, null, state.craft);
  } else {
    const train = usesCoach(j) ? j.train : null;
    const specFor = (c) => train ? specOf(train, c) : genericSpec();
    const coaches = (train ? train.coaches : ['C1']).filter(c => !NON_PAX_COACH.includes(c));
    $('#mapTitle').textContent = train ? `Coach map — ${train.no} ${train.name}` : 'Seat map';
    $('#coachPills').innerHTML = coaches.map(c => {
      const s = specFor(c);
      return `<button data-c="${c}" class="${c === state.coach ? 'on' : ''}" aria-pressed="${c === state.coach}">${c} · ${s.short || s.label}</button>`;
    }).join('') + (train && train.coaches.some(c => NON_PAX_COACH.includes(c)) ? `<span class="fine">Pantry car excluded — no berths to swap.</span>` : '');
    $('#coachPills').querySelectorAll('button').forEach(b => b.onclick = () => {
      state.coach = b.dataset.c; state.mine = null; state.zoomBay = null;
      const s = specFor(state.coach);
      state.wantTypes = isBerthSpec(s) ? ['LB', 'SL'] : ['W'];
      state.wantSeats = [];
      renderGoals(); renderMap(); updateSummary();
      renderMarket();          // proximity ranking depends on the coach you are in
    });
    const spec = specFor(state.coach);
    renderTrainCoach($('#seatmap'), {
      train, coach: state.coach, mine: state.mine, wanted: state.wantSeats, peerSeats: peers,
      highlightBay: state.zoomBay,
      onPick: (n) => {
        state.mine = n;
        state.zoomBay = isBerthSpec(spec) ? bayOfSpec(spec, n) : null;
        renderMap(); updateSummary();
        renderMarket();          // re-rank: now we know where you actually are
      }
    });
    $('#mapList').innerHTML = mapListHTML(train, state.coach, null);
    const zb = $('#zoombox');
    if ((isBerthSpec(spec) && state.zoomBay) || (!isBerthSpec(spec) && state.mine)) {
      zb.hidden = false;
      renderCompartmentZoom(zb, { train, coach: state.coach, bay: state.zoomBay || 1, mine: state.mine, wanted: state.wantSeats });
      // The elevation is the honest answer to "which berth, in which bay, at what
      // height" — rows are levels, columns are the two facing benches + the side pair.
      if (isBerthSpec(spec)) {
        mountElevation(zb, {
          train, coach: state.coach, bay: state.zoomBay || 1,
          mine: state.mine, wanted: state.wantSeats, peerSeats: peers,
          onPick: (n) => {
            const i = state.wantSeats.indexOf(n);
            if (i >= 0) state.wantSeats.splice(i, 1); else state.wantSeats.push(n);
            renderMap(); updateSummary();
          },
        });
      }
      zb.querySelectorAll('[data-seat]').forEach(sEl => sEl.onclick = () => {
        const n = parseInt(sEl.dataset.seat, 10);
        const i = state.wantSeats.indexOf(n);
        if (i >= 0) state.wantSeats.splice(i, 1); else state.wantSeats.push(n);
        renderMap(); updateSummary();
      });
    } else zb.hidden = true;
  }
  updateSummary();
  syncWatchBtn();
}

function renderGoals() {
  const j = state.journey;
  let list;
  if (!j) list = ['LB', 'SL'];
  else if (j.kind === 'flight') list = ['W', 'A', 'M'];
  else {
    const spec = usesCoach(j) ? specOf(j.train, state.coach) : genericSpec();
    list = isBerthSpec(spec) ? [...new Set(spec.layout)] : ['W', 'A', 'M'];
  }
  const extra = `<button data-t="TOGETHER" class="${state.wantTypes.includes('TOGETHER') ? 'on' : ''}">👨‍👩‍👧 TOGETHER · sit together</button>`;
  $('#goalChips').innerHTML = list.map(t => `<button data-t="${t}" class="${state.wantTypes.includes(t) ? 'on' : ''}" aria-pressed="${state.wantTypes.includes(t)}">${seatDisplay(t).icon} ${t} · ${seatDisplay(t).name}</button>`).join('') + extra;
  $('#goalChips').querySelectorAll('button').forEach(b => b.onclick = () => {
    const t = b.dataset.t, i = state.wantTypes.indexOf(t);
    if (i >= 0) state.wantTypes.splice(i, 1); else state.wantTypes.push(t);
    renderGoals(); renderMap();
  });
}

function myPosition() {
  const j = state.journey;
  if (!j) return null;
  if (j.kind === 'flight' && state.mineFlight) return flightSeatInfo(state.craft, state.mineFlight);
  if (usesCoach(j) && state.mine) return trainPosition(j.train, state.coach, state.mine);
  if (state.mine) return trainPosition({ ...GENERIC_TRAIN, coaches: ['C1'], specs: { C1: 'CN_2ND' } }, 'C1', state.mine);
  return null;
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
    const train = usesCoach(j) ? j.train : null;
    const desc = train ? describeSeat(train, state.coach, state.mine) : `Seat ${state.mine}`;
    $('#pickSummary').innerHTML = `${modeIcon(j.kind)} Yours: ${desc} → want: <b>${state.wantTypes.join(', ') || state.wantSeats.join(', ') || '—'}</b>${state.wantSeats.length ? ` · target seats ${state.wantSeats.join(', ')}` : ''}`;
  }
}

/* ---------- post ---------- */
$('#postBtn').addEventListener('click', () => {
  if (!online()) return toast('⚠️ You are offline — listings need a connection.');
  if (!state.journey) return toast('Find your journey first');
  const seat = state.journey.kind === 'flight' ? state.mineFlight : state.mine;
  if (!seat) return toast('⚠️ Tap your seat on the map first');
  if (!Wallet.canPost()) {
    const modal = $('#modal');
    modal.innerHTML = `<div class="sheet">${paywallHTML(`Free plan covers ${MONETIZE.freeListings} active listings`)}<div class="row"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
    modal.hidden = false;
    bindPayButtons(); refreshWallet(); return;
  }
  const group = Math.max(1, Math.min(6, parseInt($('#pgroup').value, 10) || 1));
  if (group > 1 && Wallet.get().plan !== 'plus') {
    checkout('trip', () => doPost(group));
    return;
  }
  doPost(group);
});

function doPost(group) {
  const pnr = ($('#pnr').value || '').trim();
  if (state.journey.kind === 'train' && pnr && !/^\d{10}$/.test(pnr)) return toast('⚠️ Train PNR is 10 digits (demo validates format)');
  if (state.journey.kind === 'flight' && pnr && !/^[A-Z0-9]{6}$/i.test(pnr)) return toast('⚠️ Flight PNR is 6 characters');
  const j = state.journey;
  const no = usesCoach(j) ? j.train.no : j.flight.no;
  const seg = currentSeg();
  const rec = {
    id: 'u' + Date.now(), mode: j.kind,
    trainNo: j.kind === 'train' ? no : undefined,
    busNo: j.kind === 'bus' ? no : undefined,
    busOp: j.kind === 'bus' ? ($('#busOp').value || '').trim() : undefined,
    busSvc: j.kind === 'bus' ? ($('#journeyNo').value || '').trim().toUpperCase() : undefined,
    busType: j.kind === 'bus' ? state.busType : undefined,
    flightNo: j.kind === 'flight' ? no : undefined,
    coach: state.coach, craft: state.craft,
    seat: j.kind === 'flight' ? state.mineFlight : state.mine,
    want: [...state.wantTypes], wantSeats: [...state.wantSeats], group: group || 1,
    name: $('#pname').value || 'You', note: $('#pnote').value || '',
    verify: pnr ? 1 : 0, verified: !!pnr, plus: Wallet.get().plan === 'plus',
    ts: Date.now(), date: j.date, seg, service: serviceKey(j.kind, no, j.date, seg),
    state: 'open', mine: true,
  };
  store.add(rec);
  const w = Wallet.get();
  w.household = { name: rec.name, want: rec.want };
  Wallet.set(w);
  Metrics.log('activate');
  refreshWallet(); renderMarket(); renderMap(); renderInbox();
  toast(group > 1 ? `🎉 Group listing live for ${group} travellers!` : '🎉 Swap request live!');
}

$('#previewBtn').addEventListener('click', () => {
  const cands = scoreAll().slice(0, 3);
  const modal = $('#modal');
  modal.innerHTML = `<div class="sheet"><h3>🔮 Top matches for you</h3>${cands.length ? cands.map(c => swapCardHTML(c, true)).join('') : '<p class="muted">No candidates on this exact service + date yet — post yours first.</p>'}<div class="row" style="margin-top:10px"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
  modal.hidden = false;
  wireCards(modal);
});

/* ---------- matching: same service instance, or nothing ---------- */
$('#filters').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('#filters').querySelectorAll('button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); state.filter = b.dataset.f; renderMarket();
});

function mySeatType() {
  const p = myPosition();
  if (!p) return null;
  return p.berth || ({ window: 'W', aisle: 'A', middle: 'M' })[p.position] || p.position;
}

function candPosition(s) {
  if (s.mode === 'flight') return flightSeatInfo(s.craft || state.craft || 'A20N', s.seat);
  return trainPosition(trainOf(s), s.coach, s.seat);
}

function scoreAll() {
  const svc = myService();
  const mine = svc ? store.all().filter(s =>
    s.service === svc && !isBlocked(s.id) && (s.state || 'open') === 'open' && !s.mine) : [];
  const me = myPosition();
  return mine.map(s => {
    let score = 50, why = [];
    const label = s.mode === 'flight' ? s.seat : `${s.coach} · ${s.seat}`;
    // 1 · groups together
    const myGroup = state.group || 1;
    if ((myGroup > 1 || state.wantTypes.includes('TOGETHER')) && (s.group || 1) > 1) { score += 12; why.push('group ↔ group'); }
    else if (state.wantTypes.includes('TOGETHER') || (s.want || []).includes('TOGETHER')) { score += 6; why.push('wants together'); }
    // 2 · mutual improvement, in words
    const cp = candPosition(s);
    if (me && cp) {
      const g = swapGain(me, cp);
      if (g.delta > 0) { score += Math.min(15, Math.round(g.delta / 2)); why.push(g.why.slice(0, 2).join('; ') || 'better fit'); }
      const back = swapGain(cp, me);
      if ((s.want || []).some(w => {
        const t = mySeatType();
        return t && w === t;
      })) { score += 12; why.push('wants your seat'); }
      else if (back.delta > 0) { score += 4; why.push('also better for them'); }
    }
    // 3 · walking distance
    if (me && cp && s.mode !== 'flight' && usesCoach(state.journey) && s.mode === state.journey.kind && s.coach === state.coach && state.mine) {
      const p = proximityLabel(specOf(state.journey.train, s.coach), state.mine, s.seat);
      score += p.score * 0.25; why.push(p.txt);
    } else if (s.coach && s.coach !== state.coach) { score += 3; why.push('different coach'); }
    if (s.mode === 'flight' && me && cp && me.row && cp.row) {
      const d = Math.abs(me.row - cp.row);
      if (d === 0) { score += 20; why.push('same row'); }
      else { score += Math.max(0, 10 - d); why.push(d + (d === 1 ? ' row away' : ' rows away')); }
    }
    // 4 · verification confidence
    const v = verifyLevel(s.verify || 0);
    if (v.level === 2) { score += 6; why.push('operator verified'); }
    else if (v.level === 1) { score += 4; why.push('evidence checked'); }
    if (s.plus) { score += 2; }
    if (Date.now() - s.ts < 36e5) { score += 2; why.push('fresh'); }
    return { s, cp, score: Math.min(99, Math.round(score)), why: why.join(' · ') || 'same service', label };
  }).sort((a, b) => b.score - a.score);
}

/* ---------- marketplace cards ---------- */
/* Exact numbers only for your own posts or unlocked swaps — everyone else is
   approximate until payment conditions are satisfied (spec: seat privacy). */
function seatLineHTML(s) {
  if (s.mine) {
    const info = s.mode === 'flight' ? { seat: s.seat, craft: s.craft || 'A20N' } : { train: trainOf(s), coach: s.coach, seat: s.seat };
    return miniMapHTML(s.mode, info);
  }
  const req = reqStore.forSwap(s.id);
  if (req && Policy.revealState(req, s).unlocked) {
    const info = s.mode === 'flight' ? { seat: s.seat, craft: s.craft || 'A20N' } : { train: trainOf(s), coach: s.coach, seat: s.seat };
    return miniMapHTML(s.mode, info) + `<div class="fine">🔓 ${confirmationId(req)}</div>`;
  }
  return `<div class="mini">🔒 <b>Approximate position</b> · ${approxSeat(s)}<br/><span class="fine">Exact seat unlocks after payment — never shown before.</span></div>`;
}

function searchGateHTML(svc, count) {
  const f = Policy.fees();
  return `<div class="swap"><div class="top"><b>🔍 Matching locked</b></div>
    <p class="muted" style="font-size:13.5px">Pay <b>₹${f.SEARCH_FEE}</b> once to activate matching for this service. Not a booking fee — if no suitable match is found, ₹${f.SEARCH_FEE} becomes <b>wallet credit</b> automatically.</p>
    <div class="row"><button class="btn primary small" id="paySearch" data-online>Pay ₹${f.SEARCH_FEE} · activate matching</button></div>
    <p class="fine">Pricing is configurable server-side and shown before you pay. ${count} traveller${count === 1 ? '' : 's'} waiting on this service.</p></div>`;
}

function noMatchHTML(svc) {
  const j = state.journey;
  const no = journeyNo(j);
  const seg = currentSeg();
  const invite = buildInvite() || location.href;
  const text = `I'm looking to swap my seat on ${no} from ${seg}. If you're travelling on the same service, let me know: ${invite}`;
  const enc = encodeURIComponent(text);
  return `<div class="swap"><div class="top"><b>😶 No match yet</b><span class="badge">₹49 wallet credited</span></div>
    <p class="muted" style="font-size:13.5px">Nobody compatible on this service right now. Your ₹49 search fee is now <b>wallet credit</b> for a future search — and more travellers join closer to departure.</p>
    <p class="muted" style="font-size:13.5px"><b>Need more matches?</b> Invite your co-passengers:</p>
    <div class="row">
      <a class="btn small ghost" href="https://wa.me/?text=${enc}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn small ghost" href="https://twitter.com/intent/tweet?text=${enc}" target="_blank" rel="noopener">X</a>
      <a class="btn small ghost" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(invite)}" target="_blank" rel="noopener">Facebook</a>
      <button class="btn small ghost" id="copyShare">Copy link</button>
    </div>
    <p class="fine">We'll keep watching — enable Watch service above for new-traveller alerts.</p></div>`;
}
function swapCardHTML({ s, cp, score, why, label }, inModal) {
  const info = s.mode === 'flight' ? { seat: s.seat, craft: s.craft || 'A20N' } : { train: trainOf(s), coach: s.coach, seat: s.seat };
  const req = reqStore.forSwap(s.id);
  const v = verifyLevel(s.verify || 0);
  const unlocked = !!(s.mine || (req && Policy.revealState(req, s).unlocked));
  return `<div class="swap">
    <div class="top"><b>${s.name}</b>${vBadge(v.level)}${s.plus ? '<span class="badge plus">💎 plus</span>' : ''}${(s.group || 1) > 1 ? `<span class="badge">👥 ${s.group}</span>` : ''}</div>
    <div class="fine">${modeIcon(s.mode)} ${serviceNoOf(s)} · ${unlocked ? label : 'position below'} · ${fmtDate(s.date || s.ts)} · wants <b>${(s.want || []).map(w => (typeof wantLabel !== 'undefined' ? wantLabel(w) : w)).join(', ')}</b></div>
    ${seatLineHTML(s)}
    <div class="scorebar" aria-hidden="true"><i style="width:${score}%"></i></div>
    <div class="fine">${score}% · ${why}</div>
    <p class="muted" style="font-size:13px">${s.note || ''}</p>
    <div class="row">
      ${req ? `<span class="badge st-${req.state}">${(typeof swapState !== 'undefined' ? swapState(req.state) : { label: req.state }).label}${req.expires ? ' · ' + leftIn(req.expires) : ''}</span>
        <button class="btn small ghost" data-preview="${s.id}">Details</button>`
        : `<button class="btn small primary" data-preview="${s.id}">Preview swap</button>
           <button class="btn small ghost" data-chat="${s.id}" data-online>Chat</button>`}
      ${s.mine ? '' : `<button class="btn small ghost" data-boost>⬆ Boost</button>
        <button class="btn small ghost" data-report="${s.id}" title="Report inaccurate seat or abuse">⚑</button>`}
    </div></div>`;
}

function renderMarket() {
  let rows = scoreAll();
  if (state.filter === 'verified') rows = rows.filter(r => (r.s.verify || 0) > 0);
  if (state.filter === 'sameCoach' && usesCoach(state.journey)) rows = rows.filter(r => r.s.coach === state.coach);
  if (state.filter === 'sameBay' && usesCoach(state.journey) && state.mine) {
    rows = rows.filter(r => {
      if (r.s.mode === 'flight' || r.s.coach !== state.coach) return false;
      const spec = specOf(state.journey.train, state.coach);
      if (!isBerthSpec(spec)) return Math.abs(r.s.seat - state.mine) <= spec.perRow * 2;
      return bayOfSpec(spec, r.s.seat) === bayOfSpec(spec, state.mine);
    });
  }
  const svc = myService();
  // Search gate: matching activates per service after the search fee (Policy).
  if (svc && !Policy.hasPaidSearch(svc)) {
    $('#swapList').innerHTML = searchGateHTML(svc, rows.length);
    const pb = document.getElementById('paySearch');
    if (pb) pb.onclick = () => {
      if (!online()) return toast('⚠️ Payments need a connection.');
      checkout('search', (res) => {
        Policy.markSearchPaid(svc, res?.id || res?.razorpay_payment_id || res?.orderID);
        Metrics.log('paywall_viewed');
        renderMarket();
        toast('🔍 Matching active for this service.');
      });
    };
    updateOnlineUI();
    const el = $('#marketStamp');
    if (el) { el.dataset.ts = Date.now(); el.textContent = 'updated just now'; }
    return;
  }
  if (svc && rows.length === 0) {
    if (!Policy.wasCredited(svc)) {
      const f = Policy.fees();
      Wallet.credit(f.SEARCH_FEE, 'No match — search refund');
      Policy.markCredited(svc);
      Metrics.log('nomatch_credit');
      renderWalletBox();
    }
    $('#swapList').innerHTML = noMatchHTML(svc);
    const cp = document.getElementById('copyShare');
    if (cp) cp.onclick = async () => {
      try { await navigator.clipboard.writeText(buildInvite() || location.href); toast('🔗 Link copied.'); }
      catch { toast('Copy this page URL to share.'); }
    };
    wireCards($('#swapList'));
  } else {
    $('#swapList').innerHTML = rows.map(c => swapCardHTML(c, false)).join('')
      || `<p class="muted">${svc ? 'No travellers on this exact service + date yet. Post yours — you’ll be first.' : 'Look up your journey to see who is on it.'}</p>`;
    wireCards($('#swapList'));
  }
  const el = $('#marketStamp');
  if (el) { el.dataset.ts = Date.now(); el.textContent = 'updated just now'; }
  Metrics.log('market');
  if (rows.length > 0) Metrics.log('covered');
  checkWatches(rows.map(r => r.s.id));
  renderFunnel();
}

function wireCards(root) {
  root.querySelectorAll('[data-preview]').forEach(b => b.onclick = () => openSwapPreview(b.dataset.preview));
  root.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => openChat(b.dataset.chat));
  root.querySelectorAll('[data-report]').forEach(b => b.onclick = () => openReport(b.dataset.report));
  root.querySelectorAll('[data-boost]').forEach(b => b.onclick = () => {
    if (Wallet.useBoost()) { toast('⬆ Boosted for 24h (1 credit used)'); renderMarket(); }
    else checkout('boost', () => renderMarket());
  });
}

/* ---------- swap preview: approximate until protected, exact after ---------- */
function openSwapPreview(id) {
  const svc = myService();
  if (svc && !Policy.hasPaidSearch(svc)) {
    renderMarket();
    $('#market').scrollIntoView({ behavior: 'smooth' });
    return toast('🔍 Activate matching first (₹49 search fee).');
  }
  const s = store.all().find(x => x.id === id); if (!s) return;
  const me = myPosition();
  const cp = candPosition(s);
  const gain = (me && cp) ? swapGain(me, cp) : { delta: 0, better: [], worse: [], why: [] };
  const myLabel = me ? (me.kind === 'flight' ? me.id : `${state.coach} · ${state.mine} (${me.berth || me.position})`) : 'your seat';
  const req = reqStore.forSwap(s.id);
  const rev = req ? Policy.revealState(req, s) : { unlocked: false, reason: 'no-request' };
  const needCrew = s.mode === 'flight' || (cp && (cp.exitRow || cp.sectionName === 'Business'));
  const needTTE = s.mode === 'train' && cp && cp.spec && cp.spec.cabin;
  const needDriver = s.mode === 'bus';
  const modal = $('#modal');
  modal.innerHTML = `<div class="sheet">
    <div class="eyebrow">Swap preview · ${modeIcon(s.mode)} ${serviceNoOf(s)} · ${fmtDate(s.date || s.ts)}</div>
    <h3>YOUR MOVE<br/><span class="grad">${myLabel} → ${rev.unlocked ? (s.mode === 'flight' ? s.seat : `${s.coach} · ${s.seat}`) : 'a compatible seat'}</span></h3>
    ${gain.why.length ? `<ul class="gains">${gain.why.map(g => `<li>${g.startsWith('moves you up') || g.startsWith('into the corridor') || g.startsWith('gives up') ? '⚠️ ' : '✅ '}${g}</li>`).join('')}</ul>`
      : '<p class="muted">Sideways move — similar comfort, closer to your group.</p>'}
    <div class="pv-cols">
      <div><div class="eyebrow">Your seat</div>${me ? `<p class="muted" style="font-size:13px">${me.title}<br/>${me.blurb || ''}</p>` : ''}</div>
      <div><div class="eyebrow">Their seat ${vBadge(s.verify || 0)}</div>
        ${seatLineHTML(s)}
        <p class="muted" style="font-size:13px">${cp ? (cp.blurb || cp.title) : ''}</p></div>
    </div>
    ${rev.unlocked ? `<div class="upi-box"><b>🔓 Seats unlocked · ${confirmationId(req)}</b><br/>Yours: <b>${myLabel}</b> · Theirs: <b>${s.mode === 'flight' ? s.seat : `${s.coach} · ${s.seat}`}</b><br/><span class="muted">Original → new seats, ${modeIcon(s.mode)} ${serviceNoOf(s)}, ${fmtDate(s.date || s.ts)}.</span></div>` : ''}
    ${req && req.state === 'accepted' && Policy.completionFeeDue(req, s) ? `<div class="upi-box"><b>₹${Policy.fees().ONE_SIDED_SWAP_FEE} to complete</b><br/><span class="muted">They never paid a search fee, so the completion fee applies. Exact seats unlock on payment.</span><div class="row" style="margin-top:8px"><button class="btn primary small" id="pvComplete">Pay ₹${Policy.fees().ONE_SIDED_SWAP_FEE}</button></div></div>` : ''}
    <p class="fine">⚠️ Agreement here is <b>not</b> a seat reassignment.${needCrew ? ' <b>Cabin crew approval required</b> — passenger agreement alone does not authorize moving.' : ''}${needTTE ? ' <b>TTE approval required</b> for 1A cabins.' : ''}${needDriver ? ' Coordinate with the driver/conductor at boarding.' : ''} Requests expire after 24h.</p>
    <div class="row">
      ${req ? `<span class="badge st-${req.state}">${swapState(req.state).label}</span>`
        : `<button class="btn primary" id="pvReq" data-online>Request swap · free</button>`}
      <button class="btn ghost" id="pvMap">View on map</button>
      <button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button>
    </div></div>`;
  modal.hidden = false;
  const rq = document.getElementById('pvReq');
  if (rq) rq.onclick = () => { modal.hidden = true; requestSwap(id); };
  const pc = document.getElementById('pvComplete');
  if (pc) pc.onclick = () => {
    if (!online()) return toast('⚠️ Payments need a connection.');
    checkout('completion', () => {
      reqStore.update(req.id, { completionPaid: true, upd: Date.now() });
      Metrics.log('payment_succeeded');
      renderMarket(); renderInbox(); openSwapPreview(id);
      toast('✅ Completion paid — exact seats unlocked.');
    });
  };
  document.getElementById('pvMap').onclick = () => { modal.hidden = true; $('#mapSection').scrollIntoView({ behavior: 'smooth' }); };
  updateOnlineUI();
}

function requestSwap(id) {
  if (!online()) return toast('⚠️ You are offline — requests need a connection.');
  const s = store.all().find(x => x.id === id); if (!s) return;
  if (s.service && !Policy.hasPaidSearch(s.service)) {
    renderMarket();
    $('#market').scrollIntoView({ behavior: 'smooth' });
    return toast('🔍 Activate matching first (₹49 search fee).');
  }
  if (reqStore.forSwap(id)) return toast('Already requested — see Inbox.');
  const rec = { id: 'r' + Date.now(), swapId: id, snap: { name: s.name, seat: s.seat, coach: s.coach, mode: s.mode, no: serviceNoOf(s) }, state: 'requested', ts: Date.now(), expires: Date.now() + REQ_TTL, upd: Date.now() };
  reqStore.add(rec);
  if (typeof SwapLedger !== 'undefined') {
    SwapLedger.upsert({
      sourceId: 'req:' + rec.id, mode: s.mode, serviceNumber: serviceNoOf(s),
      travelDate: s.date || dayOfTs(Date.now()), coachOrCabin: s.coach || '—',
      ownSeat: (state.mine || 'you'), targetSeat: s.seat || '—', status: 'pending',
      quoteSummary: 'swap request', createdAt: new Date(rec.ts).toISOString(),
    });
  }
  Metrics.log('request');
  Metrics.log('swap_request_created');
  renderMarket(); renderInbox();
  toast('📨 Request sent — expires in 24h. See Inbox.');
}

function openReport(id) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="sheet"><h3>⚑ Report</h3>
    <p class="muted">Wrong seat on the map? Abuse? Reports hide the listing on this device and help moderation.</p>
    ${['Seat not where shown', 'Abusive messages', 'Spam / commercial', 'Other'].map(r => `<button class="btn ghost small" style="margin:4px" data-r="${r}">${r}</button>`).join('')}
    <div class="row" style="margin-top:10px"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Cancel</button></div></div>`;
  modal.hidden = false;
  modal.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const arr = blocks(); arr.unshift({ id, reason: b.dataset.r, ts: Date.now() });
    localStorage.setItem('swapseat_blocks', JSON.stringify(arr.slice(0, 100)));
    modal.hidden = true; renderMarket(); renderAdmin(); toast('Hidden. Thanks — report logged.');
  });
}

function openChat(id) {
  if (!online()) return toast('⚠️ You are offline — chat needs a connection.');
  const s = store.all().find(x => x.id === id); if (!s) return;
  const req = reqStore.forSwap(id);
  const open = req && ['accepted', 'crew', 'completed'].includes(req.state);
  if (!open) return toast('🔒 Chat unlocks after both travellers accept.');
  const modal = $('#modal');
  const tpl = ['I can meet near the coach entrance.', 'I will confirm after boarding.', 'Please verify with railway staff.', 'I cannot continue with this request.', 'I am traveling with a family member.'];
  modal.innerHTML = `<div class="sheet"><h3>💬 Safe chat — ${s.name}</h3><p class="fine">Journey-bound structured messages. Never share PNRs, ticket barcodes, or phone numbers.</p>
    ${tpl.map(t => `<button class="btn ghost small" style="margin:4px" data-t="${t}">${t}</button>`).join('')}
    <div class="row" style="margin-top:10px"><button class="btn ghost" data-report="${s.id}">⚑ Report</button><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
  modal.hidden = false;
  modal.querySelectorAll('[data-t]').forEach(b => b.onclick = () => toast('✉️ Sent (demo)'));
  modal.querySelectorAll('[data-report]').forEach(b => b.onclick = () => openReport(b.dataset.report));
}

/* ---------- inbox: my listings + my requests ---------- */
function renderInbox() {
  expireSweep();
  const mine = store.all().filter(s => s.mine && (s.state || 'open') !== 'cancelled');
  const reqs = reqStore.all();
  const posts = mine.length ? mine.map(s => {
    const st = s.state || 'open';
    return `<div class="swap"><div class="top"><b>${modeIcon(s.mode)} ${serviceNoOf(s)}${s.mode === 'flight' ? ' · ' + s.seat : ' · ' + s.coach + ' ' + s.seat}</b>
      <span class="badge st-${st}">${st === 'open' ? 'Listed' : 'Withdrawn'}</span>${(s.group || 1) > 1 ? `<span class="badge">👥 ${s.group}</span>` : ''}</div>
      <div class="fine">${fmtDate(s.date || s.ts)} · ${s.seg || ''} · wants ${(s.want || []).join(', ')}</div>
      <div class="row">${st === 'open' ? `<button class="btn small ghost" data-wd="${s.id}">Withdraw</button>` : ''}</div></div>`;
  }).join('') : '<p class="muted">No listings yet — find your journey above.</p>';
  const rl = reqs.length ? reqs.map(r => {
    const st = (typeof swapState !== 'undefined' ? swapState(r.state) : { label: r.state, blurb: '' });
    const canAct = r.state === 'requested' && r.expires > Date.now();
    const swap = store.all().find(x => x.id === r.swapId);
    const due = swap && Policy.completionFeeDue(r, swap);
    const rev = swap && Policy.revealState(r, swap).unlocked;
    return `<div class="swap"><div class="top"><b>${r.snap.name}</b><span class="badge st-${r.state}">${st.label}</span></div>
      <div class="fine">${modeIcon(r.snap.mode)} ${r.snap.no} · ${r.snap.mode === 'flight' ? r.snap.seat : r.snap.coach + ' ' + r.snap.seat}${r.expires && (r.state === 'requested' || r.state === 'accepted') ? ' · ' + leftIn(r.expires) : ''}</div>
      ${rev && swap ? `<div class="fine">🔓 Their exact seat: <b>${swap.mode === 'flight' ? swap.seat : swap.coach + ' ' + swap.seat}</b> · ${confirmationId(r)}</div>` : ''}
      <p class="fine">${st.blurb || ''}</p>
      <div class="row">
        ${canAct ? `<button class="btn small primary" data-acc="${r.id}">Demo: other side accepts</button><button class="btn small ghost" data-wr="${r.id}">Withdraw</button>` : ''}
        ${r.state === 'accepted' && due ? `<button class="btn small primary" data-payc="${r.id}">Pay ₹${Policy.fees().ONE_SIDED_SWAP_FEE} to complete</button><button class="btn small ghost" data-wr="${r.id}">Withdraw</button>` : ''}
        ${r.state === 'accepted' && !due ? `<button class="btn small primary" data-done="${r.id}">Both confirm completed</button><button class="btn small ghost" data-wr="${r.id}">Withdraw</button>` : ''}
        ${r.state === 'crew' ? `<button class="btn small primary" data-done="${r.id}">Crew approved — complete</button>` : ''}
      </div></div>`;
  }).join('') : '<p class="muted">No requests yet. Preview a match to request — sending is free.</p>';
  $('#myPosts').innerHTML = posts;
  $('#myReqs').innerHTML = rl;
  $('#myPosts').querySelectorAll('[data-wd]').forEach(b => b.onclick = () => { store.update(b.dataset.wd, { state: 'cancelled' }); renderInbox(); renderMarket(); toast('Listing withdrawn.'); });
  $('#myReqs').querySelectorAll('[data-wr]').forEach(b => b.onclick = () => { reqStore.update(b.dataset.wr, { state: 'cancelled' }); renderInbox(); renderMarket(); toast('Request withdrawn.'); });
  $('#myReqs').querySelectorAll('[data-acc]').forEach(b => b.onclick = () => {
    const r = reqStore.all().find(x => x.id === b.dataset.acc);
    if (!r || r.expires < Date.now()) return toast('⚠️ Expired requests cannot be accepted.');
    reqStore.update(r.id, { state: 'accepted' }); renderInbox(); renderMarket(); toast('🤝 Agreed by both (demo) — seats held.');
  });
  $('#myReqs').querySelectorAll('[data-payc]').forEach(b => b.onclick = () => {
    if (!online()) return toast('⚠️ Payments need a connection.');
    const r = reqStore.all().find(x => x.id === b.dataset.payc);
    if (!r) return;
    checkout('completion', () => {
      reqStore.update(r.id, { completionPaid: true, upd: Date.now() });
      Metrics.log('payment_succeeded');
      renderInbox(); renderMarket(); toast('✅ Completion paid — exact seats unlocked.');
    });
  });
  $('#myReqs').querySelectorAll('[data-done]').forEach(b => b.onclick = () => {
    const r = reqStore.all().find(x => x.id === b.dataset.done);
    const isFlight = r && r.snap.mode === 'flight';
    if (r.state === 'accepted' && isFlight) { reqStore.update(r.id, { state: 'crew' }); toast('🧑‍✈️ With the crew — their decision is final.'); }
    else {
      reqStore.update(r.id, { state: 'completed' });
      Metrics.log('complete'); Metrics.log('swap_completed');
      // Lock the journey: pending alternatives for the same service stop.
      const svc = (store.all().find(x => x.id === r.swapId) || {}).service;
      let n = 0;
      reqStore.all().forEach(o => {
        if (o.id !== r.id && o.state === 'requested') {
          const os = (store.all().find(x => x.id === o.swapId) || {}).service;
          if (!svc || os === svc) { reqStore.update(o.id, { state: 'cancelled' }); n++; }
        }
      });
      toast(n ? `✅ Completed — ${n} pending request${n > 1 ? 's' : ''} auto-cancelled.` : '✅ Completed — both confirmed.');
    }
    renderInbox(); renderMarket();
  });
  updateOnlineUI();
}

/* ---------- invites, watches, layout reports, admin, funnel ---------- */
function buildInvite() {
  const j = state.journey;
  if (!j) return null;
  const no = usesCoach(j) ? j.train.no : j.flight.no;
  const segm = j.kind === 'flight' ? state.craft : state.coach;
  return `${location.origin}${location.pathname}#j=${j.kind}|${no}|${j.date}|${segm}|${encodeURIComponent(currentSeg())}`;
}

function parseInvite() {
  const m = (location.hash || '').match(/^#j=(train|bus|flight)\|([^|]+)\|(\d{4}-\d{2}-\d{2})\|([^|]*)\|?(.*)$/);
  if (!m) return false;
  const [, kind, no, date, segm, seg] = m;
  document.querySelector(`.mode-tabs button[data-mode="${kind}"]`)?.click();
  $('#journeyNo').value = no;
  $('#journeyDate').value = date;
  if (seg) {
    const [f, t] = decodeURIComponent(seg).split('→');
    if (f) $('#segFrom').value = f;
    if (t) $('#segTo').value = t;
  }
  $('#lookupBtn').click();
  if (kind === 'bus' && (segm === 'L' || segm === 'U')) {
    state.busType = 'sleeper';
    document.querySelectorAll('#busTypeRow button').forEach(x => x.classList.toggle('on', x.dataset.bt === 'sleeper'));
    $('#lookupBtn').click();
  }
  if (kind === 'train' && segm) {
    const btn = document.querySelector(`#coachPills button[data-c="${segm}"]`);
    if (btn) btn.click();
  }
  if (kind === 'flight' && segm && AIRCRAFT[segm]) { state.craft = segm; renderMap(); }
  setTimeout(() => $('#mapSection').scrollIntoView({ behavior: 'smooth' }), 300);
  return true;
}

$('#inviteBtn').addEventListener('click', async () => {
  const url = buildInvite();
  if (!url) return toast('Look up a train or flight first.');
  const text = `Join me on ${journeyNo(state.journey)} — open to swap seats: ${url}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'SwapSeat invite', text, url }); return; }
    await navigator.clipboard.writeText(text);
    toast('🔗 Invite copied — no names or PNRs inside.');
  } catch {
    const modal = $('#modal');
    modal.innerHTML = `<div class="sheet"><h3>🔗 Invite link</h3><p class="muted">Share privately. It carries only service + date + segment — never names or booking refs.</p><div class="upi-box" style="word-break:break-all">${url}</div><div class="row"><button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Close</button></div></div>`;
    modal.hidden = false;
  }
});

function getWatches() { try { return JSON.parse(localStorage.getItem('swapseat_watches') || '[]'); } catch { return []; } }
function setWatches(w) { localStorage.setItem('swapseat_watches', JSON.stringify(w.slice(0, 20))); }
function syncWatchBtn() {
  const b = $('#watchBtn');
  if (!b) return;
  const svc = myService();
  const on = !!(svc && getWatches().some(w => w.service === svc));
  b.innerHTML = on ? '🔔 Watching ✓' : '🔔 Watch service';
  b.classList.toggle('on', on);
}
$('#watchBtn').addEventListener('click', () => {
  const svc = myService();
  if (!svc) return toast('Look up your journey first.');
  const ws = getWatches();
  const i = ws.findIndex(w => w.service === svc);
  if (i >= 0) { ws.splice(i, 1); toast('Watch removed.'); }
  else {
    ws.unshift({ service: svc, want: [...state.wantTypes], seen: scoreAll().map(r => r.s.id), ts: Date.now() });
    toast('🔔 Watching — we’ll flag new travellers on this service here.');
  }
  setWatches(ws); syncWatchBtn();
});
function checkWatches(ids) {
  const svc = myService();
  if (!svc) return;
  const ws = getWatches();
  const w = ws.find(x => x.service === svc);
  if (!w) return;
  const fresh = ids.filter(id => !w.seen.includes(id));
  if (w.seen.length && fresh.length) toast(`🔔 ${fresh.length} new traveller${fresh.length > 1 ? 's' : ''} on your watched service`);
  w.seen = ids; setWatches(ws);
}

function layoutReports() { try { return JSON.parse(localStorage.getItem('swapseat_layout_reports') || '[]'); } catch { return []; } }
$('#layoutBtn').addEventListener('click', () => {
  const j = state.journey;
  if (!j) return toast('Look up your journey first.');
  const modal = $('#modal');
  modal.innerHTML = `<div class="sheet"><h3>⚑ Report inaccurate layout</h3>
    <p class="muted">${usesCoach(j) ? `${j.train.no} · ${j.kind === 'bus' ? 'deck' : 'coach'} ${state.coach}` : `${j.flight.no} · ${state.craft}`} — what’s wrong?</p>
    <div class="field"><label for="layoutNote">What did you see on board?</label><input id="layoutNote" placeholder="e.g. Bay 5 has no side berths in this coach"/></div>
    <div class="row" style="margin-top:10px"><button class="btn primary" id="layoutSend">Send correction</button>
    <button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Cancel</button></div></div>`;
  modal.hidden = false;
  document.getElementById('layoutSend').onclick = () => {
    const note = ($('#layoutNote').value || '').trim();
    if (!note) return toast('Describe what’s wrong first.');
    const arr = layoutReports();
    arr.unshift({ service: myService(), coach: state.coach || state.craft, note, ts: Date.now() });
    localStorage.setItem('swapseat_layout_reports', JSON.stringify(arr.slice(0, 50)));
    modal.hidden = true; renderAdmin(); toast('Thanks — correction queued for review.');
  };
});

function renderAdmin() {
  const reps = blocks();
  const lays = layoutReports();
  $('#reportList').innerHTML = reps.length ? reps.map((b, i) => {
    const s = store.all().find(x => x.id === b.id);
    return `<div class="swap"><div class="top"><b>${s ? `${s.name} · ${serviceNoOf(s)} ${s.coach || s.seat || ''}` : b.id}</b><span class="badge">${b.reason}</span></div>
      <div class="fine">${ago(b.ts)}</div>
      <div class="row"><button class="btn small ghost" data-unblock="${i}">Dismiss · unhide</button></div></div>`;
  }).join('') : '<p class="muted">No listing reports.</p>';
  if (!document.getElementById('issueCredit')) {
    $('#reportList').insertAdjacentHTML('afterend', `<div class="row" style="margin:8px 0"><button class="btn small ghost" id="issueCredit">+ Issue wallet credit</button></div>`);
  }
  $('#layoutList').innerHTML = lays.length ? lays.map((l, i) => {
    return `<div class="swap"><div class="top"><b>${l.service || ''} · ${l.coach || ''}</b></div>
      <p class="muted" style="font-size:13px">${l.note}</p><div class="fine">${ago(l.ts)}</div>
      <div class="row"><button class="btn small ghost" data-dlay="${i}">Dismiss</button></div></div>`;
  }).join('') : '<p class="muted">No layout corrections.</p>';
  $('#reportList').querySelectorAll('[data-unblock]').forEach(b => b.onclick = () => {
    const arr = blocks(); arr.splice(parseInt(b.dataset.unblock, 10), 1);
    localStorage.setItem('swapseat_blocks', JSON.stringify(arr));
    renderAdmin(); renderMarket(); toast('Report dismissed.');
  });
  const adm = document.getElementById('issueCredit');
  if (adm) adm.onclick = () => {
    const modal = $('#modal');
    modal.innerHTML = `<div class="sheet"><h3>Issue wallet credit</h3>
      <div class="field"><label for="creditAmt">Amount (₹)</label><input id="creditAmt" type="number" min="1" value="49"/></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="creditGo">Issue</button>
      <button class="btn ghost" onclick="document.getElementById('modal').hidden=true">Cancel</button></div></div>`;
    modal.hidden = false;
    document.getElementById('creditGo').onclick = () => {
      const amt = Math.max(1, parseInt(document.getElementById('creditAmt').value, 10) || 0);
      Wallet.credit(amt, 'Admin grant');
      modal.hidden = true; refreshWallet(); toast(`₹${amt} credited.`);
    };
  };
  $('#layoutList').querySelectorAll('[data-dlay]').forEach(b => b.onclick = () => {
    const arr = layoutReports(); arr.splice(parseInt(b.dataset.dlay, 10), 1);
    localStorage.setItem('swapseat_layout_reports', JSON.stringify(arr));
    renderAdmin(); toast('Correction dismissed.');
  });
}

function renderFunnel() {
  const el = $('#funnel');
  if (!el) return;
  let m = {};
  try { m = JSON.parse(localStorage.getItem('swapseat_metrics') || '{}'); } catch {}
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
  const rows = [
    ['Map resolution', `${m.resolved || 0}/${m.lookup || 0} resolved`, pct(m.resolved || 0, m.lookup || 0)],
    ['Activation', `${m.activate || 0} listings`, ''],
    ['Match coverage', `${m.covered || 0}/${m.market || 0} with a match`, pct(m.covered || 0, m.market || 0)],
    ['Requests', `${m.request || 0} sent`, ''],
    ['Completion', `${m.complete || 0} completed`, pct(m.complete || 0, m.request || 0)],
  ];
  el.innerHTML = `<div class="eyebrow">Matching funnel · this device</div><div class="affils">`
    + rows.map(r => `<div class="affil"><b>${r[0]}</b><br/>${r[1]}${r[2] ? ' · ' + r[2] : ''}</div>`).join('') + `</div>`;
}

/* ---------- monetization UI ---------- */
function renderWalletBox() {
  const el = $('#walletBox');
  if (!el) return;
  const w = Wallet.get();
  const rows = (w.ledger || []).slice(0, 5).map(t => `<div class="fine">+₹${t.amount} · ${t.reason} · ${ago(t.ts)}</div>`).join('');
  el.innerHTML = `<div class="top" style="display:flex;gap:8px;align-items:center"><b>👛 Wallet · ₹${w.balance || 0}</b><span class="fine">credits-only: no-match refunds, no top-ups in v1</span></div>${rows || '<div class="fine">No transactions yet.</div>'}`;
}

function refreshWallet() {
  const w = Wallet.get();
  const left = Math.max(0, MONETIZE.freeListings - Wallet.activeListings());
  $('#walletPill').textContent = w.plan === 'plus' ? `💎 Plus · unlimited` : `Free · ${left} listings`;
  let tx = [];
  try { tx = (typeof Payments !== 'undefined' ? Payments.txns() : []).slice(0, 3); } catch {}
  $('#plusPlans').innerHTML = paywallHTML(w.plan === 'plus' ? `✅ Plus active${w.gateway ? ' via ' + w.gateway : ''} — unlimited listings, saved preferences, alerts` : 'Free matching. Pay only for convenience.')
    + `<div class="row" style="margin-top:10px">
        <button class="btn ghost small" id="manageSub">Manage subscription</button>
        <button class="btn ghost small" id="billingKeys">⚙ Billing keys</button>
        ${w.boosts ? `<span class="badge">⬆ ${w.boosts} boost credit${w.boosts > 1 ? 's' : ''}</span>` : ''}
        <span class="fine">${tx.length ? 'Recent: ' + tx.map(t => `${t.gateway}·${t.kind}`).join(', ') : 'No payments yet on this device'}</span>
      </div>
      <p class="fine">${Metrics.line()}</p>`;
  bindPayButtons();
  renderFunnel(); renderWalletBox();
  const hh = w.household;
  if (w.plan === 'plus' && hh) {
    if (!$('#pname').value) $('#pname').value = hh.name || '';
  }
  const ml = $('#metricsLine');
  if (ml) ml.textContent = Metrics.line();
}
function bindPayButtons() {
  document.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const k = b.dataset.pay;
    if (k === 'plus') checkout('plus', () => refreshWallet());
    else if (k === 'plusYearly') checkout('plusYearly', () => refreshWallet());
    else if (k === 'trip') checkout('trip', () => { toast('🎫 Trip pass ready — post your group.'); refreshWallet(); });
    else if (k === 'boost') checkout('boost', () => renderMarket());
  });
  const mp = document.getElementById('manageSub');
  if (mp) mp.onclick = () => Payments.openPortal(() => toast('Portal needs backend + Chargebee keys'));
  const kb = document.getElementById('billingKeys');
  if (kb) kb.onclick = () => Payments.openKeySettings();
}
$('#plusBtn').addEventListener('click', () => { $('#plus').scrollIntoView({ behavior: 'smooth' }); });

/* ---------- offline honesty ---------- */
function updateOnlineUI() {
  const off = !online();
  $('#offlineBar').hidden = !off;
  document.querySelectorAll('[data-online]').forEach(b => {
    b.disabled = off;
    b.title = off ? 'Needs a connection' : '';
  });
}
window.addEventListener('online', () => { updateOnlineUI(); toast('🌐 Back online — revalidated.'); renderMarket(); });
window.addEventListener('offline', () => updateOnlineUI());

/* ---------- PWA ---------- */
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; $('#installBar').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (deferred) { deferred.prompt(); deferred = null; } });
$('#installGo').addEventListener('click', async () => { if (deferred) { deferred.prompt(); deferred = null; } $('#installBar').hidden = true; });
$('#installNo').addEventListener('click', () => $('#installBar').hidden = true);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

/* ---------- init ---------- */
$('#journeyDate').value = new Date().toISOString().slice(0, 10);
expireSweep();
/* First paint must not wait on the classic shell's marketplace/inbox/admin
   renders (hidden in flow mode): schedule them as a macrotask so the static
   shell paints, then the desks fill in. renderMarket is re-run by the network
   handlers, so nothing depends on it running synchronously here. */
refreshWallet(); updateOnlineUI();
setTimeout(() => { renderMarket(); renderInbox(); renderAdmin(); }, 0);
if (!parseInvite()) { /* default view */ }
setInterval(() => { const el = $('#marketStamp'); if (el?.dataset.ts) el.textContent = 'updated ' + ago(parseInt(el.dataset.ts, 10)); }, 30000);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.hidden = true; });

/* Debug handle for automated critical tests (own-localStorage only). */
window.SwapSeatDebug = { sweep: expireSweep, version: 'spec-1' };
