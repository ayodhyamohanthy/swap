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
function trainConfidence(train) {
  if (!train || train.no === '00000' || train.operator === 'Unknown operator') {
    return (typeof CONFIDENCE !== 'undefined' && CONFIDENCE.illustrative) || { icon: '?', label: 'Illustrative layout', tone: 'dim' };
  }
  return (typeof CONFIDENCE !== 'undefined' && CONFIDENCE.expected) || { icon: '≈', label: 'Expected layout', tone: 'warn' };
}

function renderTrainCoach(el, { train, coach, mine = null, wanted = [], peerSeats = [], onPick, highlightBay = null }) {
  const spec = specOf(train, coach);
  let html = `<div class="coach-shell" role="group" aria-label="${spec.label} layout, coach ${coach}">`;
  html += trainConfBadge(train, coach, specKeyFor(train, coach));
  html += `<div class="coach-row"><div class="coach-end toilet">🚻</div><div class="coach-end door">🚪<span>ENTRY</span></div>`;
  html += `<div class="bays">`;
  if (isBerthSpec(spec)) {
    const totalBays = (typeof bayCount === 'function' ? bayCount(spec) : Math.ceil(spec.seats / spec.baySize));
    for (let b = 1; b <= totalBays; b++) {
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
  html += `</div><div class="coach-end door">🚪<span>EXIT</span></div><div class="coach-end toilet">🚻</div></div></div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-seat]').forEach(btn => {
    btn.addEventListener('click', () => onPick && onPick(parseInt(btn.dataset.seat, 10)));
  });
}

function seatBtn(spec, n, mine, wanted, peerSeats) {
  const t = berthTypeOf(spec, n);
  const m = seatDisplay(t);
  const cls = ['seat', 't-' + t];
  if (n === mine) cls.push('mine');
  if (wanted.includes(n)) cls.push('want');
  if (peerSeats.includes(n)) cls.push('peer');
  let sub = t, title = `${n} · ${m.name} — ${m.level}`;
  if (!isBerthSpec(spec)) {
    const info = chairSeatInfo(spec, n);
    if (info) { sub = info.letter; title = `Seat ${n} · Row ${info.row}${info.letter} · ${m.name} — ${m.level}`; }
  }
  return `<button class="${cls.join(' ')}" data-seat="${n}" title="${title}" aria-label="${title}${n === mine ? ' (your seat)' : ''}"${n === mine ? ' aria-pressed="true"' : ''}><span class="n" aria-hidden="true">${n}</span><span class="t" aria-hidden="true">${sub}</span></button>`;
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

/* ---------- FLIGHT CABIN: fuselage with sections, exits, wings, galley ---------- */
function renderFlightCabin(el, { craft, flight = null, mine = null, wantedTypes = [], peerSeats = [], onPick }) {
  const a = AIRCRAFT[craft];
  let html = `<div class="fuselage"><div class="nose">✈️ COCKPIT</div>`;
  html += flightConfBadge(craft, flight);
  for (const sec of a.sections) {
    html += `<div class="cabin-sec"><span>${sec.name} · rows ${sec.from}–${sec.to}${sec.pitch ? ' · ' + sec.pitch : ''}</span></div>`;
    for (let r = sec.from; r <= sec.to; r++) {
      if ((a.exits || []).includes(r)) html += `<div class="exit-row"><span>🚪 EXIT · Row ${r} · extra legroom</span></div>`;
      const inWing = a.wings && r >= a.wings[0] && r <= a.wings[1];
      // short final row: only the first `endRow` seats exist
      let budget = (r === sec.to && sec.endRow) ? sec.endRow : Infinity;
      html += `<div class="frow ${inWing ? 'wing' : ''}"><span class="rno">${r}</span>`;
      sec.groups.forEach((gsize, gi) => {
        if (gi > 0) html += `<span class="faisle"></span>`;
        for (let k = 0; k < gsize; k++) {
          if (budget-- <= 0) { html += `<span class="fvoid"></span>`; continue; }
          const L = sec.letters[gi][k];
          const id = r + L;
          const meta = flightSeatMeta(L, r, craft);
          const cls = ['fseat', 't-' + meta.type];
          if (id === mine) cls.push('mine');
          if (wantedTypes.includes(meta.type)) cls.push('wanttype');
          if (peerSeats.includes(id)) cls.push('peer');
          if (meta.exit) cls.push('exit');
          const ftitle = `${id} · ${sec.name} · ${meta.name}${meta.exit ? ' · EXIT legroom' : ''}${inWing ? ' · over wing' : ''}`;
          html += `<button class="${cls.join(' ')}" data-seat="${id}" title="${ftitle}" aria-label="${ftitle}${id === mine ? ' (your seat)' : ''}"${id === mine ? ' aria-pressed="true"' : ''}>${L}</button>`;
        }
      });
      html += `<span class="rno">${r}</span></div>`;
      if ((a.lavs || []).includes(r) || (a.galley || []).includes(r)) {
        html += `<div class="galley-row"><span>${(a.lavs || []).includes(r) ? '🚻 lav ' : ''}${(a.galley || []).includes(r) ? '· 🍱 galley' : ''}</span></div>`;
      }
    }
  }
  html += `<div class="tail">${a.boardFrom === 'rear' ? '⬅ BOARD FROM REAR' : 'TAIL'}</div></div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-seat]').forEach(b => b.addEventListener('click', () => onPick && onPick(b.dataset.seat)));
}

/* Mini map for marketplace cards */
function miniMapHTML(mode, info) {
  if (mode === 'train') {
    const spec = specOf(info.train, info.coach);
    const t = berthTypeOf(spec, info.seat);
    const where = isBerthSpec(spec) ? `Bay ${bayOfSpec(spec, info.seat)}` : (() => { const c = chairSeatInfo(spec, info.seat); return c ? `Row ${c.row}${c.letter}` : ''; })();
    return `<div class="mini">🚃 <b>${info.coach} · ${info.seat} (${t})</b> · ${where} · ${seatDisplay(t).name}</div>`;
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
  return `<b>${coach} · ${seat}${info ? info.letter : ''} (${t})</b> · Row ${info ? info.row : '?'} · ${seatDisplay(t).name} (${seatDisplay(t).level})`;
}

/* Text alternative to the visual map (screen readers, low-vision, low-data). */
function mapListHTML(train, coach, craft) {
  if (craft) {
    const a = AIRCRAFT[craft];
    let h = `<summary>Text list: ${a.label} seating</summary><div class="maplist-body">`;
    for (const sec of a.sections) {
      h += `<p><b>${sec.name}</b> rows ${sec.from}–${sec.to}. Exit rows: ${(a.exits || []).filter(r => r >= sec.from && r <= sec.to).join(', ') || 'none'}.</p>`;
    }
    return h + `<p class="fine">Window seats are the outer letters of each row; aisle seats touch the corridor. Exit rows need crew approval to occupy.</p></div>`;
  }
  const spec = specOf(train, coach);
  if (!isBerthSpec(spec)) {
    return `<summary>Text list: ${spec.label} seating</summary><div class="maplist-body"><p>${spec.seats} seats in ${spec.groups.join('+')} layout, numbered 1–${spec.seats} front to back. Row ${Math.ceil(1 / spec.perRow)} is at the door end.</p></div>`;
  }
  const totalBays = (typeof bayCount === 'function' ? bayCount(spec) : Math.ceil(spec.seats / spec.baySize));
  let h = `<summary>Text list: berths bay by bay (${totalBays} bays)</summary><div class="maplist-body">`;
  for (let b = 1; b <= totalBays; b++) {
    const [start, end] = bayRange(spec, b);
    const parts = [];
    for (let n = start; n <= end; n++) parts.push(`${n} ${spec.layout[n - 1]}`);
    h += `<p><b>Bay ${b}</b> (${start}–${end}): ${parts.join(' · ')}</p>`;
  }
  return h + `<p class="fine">LB lower · MB middle (night only) · UB upper · SL/SU side berths along the corridor.</p></div>`;
}

/* ===========================================================================
   LAYOUT CONFIDENCE BADGE
   The brief's rule: every resolved map must carry its source, layout version,
   last-checked time, confidence status and the identifiers it applies to. The
   badge belongs in the map header — never in a footnote.
   =========================================================================== */
function confBadgeHTML(confKey, o) {
  o = o || {};
  const c = CONFIDENCE[confKey] || CONFIDENCE.illustrative;
  const meta = [
    o.source && 'Source: ' + o.source,
    o.version && 'layout v' + o.version,
    o.checked && 'last checked ' + o.checked,
    o.applies && 'applies to: ' + o.applies,
  ].filter(Boolean);
  return `<div class="confbadge conf-${c.tone}" role="note">
    <span class="conf-ico" aria-hidden="true">${c.icon}</span>
    <span class="conf-txt"><b>${c.label}</b>${o.label ? ' · ' + o.label : ''}
      <span class="conf-blurb">${c.blurb}</span>
      ${meta.length ? `<span class="conf-meta">${meta.join(' · ')}</span>` : ''}
    </span>
  </div>`;
}

/* An unlisted train number, or a coach code we had to guess, cannot be better
   than illustrative. */
function trainConfBadge(train, coach, specKey) {
  const unlisted = !train || train.no === '00000' || train.operator === 'Unknown operator';
  const conf = unlisted ? 'illustrative' : 'expected';
  const spec = COACH_SPECS[specKey] || {};
  return confBadgeHTML(conf, {
    label: (train && train.name ? train.name : 'Unlisted service') + ' · coach ' + coach,
    source: unlisted ? 'Generic rake template' : (train.operator || 'Curated template'),
    version: spec.version || 1,
    checked: 'on template load',
    applies: specKey + ' · ' + ((train && train.rake) || 'ICF') + ' rake',
  });
}

function flightConfBadge(craft, flight) {
  const a = AIRCRAFT[craft] || {};
  const listed = !!(flight && FLIGHT_INDEX[flight.no]);
  const conf = listed ? (a.confidence || 'expected') : 'illustrative';
  return confBadgeHTML(conf, {
    label: (a.label || craft) + (flight && flight.airline ? ' · ' + flight.airline : ''),
    source: listed ? (a.source || 'Curated type template') : 'Assumed narrowbody from carrier code',
    version: a.version || 1,
    checked: 'on template load',
    applies: craft + ' · ' + a.seats + ' seats · ' + ((a.sections || []).map((s) => s.name).join(' + ')),
  });
}

/* ===========================================================================
   ICON + TEXT STATE LEGEND
   Colour alone is never the signal, and "no information" is spelled out so a
   blank-looking cell cannot be mistaken for a free seat.
   =========================================================================== */
function stateLegendHTML(extra) {
  const order = ['mine', 'target', 'open', 'requested', 'matched', 'unknown'];
  const items = order.map((k) => {
    const s = SEAT_STATE[k];
    return `<span class="lg lg-${s.tone}"><i class="lg-sw" aria-hidden="true">${s.icon}</i>${s.label}</span>`;
  });
  for (const e of extra || []) items.push(`<span class="lg ${e.cls || ''}"><i class="lg-sw" aria-hidden="true">${e.icon || ''}</i>${e.text}</span>`);
  items.push(`<span class="lg lg-note">Blank / hatched = <b>no information</b>, never a free seat</span>`);
  return items.join('');
}

/* ===========================================================================
   ELEVATION VIEW — the direct answer to "where in the compartment?"
   A top-view coach map cannot show height, and writing TOP/MID/FLOOR as three
   word-lists still makes the traveller rebuild the stack in their head. Here the
   rows ARE the levels and the columns ARE the two facing benches plus the
   corridor-side pair, so berth height is its real vertical position.
   =========================================================================== */
function levelRowLabel(level) { return ({ 3: 'TOP', 2: 'MID', 1: 'FLOOR' })[level] || ''; }

function renderBerthElevation(el, opts) {
  const { train, coach, bay, mine = null, wanted = [], peerSeats = [], onPick } = opts || {};
  const spec = specOf(train, coach);
  if (!isBerthSpec(spec)) { el.innerHTML = ''; return; }
  const [start, end] = bayRange(spec, bay);
  const nums = [];
  for (let n = start; n <= end; n++) nums.push(n);

  const cols = [
    { key: 'A', head: 'Bench A', sub: 'faces bench B' },
    { key: 'B', head: 'Bench B', sub: 'faces bench A' },
    { key: 'S', head: 'Corridor side', sub: 'lengthwise along the wall' },
  ];

  const cell = (n) => {
    const t = berthTypeOf(spec, n);
    const b = BERTH_TYPES[t];
    const d = seatDisplay(t);
    const cls = ['cell', 'elev-berth', 't-' + t];
    if (n === mine) cls.push('mine');
    if (wanted.includes(n)) cls.push('want');
    if (peerSeats.includes(n)) cls.push('peer');
    const extra = n === mine ? ', your seat' : peerSeats.includes(n) ? ', a traveller open to swapping' : '';
    const where = b.side ? 'the corridor-side pair' : 'bench ' + (benchOf(spec, n) || '?');
    const aria = `Berth ${n}, ${d.name}, ${levelRowLabel(b.level)} level, on ${where}${extra}`;
    return `<button type="button" class="${cls.join(' ')}" data-seat="${n}" aria-pressed="${n === mine}"
        aria-label="${aria}" title="${aria}"
      ><span class="cell-n">${n}</span><span class="cell-t">${d.name.replace(' berth', '')}</span>
      <span class="cell-s" aria-hidden="true">${n === mine ? '●' : peerSeats.includes(n) ? '⇄' : ''}</span></button>`;
  };

  const grid = [];
  grid.push('<div class="elev-h elev-h--blank"></div>' + cols.map((c) => `<div class="elev-h">${c.head}<span>${c.sub}</span></div>`).join(''));
  for (const lv of [3, 2, 1]) {
    grid.push(`<div class="elev-lv elev-lv${lv}"><b>${levelRowLabel(lv)}</b></div>`);
    for (const c of cols) {
      const inCol = nums.filter((n) => {
        const t = BERTH_TYPES[berthTypeOf(spec, n)];
        return t.level === lv && (c.key === 'S' ? t.side : (!t.side && benchOf(spec, n) === c.key));
      });
      grid.push(`<div class="elev-col elev-col-${c.key}">` +
        (inCol.length ? inCol.map(cell).join('') : '<div class="elev-cell elev-empty" aria-hidden="true">—</div>') + '</div>');
    }
  }

  const totalBays = bayCount(spec);
  const fromDoor = Math.min(bay - 1, totalBays - bay);
  el.innerHTML = `<figure class="elev">
    <figcaption>
      <b>Cross-section · bay ${bay}</b> of ${totalBays} · berths ${start}–${end} · ${spec.label} · coach ${coach}
      <span class="elev-note">${fromDoor === 0 ? 'This is the bay nearest the door.' : fromDoor + (fromDoor === 1 ? ' bay' : ' bays') + ' from the door.'}
      ${spec.cabin ? ' AC First is a lockable cabin, not an open bay — expect cabin crew or TTE involvement.' : ''}</span>
    </figcaption>
    <div class="elev-grid">${grid.join('')}</div>
    <div class="elev-floor"><span>coach floor</span></div>
    <div class="elev-keys">
      <span><i class="k-floor"></i>floor level — easiest in and out</span>
      <span><i class="k-mid"></i>middle — folds away by day</span>
      <span><i class="k-top"></i>top — private, needs a climb</span>
      <span><i class="k-side"></i>corridor side — lengthwise, narrower</span>
    </div>
  </figure>`;
  el.querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', () => onPick && onPick(parseInt(b.dataset.seat, 10))));
}

/* Inject the elevation above the level lists inside an existing zoombox. */
function mountElevation(container, opts) {
  if (!container) return null;
  const old = container.querySelector('.elev-mount');
  if (old) old.remove();
  const box = document.createElement('div');
  box.className = 'elev-mount';
  renderBerthElevation(box, opts);
  container.insertBefore(box, container.firstChild);
  return box;
}
