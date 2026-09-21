/* SwapSeat · flights meta + demo marketplace seeds + display helpers.
   Rail geometry lives in data.js; aircraft cabins too (AIRCRAFT / FLIGHTS).
   This file only ADDS: the demo seeds, display meta, and seat-position
   helpers that read the data.js cabin model (sections + groups). */

/* (AIRCRAFT / FLIGHTS / FLIGHT_INDEX are declared in data.js — do NOT redeclare
   them here; duplicate consts kill every script on the page.) */

/* Seeded demo marketplace lives in data.js (SEED_SWAPS, geometry-resolved).
   Local user posts (localStorage) use the app shape; store.all() normalizes. */

/* ---------- display meta (icons + scores for pickers & cards) ---------- */
const BERTH_DISPLAY = {
  LB: { icon: '🛏️', score: 90 }, MB: { icon: '🛏️', score: 55 }, UB: { icon: '🛏️', score: 70 },
  SL: { icon: '💺', score: 75 }, SU: { icon: '💺', score: 80 }, SM: { icon: '💺', score: 50 },
  W:  { icon: '🪟', score: 88 }, M:  { icon: '💺', score: 45 }, A:  { icon: '🚶', score: 82 },
};

/* berthTypeOf keeps the old (specKey, n) call shape working on the new specs.
   Accepts a spec object too. */
function berthTypeOf(specKeyOrSpec, n) {
  const spec = typeof specKeyOrSpec === 'object' ? specKeyOrSpec : COACH_SPECS[specKeyOrSpec];
  if (!spec) return '?';
  if (spec.family === 'berth') return spec.layout[(n - 1)] || '?';
  const info = chairSeatInfo(spec, n);
  return info ? info.pos : '?';
}

function seatDisplay(type) {
  if (BERTH_TYPES[type]) {
    const b = BERTH_TYPES[type];
    const d = BERTH_DISPLAY[type] || { icon: '🛏️', score: 60 };
    return { name: b.name, level: b.note, icon: d.icon, score: d.score };
  }
  if (SEAT_POSITIONS[type]) {
    const s = SEAT_POSITIONS[type];
    const d = BERTH_DISPLAY[type] || { icon: '💺', score: 60 };
    return { name: s.name + ' Seat', level: s.seek, icon: d.icon, score: s.score };
  }
  return { name: type, level: '', icon: '💺', score: 60 };
}

/* Chair-car seat number → {row, letter, pos W/A/M}. Numbers run sequentially. */
function chairSeatInfo(spec, n) {
  if (!spec || spec.family !== 'chair') return null;
  if (n < 1 || n > spec.seats) return null;
  const perRow = spec.perRow, col = (n - 1) % perRow, row = Math.floor((n - 1) / perRow) + 1;
  let g = 0, c = col;
  while (g < spec.groups.length && c >= spec.groups[g]) { c -= spec.groups[g]; g++; }
  if (g >= spec.groups.length) return null;
  const gsize = spec.groups[g], first = g === 0, last = g === spec.groups.length - 1;
  let pos;
  if (gsize === 1) pos = 'W';                       // solo seat: window side
  else if (first) pos = c === 0 ? 'W' : (c === gsize - 1 ? 'A' : 'M');
  else if (last) pos = c === 0 ? 'A' : (c === gsize - 1 ? 'W' : 'M');
  else pos = (c === 0 || c === gsize - 1) ? 'A' : 'M';
  const letter = (spec.letters[g] && spec.letters[g][c]) || SEAT_ALPHABET[col] || '?';
  return { row, letter, pos, group: g };
}

/* Section of a cabin holding a given row (data.js cabin model). */
function flightSection(craft, row) {
  const a = (typeof AIRCRAFT !== 'undefined') ? AIRCRAFT[craft] : null;
  if (!a) return null;
  return (a.sections || []).find(s => row >= s.from && row <= s.to) || null;
}

function flightSeatMeta(letter, row, craft) {
  const a = (typeof AIRCRAFT !== 'undefined') ? AIRCRAFT[craft] : null;
  const L = String(letter).toUpperCase();
  if (!a) return { type: 'M', exit: false, wing: false, ...seatDisplay('M') };
  let type = 'M';
  const sec = flightSection(craft, row);
  if (sec) {
    let gi = -1, ki = -1;
    (sec.letters || []).forEach((arr, g) => { const k = arr.indexOf(L); if (k >= 0) { gi = g; ki = k; } });
    if (gi >= 0) {
      const gsize = sec.groups[gi], first = gi === 0, last = gi === sec.groups.length - 1;
      if (gsize === 1) type = (sec.groups.length === 1 || first || last) ? 'W' : 'A';
      else if (first) type = ki === 0 ? 'W' : (ki === gsize - 1 ? 'A' : 'M');
      else if (last) type = ki === 0 ? 'A' : (ki === gsize - 1 ? 'W' : 'M');
      else type = (ki === 0 || ki === gsize - 1) ? 'A' : 'M';
    }
  }
  const exit = (a.exits || []).includes(row);
  const wing = !!(a.wings && row >= a.wings[0] && row <= a.wings[1]);
  return { type, exit, wing, ...seatDisplay(type) };
}

/* Approximate public seat description — NEVER an exact number.
   What the other traveller shows before payment conditions are met. */
function approxSeat(s) {
  const third = (i, n) => (n <= 1 ? 'middle' : i < n / 3 ? 'front' : i < 2 * n / 3 ? 'middle' : 'rear');
  const comfort = (score) => `comfort ${Math.max(1, Math.round(score / 10))}/10`;
  if (s.mode === 'flight') {
    const p = (typeof parseFlightSeat === 'function' ? parseFlightSeat(s.seat) : null);
    const m = flightSeatMeta(s.seat.slice(-1), parseInt(s.seat, 10), s.craft || 'A20N');
    let sec = '';
    try {
      const a = AIRCRAFT[s.craft || 'A20N'];
      const sc = p && a ? a.sections.find(x => p.row >= x.from && p.row <= x.to) : null;
      sec = sc ? `${sc.name} · ${third(p.row - sc.from, sc.to - sc.from + 1)} section · ` : '';
    } catch {}
    return `${sec}${m.name}${m.exit ? ' · exit row' : ''} · ${comfort(m.score)}`;
  }
  const train = (typeof trainOf === 'function' ? trainOf(s) : null) || { rake: 'ICF', coaches: [], specs: {} };
  const spec = specOf(train, s.coach);
  const t = berthTypeOf(spec, s.seat), m = seatDisplay(t);
  let where;
  if (isBerthSpec(spec)) {
    const bays = (typeof bayCount === 'function' ? bayCount(spec) : 9), b = bayOfSpec(spec, s.seat);
    const deck = spec.code === 'BUS_SLEEP' ? ((s.seat <= 15 ? 'Lower deck' : 'Upper deck') + ' · ') : '';
    where = `${deck}${third(b - 1, bays)} section · Bay ${b}`;
  } else {
    const info = chairSeatInfo(spec, s.seat);
    const r = info ? info.row : 1;
    where = `row ${r} of ${spec.rows} (${third(r - 1, spec.rows)})`;
  }
  return `${s.coach} · ${where} · ${m.name} · ${comfort(m.score)}`;
}

function confirmationId(req) { return 'SWAP-' + String(req.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase(); }
