/* SwapSeat visual seat-map renderers — derived from data.js specs + flights.js.
   Thesis: a seat is a PLACE. Coach bays (with doors/toilets), compartment
   levels (TOP/MID/FLOOR), cabin exits/wings — never just a label. */

function isBerthSpec(spec) { return spec && spec.family === 'berth'; }

/* bay of berth n in a berth spec (final short bay counts as its own bay) */
function bayOfSpec(spec, n) { return Math.ceil(n / spec.baySize); }

/* bay number range */
function bayRange(spec, b) {
  const start = (b - 1) * spec.baySize + 1;
  return [start, Math.min(b * spec.baySize, spec.seats)];
}

/* ---------- TRAIN COACH: top-view strip with bays, doors, toilets ---------- */
function renderTrainCoach(el, { train, coach, mine = null, wanted = [], peerSeats = [], onPick, highlightBay = null }) {
  const spec = specOf(train, coach);
  let html = `<div class="coach-shell" role="img" aria-label="${spec.label} layout">`;
  html += `<div class="coach-end toilet">🚻</div><div class="coach-end door">🚪<span>ENTRY</span></div>`;
  html += `<div class="bays">`;
  if (isBerthSpec(spec)) {
    for (let b = 1; b <= spec.bays; b++) {
      const [start, end] = bayRange(spec, b);
      const nums = []; for (let n = start; n <= end; n++) nums.push(n);
      const hasMine = mine && mine >= start && mine <= end;
      html += `<div class="bay ${highlightBay === b ? 'zoom' : ''} ${hasMine ? 'has-mine' : ''}" title="Bay ${b} · berths ${start}–${end}">`;
      html += `<div class="bay-label">BAY ${b}</div><div class="sleeper-grid"><div class="main-block">`;
      nums.filter(n => !BERTH_TYPES[spec.layout[n - 1]].side).forEach(n => { html += seatBtn(spec, n, mine, wanted, peerSeats); });
      html += `</div><div class="aisle"><span></span></div><div class="side-block">`;
      nums.filter(n => BERTH_TYPES[spec.layout[n - 1]].side).forEach(n => { html += seatBtn(spec, n, mine, wanted, peerSeats); });
      html += `</div></div><div class="bay-range">${start}–${end}</div></div>`;
    }
  } else {
    // chair car: one "bay" per 4 rows for readable chunks
    const perChunk = spec.perRow * 4;
    const chunks = Math.ceil(spec.seats / perChunk);
    for (let c = 0; c < chunks; c++) {
      const start = c * perChunk + 1, end = Math.min((c + 1) * perChunk, spec.seats);
      const nums = []; for (let n = start; n <= end; n++) nums.push(n);
      const hasMine = mine && mine >= start && mine <= end;
      html += `<div class="bay ${hasMine ? 'has-mine' : ''}" title="Rows ${Math.floor((start-1)/spec.perRow)+1}–${Math.floor((end-1)/spec.perRow)+1}">`;
      html += `<div class="bay-label">ROWS ${Math.floor((start-1)/spec.perRow)+1}–${Math.floor((end-1)/spec.perRow)+1}</div><div class="chair-grid">`;
      nums.forEach(n => { html += seatBtn(spec, n, mine, wanted, peerSeats); });
      html += `</div><div class="bay-range">${start}–${end}</div></div>`;
    }
  }
  html += `</div><div class="coach-end door">🚪<span>EXIT</span></div><div class="coach-end toilet">🚻</div></div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-seat]').forEach(btn => {
    btn.addEventListener('click', () => onPick && onPick(parseInt(btn.dataset.seat, 10)));
  });
}

function seatBtn(spec, n, mine, wanted, peerSeats) {
  const t = berthTypeOf(spec, n);
  const m = berthMeta(t);
  const cls = ['seat', 't-' + t];
  if (n === mine) cls.push('mine');
  if (wanted.includes(n)) cls.push('want');
  if (peerSeats.includes(n)) cls.push('peer');
  let sub = t, title = `${n} · ${m.name} — ${m.level}`;
  if (!isBerthSpec(spec)) {
    const info = chairSeatInfo(spec, n);
    if (info) { sub = info.letter; title = `Seat ${n} · Row ${info.row}${info.letter} · ${m.name} — ${m.level}`; }
  }
  return `<button class="${cls.join(' ')}" data-seat="${n}" title="${title}"><span class="n">${n}</span><span class="t">${sub}</span></button>`;
}

/* ---------- COMPARTMENT ZOOM: side-elevation showing berth LEVELS ---------- */
function renderCompartmentZoom(el, { train, coach, bay, mine, wanted = [] }) {
  const spec = specOf(train, coach);
  if (!isBerthSpec(spec)) {
    const [s, e] = [Math.max(1, mine - 3), Math.min(spec.seats, (mine || 4) + 3)];
    el.innerHTML = `<div class="zoom-head">🔍 <b>Neighbourhood of seat ${mine || '—'}</b> <span>seats ${s}–${e} · ${spec.label} · tap a seat to add it as a target</span></div>
      <div class="level-seats">${Array.from({ length: e - s + 1 }, (_, i) => {
        const n = s + i, t = berthTypeOf(spec, n), info = chairSeatInfo(spec, n);
        const cls = n === mine ? 'mine' : wanted.includes(n) ? 'want' : '';
        return `<div class="level-seat ${cls}" data-seat="${n}"><b>${n}${info ? info.letter : ''}</b><i>${t}</i><small>row ${info ? info.row : '?'}</small></div>`;
      }).join('')}</div>`;
    return;
  }
  const [start, end] = bayRange(spec, bay);
  const nums = []; for (let n = start; n <= end; n++) nums.push(n);
  const levelRow = (level, label) => {
    const seats = nums.filter(n => BERTH_TYPES[spec.layout[n - 1]].level === level);
    if (!seats.length) return '';
    return `<div class="level"><div class="level-tag">${label}</div><div class="level-seats">${
      seats.map(n => {
        const t = spec.layout[n - 1], b = BERTH_TYPES[t];
        const cls = n === mine ? 'mine' : wanted.includes(n) ? 'want' : '';
        return `<div class="level-seat ${cls}" data-seat="${n}"><b>${n}</b><i>${t}</i><small>${b.side ? 'aisle side' : 'main bay'}</small></div>`;
      }).join('')
    }</div></div>`;
  };
  el.innerHTML = `
    <div class="zoom-head">🔍 <b>${spec.cabin ? 'Cabin' : 'Compartment'} ${coach} · Bay ${bay}</b> <span>berths ${start}–${end} · ${spec.label}</span></div>
    <div class="coach-cross">🚪 door &nbsp;|&nbsp; ⬅ main berths face each other ➡ &nbsp;|&nbsp; corridor + side berths &nbsp;|&nbsp; 🚻</div>
    ${levelRow(3, '⬆ TOP')}
    ${levelRow(2, '⬌ MID')}
    ${levelRow(1, '⬇ FLOOR')}
    <div class="zoom-tip">Lower = floor level (elders/kids). Middle = folds by day. Upper = private. <b>Side</b> berths run along the corridor — narrower. Tap a berth to add it as a swap target.</div>`;
}

/* ---------- FLIGHT CABIN: fuselage with exits, wings, galley ---------- */
function renderFlightCabin(el, { craft, mine = null, wantedTypes = [], peerSeats = [], onPick }) {
  const spec = AIRCRAFT[craft];
  const letters = spec.seats;
  let html = `<div class="fuselage"><div class="nose">✈️ COCKPIT</div>`;
  for (let r = 1; r <= spec.rows; r++) {
    const isExit = spec.exits.includes(r);
    const isWing = r >= Math.min(...spec.wings) && r <= Math.max(...spec.wings);
    if (isExit) html += `<div class="exit-row"><span>🚪 EXIT · Row ${r} · extra legroom</span></div>`;
    html += `<div class="frow ${isWing ? 'wing' : ''}"><span class="rno">${r}</span>`;
    letters.forEach((L, i) => {
      if (spec.layout === '3-3' && i === 3) html += `<span class="faisle"></span>`;
      if (spec.layout === '3-3-3' && (i === 3 || i === 6)) html += `<span class="faisle"></span>`;
      if (spec.layout === '2-2' && i === 2) html += `<span class="faisle"></span>`;
      const id = r + L;
      const meta = flightSeatMeta(L, r, craft);
      const cls = ['fseat', 't-' + meta.type];
      if (id === mine) cls.push('mine');
      if (wantedTypes.includes(meta.type)) cls.push('wanttype');
      if (peerSeats.includes(id)) cls.push('peer');
      if (meta.exit) cls.push('exit');
      html += `<button class="${cls.join(' ')}" data-seat="${id}" title="${id} · ${meta.name}${meta.exit ? ' · EXIT legroom' : ''}${meta.wing ? ' · over wing' : ''}">${L}</button>`;
    });
    html += `<span class="rno">${r}</span></div>`;
    if (spec.toilets.includes(r)) html += `<div class="galley-row"><span>🚻 lav · 🍱 galley</span></div>`;
  }
  html += `<div class="tail">TAIL</div></div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-seat]').forEach(b => b.addEventListener('click', () => onPick && onPick(b.dataset.seat)));
}

/* Mini map for marketplace cards */
function miniMapHTML(mode, info) {
  if (mode === 'train') {
    const spec = specOf(info.train, info.coach);
    const t = berthTypeOf(spec, info.seat);
    const where = isBerthSpec(spec) ? `Bay ${bayOfSpec(spec, info.seat)}` : (() => { const c = chairSeatInfo(spec, info.seat); return c ? `Row ${c.row}${c.letter}` : ''; })();
    return `<div class="mini">🚃 <b>${info.coach} · ${info.seat} (${t})</b> · ${where} · ${berthMeta(t).name}</div>`;
  }
  const m = flightSeatMeta(info.seat.slice(-1), parseInt(info.seat, 10), info.craft);
  return `<div class="mini">✈️ <b>${info.seat} (${m.type})</b> · ${m.name}${m.exit ? ' · EXIT' : ''}${m.wing ? ' · wing' : ''}</div>`;
}

/* proximity of two berths in the same spec */
function proximityLabel(spec, aSeat, bSeat) {
  if (!isBerthSpec(spec)) {
    const d = Math.abs(aSeat - bSeat);
    if (d === 0) return { txt: 'same seat?!', score: 100 };
    if (d <= 2) return { txt: 'adjacent seats — ideal', score: 100 };
    if (d <= spec.perRow * 2) return { txt: 'same row area', score: 75 };
    return { txt: `${Math.ceil(d / spec.perRow)} rows away`, score: 45 };
  }
  const ba = bayOfSpec(spec, aSeat), bb = bayOfSpec(spec, bSeat);
  if (ba === bb) return { txt: 'SAME bay — ideal', score: 100 };
  if (Math.abs(ba - bb) === 1) return { txt: 'next bay', score: 75 };
  return { txt: `${Math.abs(ba - bb)} bays away`, score: 45 };
}

/* describe a picked seat for the summary line */
function describeSeat(train, coach, seat) {
  const spec = specOf(train, coach);
  if (isBerthSpec(spec)) {
    const t = spec.layout[seat - 1], b = BERTH_TYPES[t];
    return `<b>${coach} · ${seat} (${t})</b> · Bay ${bayOfSpec(spec, seat)} · ${b.name} (${b.note})`;
  }
  const info = chairSeatInfo(spec, seat), t = info ? info.pos : '?';
  return `<b>${coach} · ${seat}${info ? info.letter : ''} (${t})</b> · Row ${info ? info.row : '?'} · ${berthMeta(t).name} (${berthMeta(t).level})`;
}
