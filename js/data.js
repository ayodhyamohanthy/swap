/* Global journey database: trains (IN + global) + flights/aircraft.
   Train number -> coach composition. Flight number -> airline + aircraft -> cabin map. */

const COACH_SPECS = {
  'SL':  { label: 'Sleeper',        berths: 72, bay: 8, pattern: ['LB','MB','UB','LB','MB','UB','SL','SU'], desc: 'Open bays, 9 bays × 8 berths' },
  '3A':  { label: 'AC 3-Tier',      berths: 72, bay: 8, pattern: ['LB','MB','UB','LB','MB','UB','SL','SU'], desc: 'AC, curtains, bedding' },
  '3E':  { label: 'AC 3-Tier Eco',  berths: 83, bay: 9, pattern: ['LB','MB','UB','LB','MB','UB','SL','SM','SU'], desc: 'Extra side-middle berth' },
  '2A':  { label: 'AC 2-Tier',      berths: 54, bay: 6, pattern: ['LB','UB','LB','UB','SL','SU'], desc: 'No middle berth, curtains' },
  '1A':  { label: 'AC First',       berths: 24, bay: 4, pattern: ['LB','UB','LB','UB'], desc: 'Cabins & coupes, most private' },
  'CC':  { label: 'Chair Car',      berths: 78, bay: 6, pattern: ['W','M','A','A','M','W'], desc: '3+3 pushback seats, day trains' },
  '2S':  { label: 'Second Sitting', berths: 108, bay: 6, pattern: ['W','M','A','A','M','W'], desc: '3+3 bench seats' },
  'EC':  { label: 'Executive CC',   berths: 56, bay: 4, pattern: ['W','A','A','W'], desc: '2+2 premium, Vande Bharat / Shatabdi' },
  'GEN': { label: 'Open Saloon',    berths: 80, bay: 8, pattern: ['W','M','A','A','M','W','W','A'], desc: 'Generic 2+2 / open coach (EU/US/JP)' },
};

const TRAINS = [
  { no: '12951', name: 'Mumbai Rajdhani', from: 'BCT', to: 'NDLS', classes: ['1A','2A','3A'], coaches: ['H1','A1','A2','A3','B1','B2','B3','B4','B5','PC'], country: 'IN', operator: 'Indian Railways' },
  { no: '12002', name: 'Bhopal Shatabdi', from: 'NDLS', to: 'BPL', classes: ['EC','CC'], coaches: ['E1','C1','C2','C3','C4','C5','C6'], country: 'IN', operator: 'Indian Railways' },
  { no: '22436', name: 'Vande Bharat Exp', from: 'NDLS', to: 'BSB', classes: ['EC','CC'], coaches: ['E1','E2','C1','C2','C3','C4','C5'], country: 'IN', operator: 'Indian Railways' },
  { no: '12259', name: 'Sealdah Duronto', from: 'NDLS', to: 'SDAH', classes: ['1A','2A','3A','SL'], coaches: ['H1','A1','A2','B1','B2','B3','B4','S1','S2','S3'], country: 'IN', operator: 'Indian Railways' },
  { no: '12621', name: 'Tamil Nadu Exp', from: 'NDLS', to: 'MAS', classes: ['2A','3A','SL','GEN'], coaches: ['A1','B1','B2','B3','S1','S2','S3','S4','GS'], country: 'IN', operator: 'Indian Railways' },
  { no: '12925', name: 'Paschim Exp', from: 'BCT', to: 'ASR', classes: ['3A','SL','2S'], coaches: ['B1','B2','S1','S2','S3','D1','D2'], country: 'IN', operator: 'Indian Railways' },
  { no: '9010', name: 'Eurostar London–Paris', from: 'LON', to: 'PAR', classes: ['EC','GEN'], coaches: ['C1','C2','C3','C4','C5','C6'], country: 'EU', operator: 'Eurostar' },
  { no: '170', name: 'Amtrak Northeast Regional', from: 'NYP', to: 'WAS', classes: ['EC','GEN'], coaches: ['C1','C2','C3','C4'], country: 'US', operator: 'Amtrak' },
  { no: '200', name: 'Nozomi Shinkansen', from: 'TYO', to: 'OSK', classes: ['EC','GEN'], coaches: ['C1','C2','C3','C4','C5','C6','C7'], country: 'JP', operator: 'JR Central' },
];

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

function coachClassFromCoachCode(code) {
  const p = (code || '').replace(/[0-9]/g, '').toUpperCase();
  if (p.startsWith('H')) return '1A';
  if (p.startsWith('A')) return '2A';
  if (p.startsWith('B')) return '3A';
  if (p.startsWith('G')) return '3E';
  if (p.startsWith('S')) return 'SL';
  if (p.startsWith('E')) return 'EC';
  if (p.startsWith('C')) return 'CC';
  if (p.startsWith('D')) return '2S';
  if (p === 'GS' || p === 'GEN') return 'GEN';
  if (p.startsWith('P')) return '3A';
  return 'SL';
}

function berthTypeOf(classCode, n) {
  const spec = COACH_SPECS[classCode] || COACH_SPECS['SL'];
  const idx = (n - 1) % spec.bay;
  return spec.pattern[idx];
}

function berthMeta(type) {
  const M = {
    'LB': { name: 'Lower Berth', level: 'Floor level — easiest access', icon: '🛏️', score: 90 },
    'MB': { name: 'Middle Berth', level: 'Folds down at night only', icon: '🛏️', score: 55 },
    'UB': { name: 'Upper Berth', level: 'Top — private but climb', icon: '🛏️', score: 70 },
    'SL': { name: 'Side Lower', level: 'Aisle sofa → berth at night', icon: '💺', score: 75 },
    'SU': { name: 'Side Upper', level: 'Aisle upper — stay up all day', icon: '💺', score: 80 },
    'SM': { name: 'Side Middle', level: '3E extra fold-down', icon: '💺', score: 50 },
    'W':  { name: 'Window Seat', level: 'Window + wall to lean on', icon: '🪟', score: 88 },
    'M':  { name: 'Middle Seat', level: 'Between two passengers', icon: '💺', score: 45 },
    'A':  { name: 'Aisle Seat', level: 'Easy in/out, legroom', icon: '🚶', score: 82 },
  };
  return M[type] || { name: type, level: '', icon: '💺', score: 60 };
}

function flightSeatMeta(letter, row, craft) {
  const spec = AIRCRAFT[craft];
  const L = String(letter).toUpperCase();
  let type = 'M';
  if (spec.layout === '3-3') type = (L === 'A' || L === 'F') ? 'W' : (L === 'C' || L === 'D') ? 'A' : 'M';
  if (spec.layout === '2-2') type = (L === 'A' || L === 'F') ? 'W' : 'A';
  if (spec.layout === '3-3-3') type = (['A','J'].includes(L)) ? 'W' : (['C','D','G','H'].includes(L)) ? 'A' : 'M';
  const exit = spec.exits.includes(row);
  const wing = row >= Math.min(...spec.wings) && row <= Math.max(...spec.wings);
  return { type, exit, wing, ...berthMeta(type) };
}

/* Seeded demo marketplace (localStorage merges on top) */
const SEED_SWAPS = [
  { id: 's1', mode: 'train', trainNo: '12951', coach: 'B2', seat: 22, want: ['LB','SL'], name: 'Priya · Family of 3', note: 'Kids in B3, want same bay 🙏', verified: true, plus: true, ts: Date.now() - 36e5 },
  { id: 's2', mode: 'train', trainNo: '12951', coach: 'B2', seat: 7, want: ['UB','SU'], name: 'Ramesh · Sr. citizen', note: 'Side lower offered, need lower main', verified: true, plus: false, ts: Date.now() - 72e5 },
  { id: 's3', mode: 'flight', flightNo: '6E2031', seat: '24C', want: ['W'], name: 'Alex · Window lover', note: 'Middle → window, front half pls', verified: true, plus: false, ts: Date.now() - 18e5 },
  { id: 's4', mode: 'train', trainNo: '12002', coach: 'C3', seat: 14, want: ['W'], name: 'Sara · Solo', note: 'Aisle → window for views', verified: false, plus: false, ts: Date.now() - 54e5 },
];
