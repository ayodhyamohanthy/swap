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
    bays: Math.ceil(layout.length / o.pattern.length),
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
  '3E':  berthSpec('3E', { label: 'AC 3-Tier Economy', short: '3E', rake: 'LHB', family: 'berth', bays: 10,
                           pattern: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'],
                           end: ['LB', 'MB', 'UB'],
                           pitch: '~1.85 m berth', desc: '10 bays × 8 + end triple = 83. No side-middle (verified vs etrain.info 3E diagram).' }),
  GRB:  berthSpec('GRB', { label: 'AC 3-Tier (Garib Rath)', short: '3A', rake: 'IR', family: 'berth', bays: 9,
                           pattern: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SM', 'SU'],
                           pitch: '~1.85 m berth', desc: '9 berths per bay — the extra is the side-middle. 81 total (verified vs etrain.info diagram).' }),
  '2A':  berthSpec('2A', { label: 'AC 2-Tier (LHB)', short: '2A', rake: 'LHB', family: 'berth', bays: 9,
                           pattern: ['LB', 'UB', 'LB', 'UB', 'SL', 'SU'],
                           pitch: '~1.85 m berth', desc: 'No middle berth. 9 bays × 6 berths.' }),
  '2AI': berthSpec('2AI', { label: 'AC 2-Tier (ICF)', short: '2A', rake: 'ICF', family: 'berth', bays: 7,
                           pattern: ['LB', 'UB', 'LB', 'UB', 'SL', 'SU'], end: ['LB', 'UB', 'SL', 'SU'],
                           pitch: '~1.85 m berth', desc: '7 full bays + a short end bay with side berths. 46 total (verified vs etrain.info diagram).' }),
  '1A':  berthSpec('1A', { label: 'AC First (LHB)', short: '1A', rake: 'LHB', family: 'berth', bays: 4,
                           pattern: ['LB', 'UB', 'LB', 'UB'],
                           end: ['LB', 'UB', 'LB', 'UB', 'LB', 'UB', 'LB', 'UB'], cabin: true,
                           pitch: 'cabin / coupe', desc: '4 cabins of 4 + 4 two-berth coupes. Doors that lock.' }),
  '1AI': berthSpec('1AI', { label: 'AC First (ICF)', short: '1A', rake: 'ICF', family: 'berth', bays: 4,
                           pattern: ['LB', 'UB', 'LB', 'UB'], end: ['LB', 'UB', 'LB', 'UB', 'LB', 'UB'], cabin: true,
                           pitch: 'cabin / coupe', desc: '4 cabins of 4 + 3 two-berth coupes.' }),

  /* ---------- IR chair cars (verified vs etrain.info diagrams) ---------- */
  CC:    chairSpec('CC', { label: 'AC Chair Car (ICF)', short: 'CC', groups: [3, 2], seats: 73,
                          pitch: '~1,000 mm', desc: '3+2, 73 seats (Shatabdi ICF). Facing bay pairs numbered in opposition.' }),
  CC_LHB: chairSpec('CC_LHB', { label: 'AC Chair Car (LHB)', short: 'CC', groups: [3, 3], seats: 78,
                          pitch: '~1,000 mm', desc: '3+3 pushback, 78 seats (Tejas / Jan Shatabdi LHB).' }),
  CCVB:  chairSpec('CCVB', { label: 'Chair Car (Vande Bharat)', short: 'CC', groups: [3, 2], seats: 78,
                          pitch: '~1,040 mm', desc: '3+2 seating, fixed forward/backward, charging point per seat.' }),
  EC:    chairSpec('EC', { label: 'Executive Chair Car (ICF)', short: 'EC', groups: [2, 2], seats: 46,
                          pitch: '~1,200 mm', desc: '2+2 with pantry taking the end — 46 seats (Shatabdi ICF).' }),
  EC_LHB: chairSpec('EC_LHB', { label: 'Executive Chair Car (LHB)', short: 'EC', groups: [2, 2], seats: 56,
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

  /* ---------- Intercity buses: decks, driver side, door end ---------- */
  BUS_SEAT:  chairSpec('BUS_SEAT', { label: 'Bus seater 2+2', short: 'SEAT', groups: [2, 2], seats: 44,
                          pitch: '~800 mm', desc: 'AC/non-AC seater, 11 rows. Front rows near driver + door.' }),
  BUS_SLEEP: berthSpec('BUS_SLEEP', { label: 'Bus sleeper 2+1', short: 'SLP', family: 'berth', bays: 7,
                           pattern: ['LB', 'UB', 'SL', 'SU'], end: ['LB', 'UB'], cabin: false, rake: 'BUS',
                           pitch: '~1.8 m berth', desc: 'Lower deck berths 1–15, upper deck 16–30. Aisle-side berths run lengthwise.' }),

};

const CLASS_TO_SPEC = {
  LHB: { '1A': '1A', '2A': '2A', '3A': '3ALHB', '3E': '3E', SL: 'SLLHB', CC: 'CC_LHB', EC: 'EC_LHB', '2S': '2S' },
  ICF: { '1A': '1AI', '2A': '2AI', '3A': '3A', '3E': '3E', SL: 'SL', CC: 'CC', EC: 'EC', '2S': '2S' },
  GRB: { '1A': '1AI', '2A': '2AI', '3A': 'GRB', '3E': 'GRB', SL: 'SL', CC: 'CC', EC: 'EC', '2S': '2S' },
  VB:  { EC: 'ECVB', CC: 'CCVB', SL: 'SLLHB', '2S': '2S' },
  EU:  { '1A': 'ICE_1ST', '2A': 'ICE_2ND', '3A': 'ICE_2ND', SL: 'CN_2ND', CC: 'TGV_2ND', EC: 'ICE_1ST', '2S': 'TGV_2ND' },
  JP:  { '1A': 'SHINK_GREEN', '2A': 'SHINK_RES', '3A': 'SHINK_RES', SL: 'SHINK_FREE', CC: 'SHINK_RES', EC: 'SHINK_GREEN', '2S': 'SHINK_FREE' },
  US:  { '1A': 'AMTK_ROOM', '2A': 'AMTK_BIZ', '3A': 'AMTK_COACH', SL: 'AMTK_ROOM', CC: 'AMTK_COACH', EC: 'AMTK_BIZ', '2S': 'AMTK_COACH' },
  BUS: {},
};

/* Coach code prefix → class. Garib Rath runs under coach code G (class 3A);
   3E economy under coach code M. GS (general second sitting) is the exception. */
function coachClassFromCoachCode(code) {
  const raw = String(code || '').toUpperCase();
  if (raw === 'GS' || raw === 'GEN') return '2S';
  const p = raw.replace(/[^A-Z]/g, '').charAt(0);
  return ({ H: '1A', A: '2A', B: '3A', G: '3A', M: '3E', S: 'SL', C: 'CC', E: 'EC', D: '2S', P: '3A', L: 'CC', R: 'EC', V: '3A', W: 'CC' })[p] || 'SL';
}

/* Resolve the spec key for one coach of one train.
   Resolution order, most specific first:
     1. exact coach code            ('B2' -> 3ALHB)
     2. longest alpha prefix        ('PC' -> P -> 3A, 'S10' -> S -> SL)
     3. the class implied by the code letter
     4. the train's declared default, then the rake default
   Prefix matching requires at least one LETTER, otherwise coach '21' on an ICE
   would be read as coach '2' and silently become first class. */
function specKeyFor(train, coachCode) {
  const code = String(coachCode || '').toUpperCase();
  const rake = (train && train.rake) || 'ICF';
  const map = { ...(CLASS_TO_SPEC[rake] || CLASS_TO_SPEC.ICF), ...((train && train.specs) || {}) };
  if (map[code]) return map[code];
  for (let n = code.length - 1; n >= 1; n--) {
    const p = code.slice(0, n);
    if (/[A-Z]/.test(p) && map[p]) return map[p];
  }
  const letters = code.replace(/[^A-Z]/g, '');
  if (letters && letters !== code && map[letters]) return map[letters];
  const byClass = map[coachClassFromCoachCode(code)];
  if (byClass && (!train || !train.default)) return byClass;
  if (train && train.default) return train.default;
  return byClass || RAKE_DEFAULT[rake] || 'SL';
}

const RAKE_DEFAULT = { ICF: 'SL', LHB: '3ALHB', VB: 'CCVB', EU: 'CN_2ND', JP: 'SHINK_RES', US: 'AMTK_COACH', BUS: 'BUS_SEAT' };

/* Intercity buses are modelled as a pseudo-train: operator + service + vehicle
   type resolve to a coach spec, so buses reuse the whole geometry pipeline.
   Defined here (not in app.js) because seeds and bookings resolve at load time. */
function busService(op, svc, type, from, to) {
  const operator = (op || 'Bus').trim() || 'Bus';
  const no = `${operator}:${(svc || 'GEN').trim().toUpperCase() || 'GEN'}`;
  const sleeper = type === 'sleeper';
  return {
    no, name: `${operator} ${svc || ''}`.trim(), operator, rake: 'BUS',
    coaches: sleeper ? ['L', 'U'] : ['S'],
    specs: sleeper ? { L: 'BUS_SLEEP', U: 'BUS_SLEEP' } : { S: 'BUS_SEAT' },
    from: (from || '···').toUpperCase(), to: (to || '···').toUpperCase(),
    country: 'IN', busType: type,
  };
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
  { no: '12215', name: 'Delhi–Kathgodam Garib Rath', operator: 'Indian Railways', country: 'IN', rake: 'LHB',
    from: 'DEE', to: 'KGM', dur: '6h 10m',
    coaches: [...span('G', 1, 12)], specs: { G: '3E' },
    keys: 'garib rath kathgodam delhi sarai rohilla economy ac cheap 81 berth' },
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
    default: 'ES_STD', specs: { 1: 'ES_PLUS', 2: 'ES_PLUS', 3: 'ES_PLUS' },
    keys: 'eurostar london paris st pancras gare du nord e320 class 374 channel tunnel' },
  { no: '9153', name: 'Eurostar London → Brussels', operator: 'Eurostar', country: 'EU', rake: 'EU',
    from: 'STP', to: 'BRU', dur: '2h 01m', coaches: span('', 1, 14),
    default: 'ES_STD', specs: { 1: 'ES_PLUS', 2: 'ES_PLUS' },
    keys: 'eurostar brussels bruxelles midi london standard premier' },
  { no: '954', name: 'ICE 954 Frankfurt → Amsterdam', operator: 'DB Fernverkehr', country: 'EU', rake: 'EU',
    from: 'FRA', to: 'AMS', dur: '4h 00m', coaches: [...span('', 21, 28), ...span('', 31, 38)],
    default: 'ICE_2ND', specs: { 21: 'ICE_1ST', 22: 'ICE_1ST', 31: 'ICE_1ST' },
    keys: 'ice db deutsche bahn frankfurt amsterdam germany first class wagen' },
  { no: '6201', name: 'TGV inOui Paris → Lyon', operator: 'SNCF Voyageurs', country: 'EU', rake: 'EU',
    from: 'PLY', to: 'LYO', dur: '2h 00m', coaches: span('', 1, 9),
    default: 'TGV_2ND', specs: { 1: 'ICE_1ST', 2: 'ICE_1ST' },
    keys: 'tgv inoui sncf paris gare de lyon duplex france voiture' },
  { no: '9505', name: 'Frecciarossa 1000 Roma → Milano', operator: 'Trenitalia', country: 'EU', rake: 'EU',
    from: 'ROM', to: 'MIL', dur: '2h 55m', coaches: span('', 1, 8),
    default: 'FRECCIA', specs: { 1: 'ICE_1ST', 8: 'ICE_1ST' },
    keys: 'frecciarossa trenitalia italy rome milan roma milano 1000 carrozza' },
  { no: '200', name: 'Nozomi Shinkansen Tokyo → Shin-Osaka', operator: 'JR Central', country: 'JP', rake: 'JP',
    from: 'TYO', to: 'OSK', dur: '2h 21m', coaches: span('', 1, 16),
    default: 'SHINK_RES',
    specs: { 1: 'SHINK_FREE', 2: 'SHINK_FREE', 3: 'SHINK_FREE', 8: 'SHINK_GREEN', 9: 'SHINK_GREEN', 10: 'SHINK_GREEN' },
    keys: 'nozomi shinkansen n700s tokyo osaka japan green car reserved non reserved' },
  { no: '1E01', name: 'LNER Azuma Edinburgh → London', operator: 'LNER', country: 'UK', rake: 'EU',
    from: 'EDB', to: 'KGX', dur: '4h 20m', coaches: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
    default: 'AZUMA_STD', specs: { A: 'AZUMA_1ST', B: 'AZUMA_1ST', L: 'AZUMA_1ST' },
    keys: 'lner azuma class 800 edinburgh kings cross standard first coach letter' },
  { no: '170', name: 'Amtrak Northeast Regional New York → Washington', operator: 'Amtrak', country: 'US', rake: 'US',
    from: 'NYP', to: 'WAS', dur: '3h 25m', coaches: [...span('C', 1, 6), 'B1'],
    default: 'AMTK_COACH', specs: { C: 'AMTK_COACH', B: 'AMTK_BIZ' },
    keys: 'amtrak northeast regional new york washington penn station business class acela' },
  { no: '2150', name: 'Acela New York → Washington', operator: 'Amtrak', country: 'US', rake: 'US',
    from: 'NYP', to: 'WAS', dur: '2h 50m', coaches: [...span('C', 1, 4), 'B1'],
    default: 'AMTK_COACH', specs: { C: 'AMTK_COACH', B: 'AMTK_BIZ' },
    keys: 'acela express amtrak first class business new york washington fastest' },
  { no: '5', name: 'California Zephyr Chicago → Emeryville', operator: 'Amtrak', country: 'US', rake: 'US',
    from: 'CHI', to: 'EMY', dur: '51h 20m', coaches: [...span('', 1, 3), ...span('', 4, 8)],
    specs: { 1: 'AMTK_ROOM', 2: 'AMTK_ROOM', 3: 'AMTK_ROOM', 4: 'AMTK_BIZ', 5: 'AMTK_BIZ' },
    keys: 'california zephyr amtrak superliner roomette bedroom rocky mountains chicago' },
);
for (const t of TRAINS) TRAIN_INDEX[t.no] = t;

/* ---------------------------------------------------------------------------
   LAYOUT CONFIDENCE — the honesty layer.
   A map is only ever as good as its source, and the brief is unambiguous: never
   dress up a template as the exact coach you are standing in.
     verified     · authoritative source for THIS service instance
     expected     · matched to the scheduled equipment / aircraft type
     illustrative · generic template, the passenger must confirm before relying
   ------------------------------------------------------------------------- */
const CONFIDENCE = {
  verified:     { key: 'verified',     rank: 3, label: 'Verified layout',     icon: '✓', tone: 'ok',
                  blurb: 'Supplied by an authoritative source for this exact journey.' },
  expected:     { key: 'expected',     rank: 2, label: 'Expected layout',     icon: '≈', tone: 'warn',
                  blurb: 'Matched to the scheduled equipment. Substitutions happen — confirm on board.' },
  illustrative: { key: 'illustrative', rank: 1, label: 'Illustrative layout', icon: '?', tone: 'dim',
                  blurb: 'Generic template. We could not resolve this service — check the real coach before relying on it.' },
};

/* ---------------------------------------------------------------------------
   AIRCRAFT — cabin configuration per type. `groups` is the across-the-cabin
   layout, `sections` lets one type carry several cabins (business + economy).
   `endRow` models a short final row (232-seat A321neo, 78-seat ATR 72).
   ------------------------------------------------------------------------- */
function cabin(o) {
  o.sections = o.sections.map((s) => {
    const perRow = s.groups.reduce((a, b) => a + b, 0);
    const rows = s.to - s.from + 1;
    const endRow = s.endRow || 0;
    return {
      ...s, perRow, rows, endRow,
      letters: s.letters || lettersFor(s.groups),
      seats: rows * perRow - (endRow ? perRow - endRow : 0),
    };
  });
  o.rows = Math.max(...o.sections.map((s) => s.to));
  o.seats = o.sections.reduce((a, s) => a + s.seats, 0);
  o.version = o.version || 1;
  o.confidence = o.confidence || 'expected';
  o.source = o.source || 'Curated type template';
  return o;
}

const AIRCRAFT = {
  A20N: cabin({ label: 'Airbus A320neo', iata: 'A20N', rows: 31,
    sections: [{ name: 'Economy', cls: 'Y', groups: [3, 3], from: 1, to: 31, pitch: '29 in' }],
    exits: [1, 12, 13, 31], overwing: [11, 12, 13, 14], wings: [10.5, 15.5], galley: [1], lavs: [1, 30],
    note: 'The short-haul workhorse of IndiGo and Air India. 186 seats at 3-3 when the densest layout is used.' }),

  A320: cabin({ label: 'Airbus A320-200', iata: 'A320', rows: 30,
    sections: [{ name: 'Economy', cls: 'Y', groups: [3, 3], from: 1, to: 30, pitch: '29 in' }],
    exits: [1, 12, 13, 30], overwing: [11, 12, 13, 14], wings: [10.5, 15.5], galley: [1], lavs: [1, 29],
    note: 'Classic 180-seat 3-3 layout.' }),

  A21N: cabin({ label: 'Airbus A321neo', iata: 'A21N', rows: 39,
    sections: [{ name: 'Economy', cls: 'Y', groups: [3, 3], from: 1, to: 39, endRow: 4, pitch: '30 in' }],
    exits: [1, 12, 26, 39], overwing: [11, 12, 13, 14], wings: [10.5, 16], galley: [1], lavs: [1, 26, 38],
    note: '232 seats in the densest 3-3 fit — the final row is a short row of four.' }),

  A321: cabin({ label: 'Airbus A321-200', iata: 'A321', rows: 33,
    sections: [{ name: 'Economy', cls: 'Y', groups: [3, 3], from: 1, to: 33, pitch: '30 in' }],
    exits: [1, 12, 26, 33], overwing: [11, 12, 13, 14], wings: [10.5, 16], galley: [1], lavs: [1, 32],
    note: '200-seat stretch of the A320.' }),

  B738: cabin({ label: 'Boeing 737-800', iata: 'B738', rows: 32,
    sections: [{ name: 'Economy', cls: 'Y', groups: [3, 3], from: 1, to: 32, endRow: 3, pitch: '30 in' }],
    exits: [1, 12, 13, 32], overwing: [12, 13], wings: [11, 15], galley: [1], lavs: [1, 31],
    note: '189 seats. The two overwing exits are the ones that give rows 12-13 their legroom.' }),

  B38M: cabin({ label: 'Boeing 737 MAX 8', iata: 'B38M', rows: 32,
    sections: [{ name: 'Economy', cls: 'Y', groups: [3, 3], from: 1, to: 32, endRow: 3, pitch: '31 in' }],
    exits: [1, 15, 16, 32], overwing: [14, 15, 16], wings: [13, 17], galley: [1], lavs: [1, 31],
    note: 'Same 189 seats as the -800, with the exits moved aft.' }),

  B739: cabin({ label: 'Boeing 737-900ER', iata: 'B739', rows: 33,
    sections: [{ name: 'Economy', cls: 'Y', groups: [3, 3], from: 1, to: 33, pitch: '30 in' }],
    exits: [1, 15, 16, 33], overwing: [15, 16], wings: [13, 17], galley: [1], lavs: [1, 32],
    note: '198 seats.' }),

  E190: cabin({ label: 'Embraer E190', iata: 'E190', rows: 25,
    sections: [{ name: 'Economy', cls: 'Y', groups: [2, 2], from: 1, to: 25, pitch: '31 in',
                 letters: [['A', 'C'], ['D', 'F']] }],
    exits: [1, 12, 25], overwing: [11, 12], wings: [10, 14], galley: [1], lavs: [1, 24],
    note: '100 seats, 2-2, and the common E190 lettering skips B and E — so there is no middle seat anywhere on the aircraft.' }),

  AT76: cabin({ label: 'ATR 72-600', iata: 'AT76', rows: 20,
    sections: [{ name: 'Economy', cls: 'Y', groups: [2, 2], from: 1, to: 20, endRow: 2, pitch: '29 in',
                 letters: [['A', 'C'], ['D', 'F']] }],
    exits: [1, 20], overwing: [], wings: [6.5, 11.5], galley: [1], lavs: [1, 20],
    boardFrom: 'rear',
    note: '78 seats, 2-2, boarded and disembarked from the REAR. Seats 1D and 1F face backwards; rows 1-2 have the emergency-exit legroom.' }),

  /* ---------- widebodies: two and three cabins in one drawing ---------- */
  B788: cabin({ label: 'Boeing 787-8 Dreamliner', iata: 'B788',
    sections: [
      { name: 'Business', cls: 'J', groups: [2, 2, 2], from: 1, to: 3, pitch: '78 in flat' },
      { name: 'Economy',  cls: 'Y', groups: [3, 3, 3], from: 4, to: 30, pitch: '32 in' },
    ],
    exits: [1, 10, 20, 30], overwing: [17, 18], wings: [15, 21], galley: [1, 15], lavs: [1, 9, 29],
    numberBySection: true,
    note: 'Air India / United two-class fit. Economy is 3-3-3, so the letters run A B C | D E F G | H J K and every seat has a window or aisle neighbour within reach.' }),

  B789: cabin({ label: 'Boeing 787-9 Dreamliner', iata: 'B789',
    sections: [
      { name: 'Business', cls: 'J', groups: [2, 2, 2], from: 1, to: 3, pitch: '78 in flat' },
      { name: 'Economy',  cls: 'Y', groups: [3, 3, 3], from: 4, to: 32, pitch: '31 in' },
    ],
    exits: [1, 10, 20, 32], overwing: [18, 19], wings: [16, 22], galley: [1, 16], lavs: [1, 9, 31],
    numberBySection: true, note: 'Stretched -9. Same 3-3-3 economy, four more rows.' }),

  A359: cabin({ label: 'Airbus A350-900', iata: 'A359',
    sections: [
      { name: 'Business',  cls: 'J', groups: [1, 2, 1], from: 1, to: 5, pitch: '79 in flat' },
      { name: 'Premium',   cls: 'W', groups: [2, 3, 2], from: 6, to: 9, pitch: '38 in' },
      { name: 'Economy',   cls: 'Y', groups: [3, 3, 3], from: 10, to: 40, pitch: '31 in' },
    ],
    exits: [1, 11, 21, 40], overwing: [22, 23], wings: [20, 26], galley: [1, 10], lavs: [1, 10, 39],
    numberBySection: true,
    note: 'Three cabins in one aircraft. Business is 1-2-1, so only seats A and D touch a window.' }),

  B77W: cabin({ label: 'Boeing 777-300ER', iata: 'B77W',
    sections: [
      { name: 'Business', cls: 'J', groups: [2, 2, 2], from: 1, to: 5, pitch: '78 in flat' },
      { name: 'Economy',  cls: 'Y', groups: [3, 4, 3], from: 6, to: 42, pitch: '32 in' },
    ],
    exits: [1, 17, 18, 28, 42], overwing: [24, 25], wings: [21, 28], galley: [1, 20], lavs: [1, 16, 41],
    numberBySection: true,
    note: 'Emirates / Air India style two-class fit. Economy is 3-4-3 — the four-seat middle block is where swapping earns the most.' }),

  A388: cabin({ label: 'Airbus A380-800 (upper deck)', iata: 'A388',
    sections: [
      { name: 'Business',    cls: 'J', groups: [1, 2, 1], from: 1, to: 4, pitch: '81 in flat' },
      { name: 'Premium',     cls: 'W', groups: [2, 4, 2], from: 5, to: 12, pitch: '38 in' },
      { name: 'Economy',     cls: 'Y', groups: [2, 4, 2], from: 13, to: 36, pitch: '32 in' },
    ],
    exits: [1, 13, 36], overwing: [], wings: [16, 22], galley: [1, 13], lavs: [1, 35],
    deck: 'upper', numberBySection: true,
    note: 'The upper deck only — the widest cabin in service at 2-4-2 upstairs.' }),

  B77L: cabin({ label: 'Boeing 777-200LR', iata: 'B77L',
    sections: [
      { name: 'Business', cls: 'J', groups: [2, 2, 2], from: 1, to: 4, pitch: '78 in flat' },
      { name: 'Economy',  cls: 'Y', groups: [3, 3, 3], from: 5, to: 35, pitch: '32 in' },
    ],
    exits: [1, 15, 16, 25, 35], overwing: [21, 22], wings: [18, 25], galley: [1, 18], lavs: [1, 14, 34],
    numberBySection: true, note: 'Ultra-long-haul -200LR, 3-3-3 economy.' }),
};

/* ---------------------------------------------------------------------------
   FLIGHTS — flight number → carrier, route, aircraft type. The aircraft type is
   what unlocks the cabin drawing. Carriers swap equipment, which is exactly why
   every flight-derived map is labelled `expected`, never `verified`.
   ------------------------------------------------------------------------- */
const FLIGHTS = [
  /* India */
  { no: '6E2031', airline: 'IndiGo', iata: '6E', from: 'DEL', to: 'BOM', craft: 'A20N', country: 'IN' },
  { no: '6E2135', airline: 'IndiGo', iata: '6E', from: 'DEL', to: 'BLR', craft: 'A20N', country: 'IN' },
  { no: '6E5162', airline: 'IndiGo', iata: '6E', from: 'BLR', to: 'GOI', craft: 'AT76', country: 'IN' },
  { no: '6E6401', airline: 'IndiGo', iata: '6E', from: 'DEL', to: 'GAU', craft: 'A21N', country: 'IN' },
  { no: '6E1371', airline: 'IndiGo', iata: '6E', from: 'BOM', to: 'DXB', craft: 'A21N', country: 'IN' },
  { no: 'AI202', airline: 'Air India', iata: 'AI', from: 'DEL', to: 'JFK', craft: 'B788', country: 'IN' },
  { no: 'AI805', airline: 'Air India', iata: 'AI', from: 'DEL', to: 'LHR', craft: 'B77W', country: 'IN' },
  { no: 'AI101', airline: 'Air India', iata: 'AI', from: 'BOM', to: 'LHR', craft: 'A359', country: 'IN' },
  { no: 'SG881', airline: 'SpiceJet', iata: 'SG', from: 'DEL', to: 'GOI', craft: 'B738', country: 'IN' },
  { no: 'SG401', airline: 'SpiceJet', iata: 'SG', from: 'BOM', to: 'CCU', craft: 'B38M', country: 'IN' },
  { no: 'IX121', airline: 'Air India Express', iata: 'IX', from: 'COK', to: 'DXB', craft: 'B738', country: 'IN' },
  { no: 'QP1108', airline: 'Akasa Air', iata: 'QP', from: 'BLR', to: 'DEL', craft: 'B38M', country: 'IN' },
  { no: 'UK945', airline: 'Vistara', iata: 'UK', from: 'DEL', to: 'BOM', craft: 'A21N', country: 'IN' },

  /* Gulf, Asia, Africa */
  { no: 'EK507', airline: 'Emirates', iata: 'EK', from: 'BOM', to: 'DXB', craft: 'B77W', country: 'AE' },
  { no: 'EK8', airline: 'Emirates', iata: 'EK', from: 'LHR', to: 'DXB', craft: 'A388', country: 'AE' },
  { no: 'QR570', airline: 'Qatar Airways', iata: 'QR', from: 'DOH', to: 'DEL', craft: 'B788', country: 'QA' },
  { no: 'EY204', airline: 'Etihad', iata: 'EY', from: 'AUH', to: 'JFK', craft: 'B77W', country: 'AE' },
  { no: 'SQ308', airline: 'Singapore Airlines', iata: 'SQ', from: 'SIN', to: 'LHR', craft: 'A388', country: 'SG' },
  { no: 'SQ422', airline: 'Singapore Airlines', iata: 'SQ', from: 'SIN', to: 'BOM', craft: 'A359', country: 'SG' },
  { no: 'TG315', airline: 'Thai Airways', iata: 'TG', from: 'BKK', to: 'DEL', craft: 'B77W', country: 'TH' },
  { no: 'MH78', airline: 'Malaysia Airlines', iata: 'MH', from: 'KUL', to: 'PEK', craft: 'A359', country: 'MY' },
  { no: 'CX255', airline: 'Cathay Pacific', iata: 'CX', from: 'HKG', to: 'LHR', craft: 'B77W', country: 'HK' },
  { no: 'JL43', airline: 'Japan Airlines', iata: 'JL', from: 'HND', to: 'LHR', craft: 'B789', country: 'JP' },
  { no: 'NH106', airline: 'ANA', iata: 'NH', from: 'HND', to: 'LAX', craft: 'B77W', country: 'JP' },
  { no: 'KE901', airline: 'Korean Air', iata: 'KE', from: 'ICN', to: 'CDG', craft: 'B789', country: 'KR' },
  { no: 'CA981', airline: 'Air China', iata: 'CA', from: 'PEK', to: 'JFK', craft: 'B77W', country: 'CN' },
  { no: 'ET501', airline: 'Ethiopian', iata: 'ET', from: 'ADD', to: 'IAD', craft: 'B788', country: 'ET' },
  { no: 'SA234', airline: 'South African Airways', iata: 'SA', from: 'JNB', to: 'LHR', craft: 'A359', country: 'ZA' },
];

const FLIGHT_INDEX = {};
for (const f of FLIGHTS) FLIGHT_INDEX[f.no] = f;

FLIGHTS.push(
  /* Europe + Americas */
  { no: 'BA178', airline: 'British Airways', iata: 'BA', from: 'JFK', to: 'LHR', craft: 'B788', country: 'GB' },
  { no: 'BA286', airline: 'British Airways', iata: 'BA', from: 'SFO', to: 'LHR', craft: 'A388', country: 'GB' },
  { no: 'BA2490', airline: 'British Airways', iata: 'BA', from: 'LHR', to: 'FCO', craft: 'A320', country: 'GB' },
  { no: 'LH400', airline: 'Lufthansa', iata: 'LH', from: 'FRA', to: 'JFK', craft: 'A388', country: 'DE' },
  { no: 'LH710', airline: 'Lufthansa', iata: 'LH', from: 'FRA', to: 'HND', craft: 'B789', country: 'DE' },
  { no: 'AF006', airline: 'Air France', iata: 'AF', from: 'CDG', to: 'JFK', craft: 'B77W', country: 'FR' },
  { no: 'AF1680', airline: 'Air France', iata: 'AF', from: 'CDG', to: 'LHR', craft: 'A320', country: 'FR' },
  { no: 'KL641', airline: 'KLM', iata: 'KL', from: 'AMS', to: 'JFK', craft: 'B77W', country: 'NL' },
  { no: 'KL1503', airline: 'KLM', iata: 'KL', from: 'AMS', to: 'MAD', craft: 'B738', country: 'NL' },
  { no: 'LX38', airline: 'SWISS', iata: 'LX', from: 'ZRH', to: 'JFK', craft: 'B77W', country: 'CH' },
  { no: 'IB6251', airline: 'Iberia', iata: 'IB', from: 'MAD', to: 'GRU', craft: 'A359', country: 'ES' },
  { no: 'TK1', airline: 'Turkish Airlines', iata: 'TK', from: 'IST', to: 'JFK', craft: 'B77W', country: 'TR' },
  { no: 'AZ604', airline: 'ITA Airways', iata: 'AZ', from: 'FCO', to: 'JFK', craft: 'A359', country: 'IT' },
  { no: 'UA82', airline: 'United', iata: 'UA', from: 'EWR', to: 'DEL', craft: 'B789', country: 'US' },
  { no: 'UA930', airline: 'United', iata: 'UA', from: 'SFO', to: 'LHR', craft: 'B789', country: 'US' },
  { no: 'AA100', airline: 'American Airlines', iata: 'AA', from: 'JFK', to: 'LHR', craft: 'B77W', country: 'US' },
  { no: 'AA2116', airline: 'American Airlines', iata: 'AA', from: 'DFW', to: 'ORD', craft: 'B738', country: 'US' },
  { no: 'DL1', airline: 'Delta', iata: 'DL', from: 'JFK', to: 'LHR', craft: 'A359', country: 'US' },
  { no: 'DL2300', airline: 'Delta', iata: 'DL', from: 'ATL', to: 'JFK', craft: 'B739', country: 'US' },
  { no: 'AC856', airline: 'Air Canada', iata: 'AC', from: 'YYZ', to: 'LHR', craft: 'B789', country: 'CA' },
  { no: 'AC402', airline: 'Air Canada', iata: 'AC', from: 'YYZ', to: 'JFK', craft: 'E190', country: 'CA' },
  { no: 'LA8084', airline: 'LATAM', iata: 'LA', from: 'GRU', to: 'MAD', craft: 'B77W', country: 'BR' },
  { no: 'AM6', airline: 'Aeroméxico', iata: 'AM', from: 'MEX', to: 'MAD', craft: 'B789', country: 'MX' },
  { no: 'QF1', airline: 'Qantas', iata: 'QF', from: 'SYD', to: 'SIN', craft: 'A388', country: 'AU' },
  { no: 'NZ2', airline: 'Air New Zealand', iata: 'NZ', from: 'AKL', to: 'JFK', craft: 'B789', country: 'NZ' },
  { no: 'FR1234', airline: 'Ryanair', iata: 'FR', from: 'DUB', to: 'STN', craft: 'B738', country: 'IE' },
  { no: 'U22001', airline: 'easyJet', iata: 'U2', from: 'LGW', to: 'BCN', craft: 'A320', country: 'GB' },
  { no: 'W61234', airline: 'Wizz Air', iata: 'W6', from: 'BUD', to: 'LTN', craft: 'A321', country: 'HU' },
);
for (const f of FLIGHTS) FLIGHT_INDEX[f.no] = f;

/* Unknown flight number → derive the carrier from the IATA prefix, then assume a
   mainstream narrowbody. Resolved as `illustrative` so nobody is misled. */
const AIRLINE_PREFIX = {
  '6E': { airline: 'IndiGo', craft: 'A20N' }, AI: { airline: 'Air India', craft: 'A20N' },
  SG: { airline: 'SpiceJet', craft: 'B738' }, IX: { airline: 'Air India Express', craft: 'B738' },
  QP: { airline: 'Akasa Air', craft: 'B38M' }, UK: { airline: 'Vistara', craft: 'A21N' },
  EK: { airline: 'Emirates', craft: 'B77W' }, QR: { airline: 'Qatar Airways', craft: 'B788' },
  EY: { airline: 'Etihad', craft: 'B77W' }, SQ: { airline: 'Singapore Airlines', craft: 'A359' },
  TG: { airline: 'Thai Airways', craft: 'B77W' }, MH: { airline: 'Malaysia Airlines', craft: 'B738' },
  CX: { airline: 'Cathay Pacific', craft: 'B77W' }, JL: { airline: 'Japan Airlines', craft: 'B789' },
  NH: { airline: 'ANA', craft: 'B77W' }, KE: { airline: 'Korean Air', craft: 'B789' },
  CA: { airline: 'Air China', craft: 'B77W' }, ET: { airline: 'Ethiopian', craft: 'B788' },
  BA: { airline: 'British Airways', craft: 'A320' }, LH: { airline: 'Lufthansa', craft: 'A320' },
  AF: { airline: 'Air France', craft: 'A320' }, KL: { airline: 'KLM', craft: 'B738' },
  LX: { airline: 'SWISS', craft: 'A320' }, OS: { airline: 'Austrian', craft: 'A320' },
  IB: { airline: 'Iberia', craft: 'A320' }, TK: { airline: 'Turkish Airlines', craft: 'A321' },
  AZ: { airline: 'ITA Airways', craft: 'A320' }, UA: { airline: 'United', craft: 'B738' },
  AA: { airline: 'American Airlines', craft: 'B738' }, DL: { airline: 'Delta', craft: 'B738' },
  AC: { airline: 'Air Canada', craft: 'A320' }, LA: { airline: 'LATAM', craft: 'A320' },
  AM: { airline: 'Aeroméxico', craft: 'B738' }, QF: { airline: 'Qantas', craft: 'B738' },
  NZ: { airline: 'Air New Zealand', craft: 'A320' }, FR: { airline: 'Ryanair', craft: 'B738' },
  U2: { airline: 'easyJet', craft: 'A320' }, W6: { airline: 'Wizz Air', craft: 'A321' },
  VY: { airline: 'Vueling', craft: 'A320' }, TP: { airline: 'TAP Air Portugal', craft: 'A320' },
  SV: { airline: 'Saudia', craft: 'A320' }, MS: { airline: 'EgyptAir', craft: 'B738' },
  KQ: { airline: 'Kenya Airways', craft: 'B738' }, VA: { airline: 'Virgin Australia', craft: 'B738' },
  WS: { airline: 'WestJet', craft: 'B738' }, G8: { airline: 'Go First', craft: 'A20N' },
};

/* ===========================================================================
   GEOMETRY HELPERS
   Everything the map draws comes from here, so the same functions that place a
   seat on the diagram also explain it in words ("Lower berth · Bay 3 of 9 ·
   bench A, facing berth 19"). No renderer gets to keep its own private maths.
   =========================================================================== */

/* --- seat states ---------------------------------------------------------- */
/* `unknown` is a first-class state. A blank-looking cell must NEVER read as
   "free seat" — nobody has told us anything about it. */
const SEAT_STATE = {
  mine:      { key: 'mine',      label: 'Your seat',       icon: '●', tone: 'mine' },
  target:    { key: 'target',    label: 'Seat you want',   icon: '◇', tone: 'target' },
  open:      { key: 'open',      label: 'Open to swap',    icon: '⇄', tone: 'open' },
  requested: { key: 'requested', label: 'Swap requested',  icon: '◔', tone: 'req' },
  matched:   { key: 'matched',   label: 'Swap agreed',     icon: '✓', tone: 'match' },
  blocked:   { key: 'blocked',   label: 'Not swappable',   icon: '✕', tone: 'blocked' },
  unknown:   { key: 'unknown',   label: 'No information',  icon: '·', tone: 'unknown' },
  other:     { key: 'other',     label: 'Other passenger', icon: '○', tone: 'other' },
};

/* --- berth geometry ------------------------------------------------------- */
function bayCount(spec) { return Math.ceil(spec.seats / spec.baySize); }
function bayOf(spec, n) { return Math.floor((n - 1) / spec.baySize) + 1; }
function posInBay(spec, n) { return (n - 1) % spec.baySize; }
function berthAt(spec, n) { return spec.layout[n - 1] || 'LB'; }
function berthMeta(type) { return BERTH_TYPES[type] || BERTH_TYPES.LB; }

function baySeats(spec, bay) {
  const start = (bay - 1) * spec.baySize + 1;
  const end = Math.min(bay * spec.baySize, spec.seats);
  const nums = [];
  for (let n = start; n <= end; n++) nums.push(n);
  return { start, end, nums };
}

/* Main (transverse) berths sit in two facing benches. The split is derived from
   the pattern, so 2A (4 main berths) and 3A (6 main berths) both come out right
   without a special case. */
function mainPatternIdx(spec) {
  const out = [];
  for (let i = 0; i < spec.pattern.length; i++) if (!berthMeta(spec.pattern[i]).side) out.push(i);
  return out;
}
function benchOf(spec, n) {
  if (berthMeta(berthAt(spec, n)).side) return 'S';
  const main = mainPatternIdx(spec);
  return main.indexOf(posInBay(spec, n)) < main.length / 2 ? 'A' : 'B';
}

/* The berth directly opposite across the bay: same level, other bench. */
function oppositeBerth(spec, n) {
  if (berthMeta(berthAt(spec, n)).side) return null;
  const main = mainPatternIdx(spec);
  const i = main.indexOf(posInBay(spec, n));
  const j = (i + main.length / 2) % main.length;
  return (bayOf(spec, n) - 1) * spec.baySize + main[j] + 1;
}

/* Berths sharing this berth's bench AND level inside the same bay. */
function bayMatesOf(spec, n) {
  const bay = bayOf(spec, n), bench = benchOf(spec, n), level = berthMeta(berthAt(spec, n)).level;
  return baySeats(spec, bay).nums.filter((m) => m !== n && benchOf(spec, m) === bench && berthMeta(berthAt(spec, m)).level === level);
}

/* --- chair-car geometry --------------------------------------------------- */
/* Chair seats are numbered sequentially, so row + column is DERIVED from the
   number rather than stored — which is exactly how it behaves on board. */
function chairRowCol(spec, n) {
  if (!spec || spec.family !== 'chair') return null;
  const idx = n - 1;
  const row = Math.floor(idx / spec.perRow) + 1;
  const col = idx % spec.perRow;
  const flat = spec.letters.map((g) => g.join('|')).join('|').split('|');
  let seen = 0, groupIdx = 0;
  for (let g = 0; g < spec.groups.length; g++) {
    if (col < seen + spec.groups[g]) { groupIdx = g; break; }
    seen += spec.groups[g];
  }
  const groupStart = seen, groupEnd = seen + spec.groups[groupIdx] - 1;
  const isFirstGroup = groupIdx === 0, isLastGroup = groupIdx === spec.groups.length - 1;
  let position = 'middle';
  if ((isFirstGroup && col === groupStart) || (isLastGroup && col === groupEnd)) position = 'window';
  else if (col === groupStart || col === groupEnd || (groupStart === groupEnd)) position = 'aisle';
  return { row, col, groupIdx, groupStart, groupEnd, letter: flat[col], position, letters: flat, rowCount: spec.rows };
}

/* --- flight geometry ------------------------------------------------------ */
function sectionForRow(craft, row) {
  const spec = AIRCRAFT[craft];
  if (!spec) return null;
  return spec.sections.find((s) => row >= s.from && row <= s.to) || spec.sections[spec.sections.length - 1];
}
function sectionLetters(section) { return section.letters.map((g) => g.join('|')).join('|').split('|'); }

/* A flight seat id is "24C" — row number plus row letter. */
function parseFlightSeat(id) {
  const m = String(id || '').toUpperCase().match(/^(\d+)\s*([A-Z])$/);
  return m ? { row: parseInt(m[1], 10), letter: m[2] } : null;
}

/* Window = outermost column of the outermost blocks. 1-2-1 business therefore
   reports only A and D as windows, and 2-2 reports A and F. */
function isWindowCol(flat, col, groups) {
  let seen = 0;
  for (let g = 0; g < groups.length; g++) {
    const start = seen, end = seen + groups[g] - 1;
    if (col >= start && col <= end) {
      return (g === 0 && col === start) || (g === groups.length - 1 && col === end);
    }
    seen += groups[g];
  }
  return false;
}
/* Aisle = touches a corridor, i.e. the inner edge of an outer block or any edge
   of a middle block. */
function isAisleCol(flat, col, groups) {
  let seen = 0;
  for (let g = 0; g < groups.length; g++) {
    const start = seen, end = seen + groups[g] - 1;
    if (col >= start && col <= end) {
      if (groups.length === 1) return false;
      if (g === 0) return col === end;
      if (g === groups.length - 1) return col === start;
      return col === start || col === end;
    }
    seen += groups[g];
  }
  return false;
}

function flightPosition(craft, seatId) {
  const spec = AIRCRAFT[craft];
  const parsed = parseFlightSeat(seatId);
  if (!spec || !parsed) return null;
  if (parsed.row < 1 || parsed.row > spec.rows) return null;
  const section = sectionForRow(craft, parsed.row);
  const flat = sectionLetters(section);
  const col = flat.indexOf(parsed.letter);
  if (col < 0) return null;
  const window = isWindowCol(flat, col, section.groups);
  const aisle = !window && isAisleCol(flat, col, section.groups);
  const exitRow = spec.exits.indexOf(parsed.row) >= 0;
  const overwing = spec.overwing.indexOf(parsed.row) >= 0;
  const inWing = parsed.row >= Math.floor(spec.wings[0]) && parsed.row <= Math.ceil(spec.wings[1]);
  return {
    kind: 'flight', id: parsed.row + parsed.letter, row: parsed.row, letter: parsed.letter, col,
    sectionName: section.name, cls: section.cls, pitch: section.pitch, section,
    position: window ? 'window' : aisle ? 'aisle' : 'middle',
    exitRow, overwing, inWing, legroom: exitRow,
    rowLetters: flat, perRow: section.perRow, groups: section.groups,
    distanceFromExit: Math.min.apply(null, spec.exits.map((e) => Math.abs(e - parsed.row))),
  };
}

function flightSeatInfo(craft, seatId) {
  const p = flightPosition(craft, seatId);
  if (!p) return null;
  const spec = AIRCRAFT[craft];
  const posName = { window: 'Window seat', aisle: 'Aisle seat', middle: 'Middle seat' }[p.position];
  const bits = [posName, `${p.sectionName} · row ${p.row} of ${spec.rows}`];
  if (p.exitRow) bits.push('exit row — extra legroom, subject to crew rules on bags and recline');
  else if (p.overwing) bits.push('over the wing');
  bits.push(p.distanceFromExit === 0 ? 'right at an exit' : `${p.distanceFromExit} ${p.distanceFromExit === 1 ? 'row' : 'rows'} from an exit`);
  bits.push(`pitch ${p.pitch}`);
  if (spec.boardFrom === 'rear') bits.push('this aircraft boards from the REAR');
  return {
    ...p, craft, spec, title: `${posName} · Row ${p.row}`,
    blurb: bits.join(' · '), score: p.position === 'window' ? 88 : p.position === 'aisle' ? 82 : 45,
  };
}

/* --- unified position descriptor ------------------------------------------ */
/* One call answers "where exactly am I?" for a train berth, a train chair or a
   flight seat. The UI never has to know which mode it is in. */
function trainPosition(train, coachCode, seatNo) {
  const spec = specOf(train, coachCode);
  const n = parseInt(seatNo, 10);
  if (!isFinite(n) || n < 1 || n > spec.seats) return null;
  const base = {
    kind: 'train', label: String(n), spec, specKey: specKeyFor(train, coachCode),
    coach: coachCode, seatCount: spec.seats, family: spec.family, craft: null,
  };
  if (spec.family === 'chair') {
    const rc = chairRowCol(spec, n);
    if (!rc) return null;
    const posName = { window: 'Window seat', aisle: 'Aisle seat', middle: 'Middle seat' }[rc.position];
    const fromDoorRows = Math.min(rc.row - 1, rc.rowCount - rc.row);
    return {
      ...base, row: rc.row, col: rc.col, letter: rc.letter, rowCount: rc.rowCount,
      rowLetters: rc.letters, perRow: spec.perRow, groups: spec.groups,
      position: rc.position, side: false, level: null, bay: null, bayCount: null,
      fromDoor: fromDoorRows, exitRow: false, overwing: false, inWing: false, legroom: false,
      title: `${posName} · Row ${rc.row} of ${rc.rowCount}`,
      blurb: `${spec.label} · seat ${n} is ${rc.letter} in row ${rc.row} (${spec.groups.join('+')}) · ` +
             `${fromDoorRows === 0 ? 'first row at the door' : fromDoorRows + ' rows from the door'} · pitch ${spec.pitch}`,
      score: rc.position === 'window' ? 88 : rc.position === 'aisle' ? 82 : 45,
      pitch: spec.pitch,
    };
  }
  const type = berthAt(spec, n);
  const meta = berthMeta(type);
  const bay = bayOf(spec, n), bays = bayCount(spec), bench = benchOf(spec, n);
  const opp = oppositeBerth(spec, n);
  const fromDoor = Math.min(bay - 1, bays - bay);
  const levelName = ['', 'floor level', 'middle level', 'top level'][meta.level];
  const benchName = bench === 'S' ? 'the side pair against the wall' : `bench ${bench}`;
  const title = `${meta.name} · Bay ${bay} of ${bays}`;
  const blurb = [
    `${meta.name} — ${levelName}`,
    bench === 'S' ? 'runs lengthwise along the wall, not across the bay' : `${benchName} — one of the ${spec.pattern.filter((p) => !berthMeta(p).side).length / 2} berths facing it across the bay`,
    opp ? `directly faces berth ${opp}` : null,
    fromDoor === 0 ? 'right by the door' : `${fromDoor} ${fromDoor === 1 ? 'bay' : 'bays'} from the door`,
    spec.pitch,
  ].filter(Boolean).join(' · ');
  return {
    ...base, bay, bayCount: bays, posInBay: posInBay(spec, n) + 1, benchName: bench, bench,
    side: meta.side, level: meta.level, levelName, berth: type, berthInfo: meta,
    opposite: opp, mates: bayMatesOf(spec, n), fromDoor, type,
    exitRow: !!spec.cabin, overwing: false, inWing: false, legroom: meta.level === 1,
    title, blurb, pitch: spec.pitch,
    score: meta.level === 1 ? 88 : meta.level === 3 ? 72 : 52,
  };
}

/* --- swap goals ----------------------------------------------------------- */
const WANT_LABELS = {
  LB: 'a lower berth', MB: 'a middle berth', UB: 'an upper berth',
  SL: 'side lower', SM: 'side middle', SU: 'side upper',
  W: 'a window seat', A: 'an aisle seat', M: 'a middle seat',
  TOGETHER: 'seats together', EXIT: 'an exit row', LEGROOM: 'more legroom',
  LOWER_LEVEL: 'a berth at floor level', PRIVATE: 'somewhere private',
};
function wantLabel(k) { return WANT_LABELS[k] || k; }

/* What actually changes for the traveller — the outcomes the brief asks us to
   lead with, instead of berth codes. */
function swapGain(fromInfo, toInfo) {
  if (!fromInfo || !toInfo) return { delta: 0, better: [], worse: [], why: [] };
  const better = [], worse = [];
  const levels = ['', 'floor level', 'middle level', 'top level'];
  if (fromInfo.level && toInfo.level && fromInfo.level !== toInfo.level) {
    if (toInfo.level < fromInfo.level) better.push(`drops you to ${levels[toInfo.level]}`);
    else worse.push(`moves you up to ${levels[toInfo.level]}`);
  }
  if (toInfo.kind === 'train' && fromInfo.side !== toInfo.side) {
    if (fromInfo.side && !toInfo.side) better.push('out of the corridor-side berth into the main bay');
    if (!fromInfo.side && toInfo.side) worse.push('into the corridor-side berth');
  }
  if (fromInfo.position && toInfo.position && fromInfo.position !== toInfo.position) {
    if (toInfo.position === 'window') better.push('gains a window');
    if (fromInfo.position === 'window') worse.push('gives up the window');
    if (fromInfo.position === 'middle') better.push('out of the middle seat');
  }
  if (toInfo.exitRow && !fromInfo.exitRow) better.push('exit-row legroom');
  if (fromInfo.row && toInfo.row && fromInfo.row !== toInfo.row) {
    const d = toInfo.row - fromInfo.row;
    better.push(d < 0 ? `${Math.abs(d)} ${Math.abs(d) === 1 ? 'row' : 'rows'} further forward` : `${d} ${d === 1 ? 'row' : 'rows'} further back`);
  }
  if (fromInfo.bay && toInfo.bay && fromInfo.bay !== toInfo.bay) {
    const d = Math.abs(toInfo.bay - fromInfo.bay);
    better.push(d === 1 ? 'one bay away — a few steps' : `${d} bays away`);
  }
  const delta = (toInfo.score || 0) - (fromInfo.score || 0);
  return { delta, better, worse, why: better.concat(worse) };
}

/* --- service identity ----------------------------------------------------- */
/* A journey is a SERVICE INSTANCE: same service AND same date AND the same
   boarding→destination pair. Two people on 12951 on different dates are not on
   the same train and must never be matched. */
function serviceKey(mode, no, date, seg) {
  return [mode, String(no || '').toUpperCase(), date || '-', seg || 'full'].join('|');
}

/* ===========================================================================
   TRUST + TRADE STATE
   =========================================================================== */

/* Verification is progressive and named honestly. Uploading a picture is not
   verification, so no photo can ever reach a state called "verified". */
const VERIFY_LEVELS = [
  { level: 0, key: 'self',     label: 'Unverified',       icon: '○', tone: 'dim',
    blurb: 'Seat entered by hand. Nothing has been checked.' },
  { level: 1, key: 'evidence', label: 'Evidence checked', icon: '◐', tone: 'warn',
    blurb: 'Booking evidence matched this journey. Booking references are never shown to another traveller.' },
  { level: 2, key: 'operator', label: 'Operator verified', icon: '●', tone: 'ok',
    blurb: 'Confirmed through an authorised operator integration for this exact departure.' },
];
function verifyLevel(n) { return VERIFY_LEVELS[Math.max(0, Math.min(2, n | 0))]; }

/* The honest transaction flow. An agreement inside the app is NOT a seat
   reassignment, and the UI says so at every step. */
const SWAP_STATES = {
  open:      { key: 'open',      label: 'Listed',            tone: 'open',
               next: ['requested'], blurb: 'Visible on this departure. Anyone with a compatible seat can ask.' },
  requested: { key: 'requested', label: 'Requested',         tone: 'req',
               next: ['accepted', 'declined', 'cancelled', 'expired'],
               blurb: 'Waiting on the other traveller. Either side can withdraw.' },
  accepted:  { key: 'accepted',  label: 'Agreed by both',    tone: 'match',
               next: ['crew', 'completed', 'cancelled', 'expired'],
               blurb: 'Both agreed. Seats are held so the same seat cannot be promised twice.' },
  crew:      { key: 'crew',      label: 'With the crew',     tone: 'warn',
               next: ['completed', 'cancelled'],
               blurb: 'Handed to the conductor or cabin crew. Their decision is final.' },
  completed: { key: 'completed', label: 'Completed',         tone: 'ok', next: [],
               blurb: 'Both travellers confirmed the seats actually changed.' },
  declined:  { key: 'declined',  label: 'Declined',          tone: 'dim', next: [],
               blurb: 'Not a match this time. Nothing was shared.' },
  cancelled: { key: 'cancelled', label: 'Withdrawn',         tone: 'dim', next: [],
               blurb: 'Withdrawn before completion.' },
  expired:   { key: 'expired',   label: 'Expired',           tone: 'dim', next: [],
               blurb: 'Ran out of time before departure. Requests do not sit around forever.' },
};
function swapState(k) { return SWAP_STATES[k] || SWAP_STATES.open; }

/* Preferences are stated as outcomes, never as medical detail. */
const PREFERENCE_FLAGS = [
  { key: 'lower',     label: 'Ground-level berth', why: 'Easier to get in and out of.' },
  { key: 'together',  label: 'Keep us together',   why: 'Travelling as a group and want one bay.' },
  { key: 'no_middle', label: 'No middle seats',    why: 'No window, no aisle.' },
  { key: 'window',    label: 'Window',             why: 'A view and a wall to lean on.' },
  { key: 'aisle',     label: 'Aisle',              why: 'Move without disturbing anyone.' },
  { key: 'quiet',     label: 'Away from the door', why: 'Less foot traffic, less noise.' },
  { key: 'steps',     label: 'Fewest steps',       why: 'Short walk from the boarding door.' },
  { key: 'private',   label: 'More private',       why: 'Upper berth or a corner.' },
  { key: 'crew',      label: 'Crew approval needed', why: 'Exit row, accessible bay or a locked cabin — the crew decide.' },
];

/* ---------------------------------------------------------------------------
   SEED PARTICIPANTS — deliberately concentrated, because matching needs several
   people on the SAME departure, not a large total user count.
   ------------------------------------------------------------------------- */
const DAY = 86400000;
const isoDay = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

const SEED_PEOPLE = [
  { id: 's1', alias: 'Falcon-31', mode: 'train', serviceNo: '12951', coach: 'B2', seat: 22, dateOffset: 0,
    seg: 'MMCT→NDLS', want: ['LB', 'SL'], verify: 1, plus: true, group: 3, flags: ['lower', 'together'],
    note: 'Travelling with two children booked into B3. Need the same bay, any level.' },
  { id: 's2', alias: 'Kestrel-08', mode: 'train', serviceNo: '12951', coach: 'B2', seat: 7, dateOffset: 0,
    seg: 'MMCT→NDLS', want: ['LB'], verify: 1, plus: false, group: 1, flags: ['lower', 'steps'],
    note: 'Senior citizen on the side lower. Wants a main lower berth with a shorter walk.' },
  { id: 's3', alias: 'Ibis-44', mode: 'train', serviceNo: '12951', coach: 'B4', seat: 31, dateOffset: 0,
    seg: 'MMCT→NDLS', want: ['SU', 'SL'], verify: 0, plus: false, group: 2, flags: ['private'],
    note: 'Two of us separated by two coaches — anything in B2 or B3 would help.' },
  { id: 's4', alias: 'Lark-72', mode: 'train', serviceNo: '12951', coach: 'B2', seat: 17, dateOffset: 1,
    seg: 'MMCT→NDLS', want: ['UB', 'SU'], verify: 1, plus: false, group: 1, flags: ['private', 'quiet'],
    note: 'Lower berth on bench A, first bay at the door. Happy to trade up for an upper further in.' },
  { id: 's5', alias: 'Osprey-19', mode: 'train', serviceNo: '22436', coach: 'C4', seat: 43, dateOffset: 0,
    seg: 'NDLS→BSB', want: ['TOGETHER', 'W'], verify: 1, plus: true, group: 2, flags: ['together', 'window'],
    note: 'I am on the aisle in C4 and my partner is in 44. Neither of us has a window.' },
  { id: 's6', alias: 'Heron-63', mode: 'train', serviceNo: '22436', coach: 'C4', seat: 41, dateOffset: 0,
    seg: 'NDLS→BSB', want: ['A'], verify: 0, plus: false, group: 1, flags: ['aisle'],
    note: 'Window seat, but I need to keep getting up. An aisle would suit me better.' },
  { id: 's7', alias: 'Swift-27', mode: 'train', serviceNo: '9010', coach: '7', seat: 34, dateOffset: 0,
    seg: 'STP→GPN', want: ['W', 'TOGETHER'], verify: 1, plus: false, group: 2, flags: ['together', 'window'],
    note: 'Two seats booked apart in coach 7. Looking to sit together facing forward.' },
  { id: 's8', alias: 'Tern-55', mode: 'train', serviceNo: '200', coach: '5', seat: 58, dateOffset: 0,
    seg: 'TYO→OSK', want: ['W'], verify: 0, plus: false, group: 1, flags: ['window'],
    note: 'Aisle in a 3+2 car. The D/E pair is the Mount Fuji side — happy to trade.' },
  { id: 's9', alias: 'Finch-12', mode: 'flight', serviceNo: '6E2031', seat: '14C', dateOffset: 0,
    seg: 'DEL→BOM', want: ['W'], verify: 1, plus: false, group: 1, flags: ['window', 'steps'],
    note: 'Aisle over the wing. Would happily take any window in the first 15 rows.' },
  { id: 's10', alias: 'Robin-90', mode: 'flight', serviceNo: '6E2031', seat: '8A', dateOffset: 0,
    seg: 'DEL→BOM', want: ['A', 'EXIT'], verify: 0, plus: true, group: 1, flags: ['aisle'],
    note: 'Window near the front. Long legs — an exit row or an aisle beside 12 would be perfect.' },
  { id: 's11', alias: 'Merlin-04', mode: 'flight', serviceNo: 'AI202', seat: '22E', dateOffset: 2,
    seg: 'DEL→JFK', want: ['W', 'TOGETHER'], verify: 1, plus: true, group: 2, flags: ['together', 'window'],
    note: 'I drew the middle seat of the four-block on a 3-3-3. Any window in economy would make the flight.' },
  { id: 's12', alias: 'Plover-38', mode: 'flight', serviceNo: '6E5162', seat: '16D', dateOffset: 0,
    seg: 'BLR→GOI', want: ['W'], verify: 0, plus: false, group: 1, flags: ['window'],
    note: 'Backwards-facing pair at 1D/1F confused me at booking. I have an aisle and want a window.' },

  /* ---- the demo journeys in the product flow designs ----
     6E 2135 (DEL→BLR) and the KSRTC Rajdhani sleeper (HYD→BLR). Names are
     fictional personas; they exist so the designed screens have real matches. */
  { id: 's13', alias: 'Nisha S.', mode: 'flight', serviceNo: '6E2135', seat: '12A', dateOffset: 0,
    seg: 'DEL→BLR', want: ['A'], verify: 1, plus: false, group: 1, flags: ['aisle'],
    note: 'Window at 12A. I keep getting up, so an aisle would suit me better.' },
  { id: 's14', alias: 'Rohit K.', mode: 'flight', serviceNo: '6E2135', seat: '16E', dateOffset: 0,
    seg: 'DEL→BLR', want: ['W'], verify: 1, plus: false, group: 1, flags: ['window'],
    note: 'Middle of the 3-3. Any window in economy and I am happy.' },
  { id: 's15', alias: 'Ananya P.', mode: 'flight', serviceNo: '6E2135', seat: '6F', dateOffset: 0,
    seg: 'DEL→BLR', want: ['A'], verify: 0, plus: false, group: 1, flags: ['aisle'],
    note: 'Front-row window. Legroom rows 12-13 would be ideal.' },
  { id: 's16', alias: 'Priya S.', mode: 'bus', serviceNo: 'KSRTC:RAJDHANI', seat: 19, dateOffset: 0,
    seg: 'HYD→BLR', busOp: 'KSRTC', busSvc: 'Rajdhani', busType: 'sleeper',
    want: ['SL', 'LB'], verify: 1, plus: false, group: 1, flags: ['lower'],
    note: 'Frequent traveller. Looking for a more comfortable seat.' },
  { id: 's17', alias: 'Rahul K.', mode: 'bus', serviceNo: 'KSRTC:RAJDHANI', seat: 24, dateOffset: 0,
    seg: 'HYD→BLR', busOp: 'KSRTC', busSvc: 'Rajdhani', busType: 'sleeper',
    want: ['LB'], verify: 0, plus: false, group: 2, flags: ['lower', 'together'],
    note: 'Two of us on the upper deck — a lower berth pair would make the night easier.' },
  { id: 's18', alias: 'Meera J.', mode: 'bus', serviceNo: 'KSRTC:RAJDHANI', seat: 8, dateOffset: 0,
    seg: 'HYD→BLR', busOp: 'KSRTC', busSvc: 'Rajdhani', busType: 'sleeper',
    want: ['SU'], verify: 1, plus: false, group: 1, flags: ['private'],
    note: 'Lower berth near the door. Happy to move upstairs for privacy.' },
];

/* Seeds are resolved THROUGH the geometry engine, so a seed can never point at a
   seat that does not exist on that service. */
function buildSeedPeople() {
  const out = [];
  for (const p of SEED_PEOPLE) {
    const date = isoDay(p.dateOffset);
    let info = null, craft = null, specKey = null;
    if (p.mode === 'train') {
      const train = TRAIN_INDEX[p.serviceNo] || GENERIC_TRAIN;
      info = trainPosition(train, p.coach, p.seat);
      if (!info) continue;
      specKey = info.specKey;
    } else if (p.mode === 'bus') {
      const t = busService(p.busOp, p.busSvc, p.busType, (p.seg || '→').split('→')[0], (p.seg || '→').split('→')[1]);
      info = trainPosition(t, p.coach || (p.busType === 'sleeper' ? 'L' : 'S'), p.seat);
      if (!info) continue;
      specKey = info.specKey;
    } else {
      const flight = FLIGHT_INDEX[p.serviceNo];
      craft = (flight && flight.craft) || 'A20N';
      info = flightSeatInfo(craft, p.seat);
      if (!info) continue;
    }
    out.push({
      ...p, date, craft, specKey, info,
      service: serviceKey(p.mode, p.serviceNo, date, p.seg),
      trust: verifyLevel(p.verify),
    });
  }
  return out;
}
const SEED_SWAPS = buildSeedPeople();