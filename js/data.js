/* ===========================================================================
   SwapSeat · journey + seat-geometry database
   ---------------------------------------------------------------------------
   The whole thesis of SwapSeat: a seat is a PLACE, not a label. Every diagram
   in seatmaps.js is derived from the tables below and nothing is hard-coded in
   the renderers — so wiring up a live source later (IR/PRS coach composition,
   operator/UIC seat maps, airline cabin data) means replacing tables only.

   DEFAULT GEOMETRY, AND WHY
   · Indian Railways berths: 6 main berths + 2 side berths per bay (3+3+2).
     Bay 1 holds berths 1-8 in a fixed order:
        1 LB · 2 MB · 3 UB   (bench A, transverse)
        4 LB · 5 MB · 6 UB   (bench B, faces bench A)
        7 SL · 8 SU          (longitudinal, against the coach wall)
     3E adds a 9th berth (SM). 2A drops every middle berth (6 per bay).
     1A is cabins (4-berth) + coupes (2-berth) instead of open bays.
     ICF rake: SL 72 · 3A 64        LHB rake: SL 80 · 3A 72
   · Chair cars (CC/EC/2S and every non-IR operator) are numbered sequentially
     inside the coach. The row + position drawn in the map is derived from that
     seat number — the ticket value stays the number.
   · Aircraft cabins: typical two/three-class layouts per aircraft TYPE
     (186-seat A320neo, 78-seat ATR 72-600 2-2, 256-seat 787-8, 777-300ER …).
     Airlines re-configure; a flight can override with `craftConfig`.
   =========================================================================== */

/* Airlines skip the letter I in row letters. */
const SEAT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/* ---------- berth vocabulary ---------------------------------------------- */
/* level: 1 = floor, 2 = middle, 3 = top.  bench: A / B / S(side corridor). */
const BERTH_TYPES = {
  LB: { type: 'LB', name: 'Lower berth',     level: 1, bench: 'A', side: false, seats: 3, best: ['elders', 'families'], note: 'Floor level, doubles as the day bench. Easiest to board and to reach.' },
  MB: { type: 'MB', name: 'Middle berth',    level: 2, bench: 'A', side: false, seats: 3, best: [], note: 'Folds up flat between 06:00 and 22:00. Sleeping hours only.' },
  UB: { type: 'UB', name: 'Upper berth',     level: 3, bench: 'A', side: false, seats: 3, best: ['privacy'], note: 'Top of the stack. Most private, needs a climb, no window view when lying down.' },
  SL: { type: 'SL', name: 'Side lower',      level: 1, bench: 'S', side: true,  seats: 2, best: ['solo', 'day travellers'], note: 'Runs lengthwise along the wall. Sofa by day, berth by night. Shortest berth.' },
  SM: { type: 'SM', name: 'Side middle',     level: 2, bench: 'S', side: true,  seats: 2, best: [], note: 'Extra fold-down berth found only in 3E economy coaches.' },
  SU: { type: 'SU', name: 'Side upper',      level: 3, bench: 'S', side: true,  seats: 2, best: ['privacy', 'day travellers'], note: 'Lengthwise upper along the wall. Stays usable as a seat all day.' },
};

/* Row-position vocabulary for chair cars and aircraft. */
const SEAT_POSITIONS = {
  W: { type: 'W', name: 'Window',  seek: 'view + a wall to lean on', score: 88 },
  A: { type: 'A', name: 'Aisle',   seek: 'freedom to get up, elbow room in the aisle', score: 82 },
  M: { type: 'M', name: 'Middle',  seek: 'no view, no armrest, but cheap and easy to swap', score: 45 },
};

/* ---------- spec builders -------------------------------------------------- */
/* Bay pattern is expanded into one flat array: berth N is COACH_SPECS[x].layout[N-1].
   `end` models a short final bay (2A end section, 1A coupes, ATR end row). */
function berthSpec(code, o) {
  const layout = [];
  for (let b = 0; b < o.bays; b++) for (const t of o.pattern) layout.push(t);
  if (o.end) for (const t of o.end) layout.push(t);
  return {
    ...o, code, family: 'berth', layout, seats: layout.length,
    baySize: o.pattern.length,
    bays: o.bays + (o.end ? 1 : 0),
  };
}

function lettersFor(groups) {
  let i = 0, out = [];
  for (const g of groups) { const row = []; for (let k = 0; k < g; k++) row.push(SEAT_ALPHABET[i++]); out.push(row); }
  return out;
}

/* A chair car: `groups` is the across-the-coach layout, e.g. [3,3] or [3,2]. */
function chairSpec(code, o) {
  const groups = o.groups;
  const perRow = groups.reduce((a, b) => a + b, 0);
  const full = Math.floor(o.seats / perRow);
  const endRow = o.seats - full * perRow;
  return {
    ...o, code, family: 'chair', groups, perRow,
    letters: o.letters || lettersFor(groups),
    rows: o.rows || full + (endRow ? 1 : 0),
    endRow: o.endRow || endRow,
    layout: null,
    bays: null,
  };
}

/* ---------- COACH_SPECS ---------------------------------------------------- */
/* IR sleeper / AC berth classes — full bay geometry. */
const COACH_SPECS = {
  SL:    berthSpec('SL', { label: 'Sleeper (ICF)', short: 'SL', rake: 'ICF', family: 'berth', bays: 9,
                           pattern: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'],
                           pitch: '~1.85 m berth', desc: 'Open bays, no AC. 9 bays × 8 berths.' }),
  SLLHB: berthSpec('SLLHB', { label: 'Sleeper (LHB)', short: 'SL', rake: 'LHB', family: 'berth', bays: 10,
                           pattern: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'],
                           pitch: '~1.85 m berth', desc: 'Longer LHB body, 10 bays × 8 berths.' }),
  '3A':  berthSpec('3A', { label: 'AC 3-Tier (ICF)', short: '3A', rake: 'ICF', family: 'berth', bays: 8,
                           pattern: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'],
                           pitch: '~1.85 m berth', desc: 'Curtains + bedding. 8 bays × 8 berths.' }),
  '3ALHB': berthSpec('3ALHB', { label: 'AC 3-Tier (LHB)', short: '3A', rake: 'LHB', family: 'berth', bays: 9,
                           pattern: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'],
                           pitch: '~1.85 m berth', desc: 'Curtains + bedding. 9 bays × 8 berths.' }),
  '3E':  berthSpec('3E', { label: 'AC 3-Tier Economy', short: '3E', rake: 'LHB', family: 'berth', bays: 9,
                           pattern: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SM', 'SU'],
                           pitch: '~1.85 m berth', desc: '9 berths per bay — the extra is the side-middle.' }),
  '2A':  berthSpec('2A', { label: 'AC 2-Tier (LHB)', short: '2A', rake: 'LHB', family: 'berth', bays: 9,
                           pattern: ['LB', 'UB', 'LB', 'UB', 'SL', 'SU'],
                           pitch: '~1.85 m berth', desc: 'No middle berth. 9 bays × 6 berths.' }),
  '2AI': berthSpec('2AI', { label: 'AC 2-Tier (ICF)', short: '2A', rake: 'ICF', family: 'berth', bays: 7,
                           pattern: ['LB', 'UB', 'LB', 'UB', 'SL', 'SU'], end: ['LB', 'UB', 'LB', 'UB'],
                           pitch: '~1.85 m berth', desc: '7 full bays + a short end cabin.' }),
  '1A':  berthSpec('1A', { label: 'AC First (LHB)', short: '1A', rake: 'LHB', family: 'berth', bays: 4,
                           pattern: ['LB', 'UB', 'LB', 'UB'],
                           end: ['LB', 'UB', 'LB', 'UB', 'LB', 'UB', 'LB', 'UB'], cabin: true,
                           pitch: 'cabin / coupe', desc: '4 cabins of 4 + 4 two-berth coupes. Doors that lock.' }),
  '1AI': berthSpec('1AI', { label: 'AC First (ICF)', short: '1A', rake: 'ICF', family: 'berth', bays: 4,
                           pattern: ['LB', 'UB', 'LB', 'UB'], end: ['LB', 'UB', 'LB', 'UB', 'LB', 'UB'], cabin: true,
                           pitch: 'cabin / coupe', desc: '4 cabins of 4 + 3 two-berth coupes.' }),

  /* ---------- IR chair cars ---------- */
  CC:    chairSpec('CC', { label: 'AC Chair Car', short: 'CC', groups: [3, 3], seats: 78,
                          pitch: '~1,000 mm', desc: '3+3 pushback, day trains (Shatabdi, Jan Shatabdi).' }),
  CCVB:  chairSpec('CCVB', { label: 'Chair Car (Vande Bharat)', short: 'CC', groups: [3, 2], seats: 78,
                          pitch: '~1,040 mm', desc: '3+2 seating, fixed forward/backward, charging point per seat.' }),
  EC:    chairSpec('EC', { label: 'Executive Chair Car', short: 'EC', groups: [2, 2], seats: 56,
                          pitch: '~1,200 mm', desc: '2+2 LHB executive. Wider seat, deeper recline.' }),
  ECVB:  chairSpec('ECVB', { label: 'Executive Class (Vande Bharat)', short: 'EC', groups: [2, 2], seats: 52,
                          pitch: '~1,270 mm', rotate: true, desc: '2+2 rotating seats — the pair turns to face travel.' }),
  '2S':  chairSpec('2S', { label: 'Second Sitting', short: '2S', groups: [3, 3], seats: 108,
                          pitch: '~900 mm', desc: 'Non-AC 3+3 bench seating.' }),

  /* ---------- Global operators: seat numbers, per coach, like flights ---------- */
  ES_STD:     chairSpec('ES_STD', { label: 'Eurostar Standard', short: 'STD', groups: [2, 2], seats: 80, pitch: '~880 mm', desc: 'Eurostar e320 / Class 374 standard class.' }),
  ES_PLUS:    chairSpec('ES_PLUS', { label: 'Standard Premier', short: 'SP', groups: [2, 1], seats: 36, pitch: '~1,100 mm', desc: 'Eurostar Standard Premier — 2+1, wider.' }),
  SHINK_RES:  chairSpec('SHINK_RES', { label: 'Shinkansen Reserved', short: 'RES', groups: [3, 2], seats: 100, pitch: '~1,040 mm', desc: 'N700S ordinary reserved car, 3+2.' }),
  SHINK_FREE: chairSpec('SHINK_FREE', { label: 'Shinkansen Non-reserved', short: 'FREE', groups: [3, 2], seats: 100, pitch: '~1,040 mm', desc: 'Cars 1-3 carry no seat guarantee — the most-swapped cars on the train.' }),
  SHINK_GREEN: chairSpec('SHINK_GREEN', { label: 'Green Car', short: 'GREEN', groups: [2, 2], seats: 56, pitch: '~1,160 mm', desc: 'First-class Shinkansen, 2+2 with 1.16 m pitch.' }),
  ICE_2ND:    chairSpec('ICE_2ND', { label: 'ICE 2nd class', short: '2nd', groups: [2, 2], seats: 52, pitch: '~920 mm', desc: 'DB ICE open saloon; some bays sit round a table.' }),
  ICE_1ST:    chairSpec('ICE_1ST', { label: 'ICE 1st class', short: '1st', groups: [2, 1], seats: 36, pitch: '~1,100 mm', desc: 'DB ICE 1st class, 2+1.' }),
  TGV_2ND:    chairSpec('TGV_2ND', { label: 'TGV inOui 2nd', short: '2nd', groups: [2, 2], seats: 72, pitch: '~900 mm', desc: 'TGV inOui 2nde classe (duplex upper or lower deck).' }),
  FRECCIA:    chairSpec('FRECCIA', { label: 'Frecciarossa Standard', short: 'STD', groups: [2, 2], seats: 56, pitch: '~940 mm', desc: 'Frecciarossa 1000 standard.' }),
  AZUMA_STD:  chairSpec('AZUMA_STD', { label: 'Azuma Standard', short: 'STD', groups: [2, 2], seats: 72, pitch: '~900 mm', desc: 'LNER Class 800 standard class.' }),
  AZUMA_1ST:  chairSpec('AZUMA_1ST', { label: 'Azuma First', short: '1st', groups: [2, 1], seats: 36, pitch: '~1,100 mm', desc: 'LNER Class 800 first class, 2+1.' }),
  AMTK_COACH: chairSpec('AMTK_COACH', { label: 'Amtrak Coach', short: 'COACH', groups: [2, 2], seats: 72, pitch: '~1,000 mm', desc: 'Amfleet II / Superliner coach class.' }),
  AMTK_BIZ:   chairSpec('AMTK_BIZ', { label: 'Amtrak Business', short: 'BIZ', groups: [2, 2], seats: 32, pitch: '~1,150 mm', desc: 'Business class — 2+2 with extra pitch.' }),
  AMTK_ROOM:  berthSpec('AMTK_ROOM', { label: 'Amtrak Sleeper', short: 'ROOM', family: 'berth', bays: 5,
                          pattern: ['LB', 'UB', 'SL', 'SU'], cabin: true, rake: 'US',
                          pitch: 'roomette / bedroom', desc: 'Superliner: roomettes + family bedroom + accessible room, all private with a door.' }),
  CN_2ND:     chairSpec('CN_2ND', { label: 'Open saloon 2nd', short: '2nd', groups: [2, 2], seats: 76, pitch: '~920 mm', desc: 'Generic European / US open saloon.' }),

};

const CLASS_TO_SPEC = {
  LHB: { '1A': '1A', '2A': '2A', '3A': '3ALHB', '3E': '3E', SL: 'SLLHB', CC: 'CC', EC: 'EC', '2S': '2S' },
  ICF: { '1A': '1AI', '2A': '2AI', '3A': '3A', '3E': '3E', SL: 'SL', CC: 'CC', EC: 'EC', '2S': '2S' },
  VB:  { EC: 'ECVB', CC: 'CCVB', SL: 'SLLHB', '2S': '2S' },
  EU:  { '1A': 'ICE_1ST', '2A': 'ICE_2ND', '3A': 'ICE_2ND', SL: 'CN_2ND', CC: 'TGV_2ND', EC: 'ICE_1ST', '2S': 'TGV_2ND' },
  JP:  { '1A': 'SHINK_GREEN', '2A': 'SHINK_RES', '3A': 'SHINK_RES', SL: 'SHINK_FREE', CC: 'SHINK_RES', EC: 'SHINK_GREEN', '2S': 'SHINK_FREE' },
  US:  { '1A': 'AMTK_ROOM', '2A': 'AMTK_BIZ', '3A': 'AMTK_COACH', SL: 'AMTK_ROOM', CC: 'AMTK_COACH', EC: 'AMTK_BIZ', '2S': 'AMTK_COACH' },
};

/* Coach code prefix → class. 'GS' (general second sitting) is the exception. */
function coachClassFromCoachCode(code) {
  const raw = String(code || '').toUpperCase();
  if (raw === 'GS' || raw === 'GEN') return '2S';
  const p = raw.replace(/[^A-Z]/g, '').charAt(0);
  return ({ H: '1A', A: '2A', B: '3A', G: '3E', S: 'SL', C: 'CC', E: 'EC', D: '2S', P: '3A', L: 'CC', M: 'CC', R: 'EC', V: '3A', W: 'CC' })[p] || 'SL';
}

/* Resolve the spec key for one coach of one train. */
function specKeyFor(train, coachCode) {
  const code = String(coachCode || '').toUpperCase();
  const map = { ...(CLASS_TO_SPEC[(train && train.rake) || 'ICF'] || CLASS_TO_SPEC.ICF), ...((train && train.specs) || {}) };
  if (map[code]) return map[code];
  for (let n = code.length - 1; n >= 1; n--) { const p = code.slice(0, n); if (map[p]) return map[p]; }
  const letters = code.replace(/[^A-Z]/g, '');
  if (letters && letters !== code && map[letters]) return map[letters];
  return map[coachClassFromCoachCode(code)] || 'SL';
}

function specOf(train, coachCode) {
  return COACH_SPECS[specKeyFor(train, coachCode)] || COACH_SPECS.SL;
}

/* ---------------------------------------------------------------------------
   TRAINS — number → coach composition. Coach codes are the real thing you read
   off the platform display (S4, B7, C14, 21 …); `specs` maps a coach code or a
   prefix to a geometry spec, so mixed rakes need no special-casing.
   ------------------------------------------------------------------------- */
const span = (prefix, from, to) => { const a = []; for (let i = from; i <= to; i++) a.push(prefix + i); return a; };

const TRAINS = [
  /* ---------------- India ---------------- */
  { no: '12951', name: 'Mumbai Rajdhani Express', operator: 'Indian Railways', country: 'IN', rake: 'LHB',
    from: 'MMCT', to: 'NDLS', dur: '15h 32m',
    coaches: ['H1', ...span('A', 1, 5), ...span('B', 1, 11), 'PC'], specs: { H: '1A', A: '2A', B: '3ALHB' },
    keys: 'mumbai rajdhani delhi ndls bct mumbai central premium' },
  { no: '12002', name: 'Bhopal Shatabdi Express', operator: 'Indian Railways', country: 'IN', rake: 'ICF',
    from: 'NDLS', to: 'BPL', dur: '8h 05m',
    coaches: ['E1', ...span('C', 1, 6)], specs: { E: 'EC', C: 'CC' },
    keys: 'bhopal shatabdi taj day train agra' },
  { no: '22436', name: 'Vande Bharat Express', operator: 'Indian Railways', country: 'IN', rake: 'VB',
    from: 'NDLS', to: 'BSB', dur: '8h 00m',
    coaches: [...span('E', 1, 2), ...span('C', 1, 14)], specs: { E: 'ECVB', C: 'CCVB' },
    keys: 'vande bharat varanasi bsb delhi train 18 sixteen coach' },
  { no: '20901', name: 'Mumbai–Gandhinagar Vande Bharat', operator: 'Indian Railways', country: 'IN', rake: 'VB',
    from: 'MMCT', to: 'GNC', dur: '6h 25m',
    coaches: [...span('E', 1, 2), ...span('C', 1, 14)], specs: { E: 'ECVB', C: 'CCVB' },
    keys: 'vande bharat gandhinagar ahmedabad mumbai central surat' },
  { no: '12259', name: 'Sealdah Duronto Express', operator: 'Indian Railways', country: 'IN', rake: 'LHB',
    from: 'NDLS', to: 'SDAH', dur: '17h 15m',
    coaches: ['H1', ...span('A', 1, 2), ...span('B', 1, 8), ...span('S', 1, 4)], specs: { H: '1A', A: '2A', B: '3ALHB', S: 'SLLHB' },
    keys: 'sealdah duronto kolkata non stop' },
  { no: '12621', name: 'Tamil Nadu Express', operator: 'Indian Railways', country: 'IN', rake: 'LHB',
    from: 'NDLS', to: 'MAS', dur: '33h 10m',
    coaches: ['A1', ...span('B', 1, 4), ...span('S', 1, 6), 'GS'], specs: { A: '2A', B: '3ALHB', S: 'SLLHB', GS: '2S' },
    keys: 'tamil nadu express chennai mas delhi long distance' },
  { no: '12925', name: 'Paschim Express', operator: 'Indian Railways', country: 'IN', rake: 'ICF',
    from: 'MMCT', to: 'ASR', dur: '30h 55m',
    coaches: ['A1', ...span('B', 1, 2), ...span('S', 1, 6), 'D1', 'D2'], specs: { A: '2AI', B: '3A', S: 'SL', D: '2S' },
    keys: 'paschim express amritsar mumbai punjab' },
  { no: '22119', name: 'Tejas Express Mumbai → Karmali', operator: 'Indian Railways', country: 'IN', rake: 'LHB',
    from: 'CSMT', to: 'KRMI', dur: '8h 50m',
    coaches: ['E1', ...span('C', 1, 9)], specs: { E: 'EC', C: 'CC' },
    keys: 'tejas express goa karmali mumbai csmt' },
  { no: '12626', name: 'Kerala Express', operator: 'Indian Railways', country: 'IN', rake: 'ICF',
    from: 'NDLS', to: 'TVC', dur: '48h 00m',
    coaches: ['A1', ...span('B', 1, 2), ...span('S', 1, 9), 'D1'], specs: { A: '2AI', B: '3A', S: 'SL', D: '2S' },
    keys: 'kerala express trivandrum delhi longest route' },
  { no: '12051', name: 'Mumbai Jan Shatabdi', operator: 'Indian Railways', country: 'IN', rake: 'ICF',
    from: 'CSMT', to: 'KRMI', dur: '9h 40m',
    coaches: ['C1', 'C2', ...span('D', 1, 5)], specs: { C: 'CC', D: '2S' },
    keys: 'jan shatabdi mumbai goa second sitting cheapest' },
];

/* Unknown train number → a plausible rake so the map still draws. */
const GENERIC_TRAIN = { no: '00000', name: 'Unlisted service', operator: 'Unknown operator', country: 'GLOBAL',
  rake: 'ICF', from: '—', to: '—', coaches: ['S1', 'S2', 'B1', 'A1', 'D1'], keys: '' };

const TRAIN_INDEX = {};
for (const t of TRAINS) TRAIN_INDEX[t.no] = t;

/* Global services ride in the same table — their seats are numbered per coach,
   exactly like an aircraft, so the same renderer draws them. */
TRAINS.push(
  { no: '9010', name: 'Eurostar London → Paris', operator: 'Eurostar', country: 'EU', rake: 'EU',
    from: 'STP', to: 'GPN', dur: '2h 16m', coaches: span('', 1, 16),
    specs: { 1: 'ES_PLUS', 2: 'ES_PLUS', 3: 'ES_PLUS' },
    keys: 'eurostar london paris st pancras gare du nord e320 class 374 channel tunnel' },
  { no: '9153', name: 'Eurostar London → Brussels', operator: 'Eurostar', country: 'EU', rake: 'EU',
    from: 'STP', to: 'BRU', dur: '2h 01m', coaches: span('', 1, 14), specs: { 1: 'ES_PLUS', 2: 'ES_PLUS' },
    keys: 'eurostar brussels bruxelles midi london standard premier' },
  { no: '954', name: 'ICE 954 Frankfurt → Amsterdam', operator: 'DB Fernverkehr', country: 'EU', rake: 'EU',
    from: 'FRA', to: 'AMS', dur: '4h 00m', coaches: [...span('', 21, 28), ...span('', 31, 38)],
    specs: { 2: 'ICE_1ST', 3: 'ICE_2ND' },
    keys: 'ice db deutsche bahn frankfurt amsterdam germany first class wagen' },
  { no: '6201', name: 'TGV inOui Paris → Lyon', operator: 'SNCF Voyageurs', country: 'EU', rake: 'EU',
    from: 'PLY', to: 'LYO', dur: '2h 00m', coaches: span('', 1, 9), specs: { 1: 'ICE_1ST' },
    keys: 'tgv inoui sncf paris gare de lyon duplex france voiture' },
  { no: '9505', name: 'Frecciarossa 1000 Roma → Milano', operator: 'Trenitalia', country: 'EU', rake: 'EU',
    from: 'ROM', to: 'MIL', dur: '2h 55m', coaches: span('', 1, 8), specs: { 1: 'ICE_1ST', 8: 'ICE_1ST' },
    keys: 'frecciarossa trenitalia italy rome milan roma milano 1000 carrozza' },
  { no: '200', name: 'Nozomi Shinkansen Tokyo → Shin-Osaka', operator: 'JR Central', country: 'JP', rake: 'JP',
    from: 'TYO', to: 'OSK', dur: '2h 21m', coaches: span('', 1, 16),
    specs: { 1: 'SHINK_FREE', 2: 'SHINK_FREE', 3: 'SHINK_FREE', 8: 'SHINK_GREEN', 9: 'SHINK_GREEN', 10: 'SHINK_GREEN' },
    keys: 'nozomi shinkansen n700s tokyo osaka japan green car reserved non reserved' },
  { no: '1E01', name: 'LNER Azuma Edinburgh → London', operator: 'LNER', country: 'UK', rake: 'EU',
    from: 'EDB', to: 'KGX', dur: '4h 20m', coaches: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
    specs: { A: 'AZUMA_1ST', B: 'AZUMA_1ST', L: 'AZUMA_1ST' },
    keys: 'lner azuma class 800 edinburgh kings cross standard first coach letter' },
  { no: '170', name: 'Amtrak Northeast Regional New York → Washington', operator: 'Amtrak', country: 'US', rake: 'US',
    from: 'NYP', to: 'WAS', dur: '3h 25m', coaches: [...span('C', 1, 6), 'B1'],
    specs: { C: 'AMTK_COACH', B: 'AMTK_BIZ' },
    keys: 'amtrak northeast regional new york washington penn station business class acela' },
  { no: '2150', name: 'Acela New York → Washington', operator: 'Amtrak', country: 'US', rake: 'US',
    from: 'NYP', to: 'WAS', dur: '2h 50m', coaches: [...span('C', 1, 4), 'B1'],
    specs: { C: 'AMTK_COACH', B: 'AMTK_BIZ' },
    keys: 'acela express amtrak first class business new york washington fastest' },
  { no: '5', name: 'California Zephyr Chicago → Emeryville', operator: 'Amtrak', country: 'US', rake: 'US',
    from: 'CHI', to: 'EMY', dur: '51h 20m', coaches: [...span('', 1, 3), ...span('', 4, 8)],
    specs: { 1: 'AMTK_ROOM', 2: 'AMTK_ROOM', 3: 'AMTK_ROOM', 4: 'AMTK_BIZ', 5: 'AMTK_BIZ' },
    keys: 'california zephyr amtrak superliner roomette bedroom rocky mountains chicago' },
);
for (const t of TRAINS) TRAIN_INDEX[t.no] = t;