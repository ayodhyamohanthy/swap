/* SwapSeat · flights + demo marketplace seeds + display helpers.
   data.js owns rail geometry; this file owns skies + the meta layer the
   renderers use (berth/seat names, icons, scores). Nothing here is fetched —
   swap FLIGHTS/AIRCRAFT for live airline data when ready. */

const AIRCRAFT = {
  'A20N': { label: 'Airbus A320neo', rows: 32, layout: '3-3', seats: ['A','B','C','D','E','F'], exits: [1, 12, 13, 14], legroom: [1, 12, 13], toilets: [1, 30], wings: [11, 12, 13, 14, 15], desc: 'IndiGo / Air India short-haul workhorse' },
  'B738': { label: 'Boeing 737-800', rows: 33, layout: '3-3', seats: ['A','B','C','D','E','F'], exits: [1, 14, 15, 16], legroom: [1, 14, 15], toilets: [1, 31], wings: [12, 13, 14, 15, 16], desc: 'SpiceJet / Air India Express' },
  'A21N': { label: 'Airbus A321neo', rows: 34, layout: '3-3', seats: ['A','B','C','D','E','F'], exits: [1, 11, 12, 25, 26], legroom: [1, 11, 25], toilets: [1, 34], wings: [11, 12, 13, 14], desc: 'Longer single-aisle' },
  'B788': { label: 'Boeing 787-8 Dreamliner', rows: 40, layout: '3-3-3', seats: ['A','B','C','D','E','F','G','H','J'], exits: [1, 10, 20, 30], legroom: [1, 10, 20], toilets: [1, 20, 39], wings: [14, 15, 16, 17, 18, 19, 20], desc: 'Air India long-haul' },
  'AT72': { label: 'ATR 72-600', rows: 18, layout: '2-2', seats: ['A','C','D','F'], exits: [1, 18], legroom: [1], toilets: [18], wings: [6, 7, 8, 9], desc: 'Regional turboprop' },
};

const FLIGHTS = [
  { no: '6E2031', airline: 'IndiGo', from: 'DEL', to: 'BOM', craft: 'A20N', country: 'IN' },
  { no: 'AI202', airline: 'Air India', from: 'DEL', to: 'JFK', craft: 'B788', country: 'IN' },
  { no: 'EK507', airline: 'Emirates', from: 'BOM', to: 'DXB', craft: 'B738', country: 'AE' },
  { no: 'UA82', airline: 'United', from: 'EWR', to: 'DEL', craft: 'B788', country: 'US' },
  { no: 'SG881', airline: 'SpiceJet', from: 'DEL', to: 'GOI', craft: 'B738', country: 'IN' },
  { no: 'BA178', airline: 'British Airways', from: 'JFK', to: 'LHR', craft: 'B788', country: 'GB' },
];
const FLIGHT_INDEX = {};
for (const f of FLIGHTS) FLIGHT_INDEX[f.no] = f;

/* Seeded demo marketplace (localStorage user posts merge on top). */
const SEED_SWAPS = [
  { id: 's1', mode: 'train', trainNo: '12951', coach: 'B2', seat: 22, want: ['LB','SL'], name: 'Priya · Family of 3', note: 'Kids in B3, want same bay 🙏', verified: true, plus: true, ts: Date.now() - 36e5 },
  { id: 's2', mode: 'train', trainNo: '12951', coach: 'B2', seat: 7, want: ['UB','SU'], name: 'Ramesh · Sr. citizen', note: 'Side lower offered, need lower main', verified: true, plus: false, ts: Date.now() - 72e5 },
  { id: 's3', mode: 'flight', flightNo: '6E2031', seat: '24C', want: ['W'], name: 'Alex · Window lover', note: 'Middle → window, front half pls', verified: true, plus: false, ts: Date.now() - 18e5 },
  { id: 's4', mode: 'train', trainNo: '12002', coach: 'C3', seat: 14, want: ['W'], name: 'Sara · Solo', note: 'Aisle → window for views', verified: false, plus: false, ts: Date.now() - 54e5 },
];

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

function berthMeta(type) {
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

function flightSeatMeta(letter, row, craft) {
  const spec = AIRCRAFT[craft];
  const L = String(letter).toUpperCase();
  let type = 'M';
  if (!spec) return { type, exit: false, wing: false, ...berthMeta(type) };
  if (spec.layout === '3-3') type = (L === 'A' || L === 'F') ? 'W' : (L === 'C' || L === 'D') ? 'A' : 'M';
  if (spec.layout === '2-2') type = (L === 'A' || L === 'F') ? 'W' : 'A';
  if (spec.layout === '3-3-3') type = (['A','J'].includes(L)) ? 'W' : (['C','D','G','H'].includes(L)) ? 'A' : 'M';
  const exit = spec.exits.includes(row);
  const wing = row >= Math.min(...spec.wings) && row <= Math.max(...spec.wings);
  return { type, exit, wing, ...berthMeta(type) };
}
