/* Visual seat-map renderers. All DOM is generated; CSS lives in styles.css.
   Design goal: show WHERE the berth is in the compartment, not just "Side Upper". */

function bayOf(classCode, n) {
  const spec = COACH_SPECS[classCode];
  return Math.ceil(n / spec.bay);
}
function posInBay(classCode, n) { const s = COACH_SPECS[classCode]; return ((n - 1) % s.bay) + 1; }

/* ---------- TRAIN COACH: top-view strip with bays, doors, toilets ---------- */
function renderTrainCoach(el, { classCode, total, mine = null, wanted = [], peerSeats = [], onPick, highlightBay = null }) {
  const spec = COACH_SPECS[classCode];
  const bays = Math.ceil(total / spec.bay);
  const isSleeper = ['SL','3A','3E','2A','1A'].includes(classCode);
  let html = `<div class="coach-shell" role="img" aria-label="${spec.label} coach layout">`;
  html += `<div class="coach-end toilet">🚻</div><div class="coach-end door">🚪<span>ENTRY</span></div>`;
  html += `<div class="bays">`;
  for (let b = 1; b <= bays; b++) {
    const start = (b - 1) * spec.bay + 1;
    const end = Math.min(b * spec.bay, total);
    const nums = []; for (let n = start; n <= end; n++) nums.push(n);
    const hasMine = mine && mine >= start && mine <= end;
    const hasWant = wanted.some(w => nums.includes(w));
    html += `<div class="bay ${highlightBay === b ? 'zoom' : ''} ${hasMine ? 'has-mine' : ''}" data-bay="${b}" title="Bay ${b} · berths ${start}–${end}">`;
    html += `<div class="bay-label">BAY ${b}</div>`;
    if (isSleeper) {
      html += `<div class="sleeper-grid">`;
      // main compartment (6 or fewer) on left block, side berths on corridor strip
      const main = nums.filter(n => !['SL','SU','SM'].includes(berthTypeOf(classCode, n)));
      const side = nums.filter(n => ['SL','SU','SM'].includes(berthTypeOf(classCode, n)));
      html += `<div class="main-block">`;
      main.forEach(n => { html += seatBtn(classCode, n, mine, wanted, peerSeats); });
      html += `</div><div class="aisle"><span></span></div><div class="side-block">`;
      side.forEach(n => { html += seatBtn(classCode, n, mine, wanted, peerSeats); });
      html += `</div>`;
    } else {
      html += `<div class="chair-grid">`;
      nums.forEach(n => { html += seatBtn(classCode, n, mine, wanted, peerSeats); });
      html += `</div>`;
    }
    html += `<div class="bay-range">${start}–${end}</div></div>`;
  }
  html += `</div><div class="coach-end door">🚪<span>EXIT</span></div><div class="coach-end toilet">🚻</div></div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-seat]').forEach(btn => {
    btn.addEventListener('click', () => onPick && onPick(parseInt(btn.dataset.seat, 10)));
  });
}

function seatBtn(classCode, n, mine, wanted, peerSeats) {
  const t = berthTypeOf(classCode, n);
  const m = berthMeta(t);
  const cls = ['seat'];
  cls.push('t-' + t);
  if (n === mine) cls.push('mine');
  if (wanted.includes(n)) cls.push('want');
  if (peerSeats.includes(n)) cls.push('peer');
  return `<button class="${cls.join(' ')}" data-seat="${n}" title="${n} · ${m.name} — ${m.level}"><span class="n">${n}</span><span class="t">${t}</span></button>`;
}

/* ---------- COMPARTMENT ZOOM: side-elevation showing berth LEVELS ---------- */
function renderCompartmentZoom(el, { classCode, bay, total, mine, wanted = [] }) {
  const spec = COACH_SPECS[classCode];
  const start = (bay - 1) * spec.bay + 1;
  const end = Math.min(bay * spec.bay, total);
  const nums = []; for (let n = start; n <= end; n++) nums.push(n);
  if (!['SL','3A','3E','2A','1A'].includes(classCode)) {
    el.innerHTML = `<div class="zoom-empty">Chair-car bays are open rows — pick any seat in Bay ${bay} (${start}–${end}).</div>`;
    return;
  }
  const levelRow = (level, label) => {
    const seats = nums.filter(n => {
      const t = berthTypeOf(classCode, n);
      if (level === 'LOWER') return t === 'LB' || t === 'SL';
      if (level === 'MIDDLE') return t === 'MB' || t === 'SM';
      if (level === 'UPPER') return t === 'UB' || t === 'SU';
      return false;
    });
    return `<div class="level"><div class="level-tag">${label}</div><div class="level-seats">${
      seats.map(n => {
        const t = berthTypeOf(classCode, n);
        const cls = n === mine ? 'mine' : wanted.includes(n) ? 'want' : '';
        return `<div class="level-seat ${cls}" data-seat="${n}"><b>${n}</b><i>${t}</i><small>${t.startsWith('S') ? 'aisle side' : 'main bay'}</small></div>`;
      }).join('')
    }</div></div>`;
  };
  el.innerHTML = `
    <div class="zoom-head">🔍 <b>Compartment Bay ${bay}</b> <span>berths ${start}–${end} · ${spec.label}</span></div>
    <div class="coach-cross">🚪 door &nbsp;|&nbsp; ⬅ main 6 berths face each other ➡ &nbsp;|&nbsp; corridor + side berths &nbsp;|&nbsp; 🚻</div>
    ${levelRow('UPPER', '⬆ TOP')}
    ${levelRow('MIDDLE', '⬌ MID')}
    ${levelRow('LOWER', '⬇ FLOOR')}
    <div class="zoom-tip">Lower = floor level (elders/kids). Middle = folds by day. Upper = private. <b>Side</b> berths run along the corridor — narrower.</div>`;
}

/* ---------- FLIGHT CABIN: fuselage with exits, wings, galley ---------- */
function renderFlightCabin(el, { craft, mine = null, wantedTypes = [], peerSeats = [], onPick }) {
  const spec = AIRCRAFT[craft];
  const letters = spec.seats;
  const mid = Math.ceil(letters.length / 2);
  let html = `<div class="fuselage"><div class="nose">✈️ COCKPIT</div>`;
  for (let r = 1; r <= spec.rows; r++) {
    const isExit = spec.exits.includes(r);
    const isWing = r >= Math.min(...spec.wings) && r <= Math.max(...spec.wings);
    if (isExit) html += `<div class="exit-row"><span>🚪 EXIT · Row ${r} · extra legroom</span></div>`;
    html += `<div class="frow ${isWing ? 'wing' : ''}" data-row="${r}"><span class="rno">${r}</span>`;
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
      if (meta.wing) cls.push('wingseat');
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
    const t = berthTypeOf(info.classCode, info.seat);
    const bay = bayOf(info.classCode, info.seat);
    return `<div class="mini">🚃 <b>${info.coach} · ${info.seat} (${t})</b> · Bay ${bay} · ${berthMeta(t).name}</div>`;
  }
  const m = flightSeatMeta(info.seat.slice(-1), parseInt(info.seat, 10), info.craft);
  return `<div class="mini">✈️ <b>${info.seat} (${m.type})</b> · ${m.name}${m.exit ? ' · EXIT' : ''}${m.wing ? ' · wing' : ''}</div>`;
}

function proximityLabel(a, b, classCode) {
  if (a.coach !== b.coach) return { txt: 'different coach', score: 20 };
  const ba = bayOf(classCode, a.seat), bb = bayOf(classCode, b.seat);
  if (ba === bb) return { txt: 'SAME bay — ideal', score: 100 };
  if (Math.abs(ba - bb) === 1) return { txt: 'next bay', score: 75 };
  return { txt: `${Math.abs(ba - bb)} bays away`, score: 45 };
}
