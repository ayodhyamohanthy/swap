/* ===========================================================================
   SwapSeat geometry test — runs on plain Node, no dependencies.
       node tests/geometry.test.js
   Guards the release gates from the brief: seat labels and geometry must match
   the template, and no map may ever be drawn from a seat that does not exist.
   =========================================================================== */
const fs = require('fs');
const path = require('path');

/* js/data.js is a browser script (globals, no exports) — evaluate it here so the
   test exercises the exact file the PWA ships. */
const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
require('vm').runInThisContext(source, { filename: 'js/data.js' });

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

console.log('== coach specs ==');
ok(COACH_SPECS.SL.seats === 72, 'ICF sleeper = 72 berths');
ok(COACH_SPECS['3A'].seats === 64, 'ICF 3A = 64 berths');
ok(COACH_SPECS['3ALHB'].seats === 72, 'LHB 3A = 72 berths');
ok(COACH_SPECS.SLLHB.seats === 80, 'LHB sleeper = 80 berths');
ok(COACH_SPECS['3E'].seats === 83, 'LHB 3E = 83 berths (10x8 + end triple, no side-middle — etrain.info 3E)');
ok(COACH_SPECS.GRB.seats === 81, 'Garib Rath = 81 berths (9 per bay with side-middle — etrain.info 3A_GRB)');
ok(COACH_SPECS.CC.seats === 73 && COACH_SPECS.CC.groups.join('+') === '3+2', 'ICF CC = 73 seats 3+2 (etrain.info CC_1)');
ok(COACH_SPECS.CC_LHB.seats === 78, 'LHB CC = 78 seats 3+3');
ok(COACH_SPECS.EC.seats === 46, 'ICF EC = 46 seats (pantry end — etrain.info EC)');
ok(COACH_SPECS.EC_LHB.seats === 56, 'LHB EC = 56 seats');
ok(specKeyFor({ rake: 'GRB', specs: {} }, 'G7') === 'GRB', 'Garib Rath coach G7 resolves to side-middle layout');
ok(COACH_SPECS['2A'].seats === 54, '2A = 54 berths (6 per bay x 9)');
ok(bayCount(COACH_SPECS.SL) === 9, 'ICF sleeper has 9 bays');
ok(bayCount(COACH_SPECS.SLLHB) === 10, 'LHB sleeper has 10 bays');

console.log('== Indian bay order (ticket convention) ==');
const SL = COACH_SPECS.SL;
const order = [1,2,3,4,5,6,7,8].map(n => berthAt(SL, n));
ok(order.join(',') === 'LB,MB,UB,LB,MB,UB,SL,SU', 'bay 1 = ' + order.join(' '));
ok(bayOf(SL, 8) === 1 && bayOf(SL, 9) === 2, 'berth 8 ends bay 1, berth 9 starts bay 2');
ok(benchOf(SL,1)==='A' && benchOf(SL,4)==='B' && benchOf(SL,7)==='S', 'bench A / bench B / side');
ok(oppositeBerth(SL,1) === 4 && oppositeBerth(SL,3) === 6, 'berth 1 faces 4, berth 3 faces 6');
ok(oppositeBerth(SL,7) === null, 'side berths face nothing across the bay');
ok(benchOf(COACH_SPECS['2A'],1)==='A' && benchOf(COACH_SPECS['2A'],3)==='B', '2A bench split on 4 main berths');
ok(oppositeBerth(COACH_SPECS['2A'],1) === 3, '2A: berth 1 faces berth 3');

console.log('== chair derivation (Vande Bharat CC 3+2) ==');
const cc = COACH_SPECS['CCVB'];
ok(cc.perRow === 5 && cc.seats === 78, 'CC seat count');
const rows = {};
for (let n = 1; n <= 78; n++) { const rc = chairRowCol(cc, n); (rows[rc.row] = rows[rc.row] || []).push(rc.letter + ':' + rc.position); }
ok(Object.keys(rows).length === 16, '78 seats at 5 per row = 16 rows (last row short)');
ok(rows[1].join(' ') === 'A:window B:middle C:aisle D:aisle E:window', '3+2: A window, B middle, C+D both aisle seats, E window -> ' + rows[1].join(' '));
ok(rows[16].length === 3, 'final row is short: ' + rows[16].join(' '));

console.log('== every service in the database resolves ==');
let coachCount = 0, seatCount = 0, bad = [];
for (const t of TRAINS) {
  for (const c of t.coaches) {
    const spec = specOf(t, c);
    coachCount++;
    if (!spec || !spec.label) { bad.push(t.no + '/' + c + ' has no spec'); continue; }
    for (let n = 1; n <= spec.seats; n++) {
      const info = trainPosition(t, c, n);
      seatCount++;
      if (!info) { bad.push(t.no + '/' + c + '/' + n + ' unpositionable'); break; }
    }
  }
}
ok(bad.length === 0, `trains: ${TRAINS.length} services, ${coachCount} coaches, ${seatCount} seats all resolved` + (bad.length ? ' -> ' + bad.slice(0, 5).join('; ') : ''));
let fseats = 0, fbad = [];
for (const [craft, spec] of Object.entries(AIRCRAFT)) {
  for (let r = 1; r <= spec.rows; r++) {
    const section = sectionForRow(craft, r);
    for (const L of sectionLetters(section)) {
      fseats++;
      if (!flightSeatInfo(craft, r + L)) fbad.push(craft + ' ' + r + L);
    }
  }
}
ok(fbad.length === 0, `aircraft: ${Object.keys(AIRCRAFT).length} types, ${fseats} seats all resolved` + (fbad.length ? ' -> ' + fbad.slice(0, 5).join('; ') : ''));
ok(Object.keys(FLIGHT_INDEX).length === FLIGHTS.length, `flights: ${FLIGHTS.length} services indexed, ${new Set(FLIGHTS.map(f => f.no)).size} unique`);
ok(FLIGHTS.every(f => AIRCRAFT[f.craft]), 'every flight points at a real aircraft type');

console.log('== train positions ==');
const raj = TRAIN_INDEX['12951'];
ok(specKeyFor(raj, 'B2') === '3ALHB', 'Rajdhani B coach -> LHB 3A');
ok(specKeyFor(raj, 'A1') === '2A' && specKeyFor(raj, 'H1') === '1A', 'Rajdhani A/H coaches');
ok(specKeyFor(raj, 'PC') === '3ALHB', 'unknown code falls back on prefix/class');
const p22 = trainPosition(raj, 'B2', 22);
ok(p22.bay === 3 && p22.berth === 'UB' && p22.opposite === 19, 'berth 22: ' + p22.title + ' | ' + p22.blurb);
const p7 = trainPosition(raj, 'B2', 7);
ok(p7.side === true && p7.level === 1 && p7.bay === 1, 'berth 7 is side lower in bay 1');
const pvb = trainPosition(TRAIN_INDEX['22436'], 'C4', 44);
ok(pvb.position === 'aisle', 'VB chair 44 = ' + pvb.position);
ok(trainPosition(raj, 'B2', 999) === null, 'out-of-range seat rejected');
ok(trainPosition(raj, 'B2', 'x') === null, 'garbage seat rejected');

console.log('== global trains ==');
ok(specKeyFor(TRAIN_INDEX['9010'], '7') === 'ES_STD', 'Eurostar coach 7 = Standard (numeric code falls back to the train default)');
ok(specKeyFor(TRAIN_INDEX['9010'], '1') === 'ES_PLUS', 'Eurostar coach 1 = Standard Premier');
ok(specKeyFor(TRAIN_INDEX['200'], '9') === 'SHINK_GREEN', 'Shinkansen car 9 = Green Car');
ok(specKeyFor(TRAIN_INDEX['200'], '2') === 'SHINK_FREE', 'Shinkansen car 2 = non-reserved');
ok(specKeyFor(TRAIN_INDEX['1E01'], 'B') === 'AZUMA_1ST', 'Azuma coach B = First');
ok(specKeyFor(TRAIN_INDEX['170'], 'B1') === 'AMTK_BIZ', 'Amtrak B1 = Business');

console.log('== aircraft ==');
ok(AIRCRAFT.A20N.seats === 186, 'A320neo = 186 seats');
ok(AIRCRAFT.AT76.seats === 78, 'ATR72 = 78 seats');
ok(AIRCRAFT.B788.seats === 261, '787-8 = ' + AIRCRAFT.B788.seats + ' seats (2 cabins)');
ok(AIRCRAFT.B77W.seats === 400, '777-300ER = ' + AIRCRAFT.B77W.seats + ' seats');
ok(AIRCRAFT.A388.sections.length === 3, 'A380 has 3 cabins');
ok(AIRCRAFT.E190.seats === 100, 'E190 = 100 seats, no middle');

console.log('== flight seat positions ==');
const f = flightSeatInfo('A20N', '24C');
ok(f.position === 'aisle', '24C aisle');
ok(flightSeatInfo('A20N', '24A').position === 'window', '24A window');
ok(flightSeatInfo('A20N', '24B').position === 'middle', '24B middle');
ok(flightSeatInfo('A20N', '12D').exitRow === true, 'row 12 is an exit row');
ok(flightSeatInfo('AT76', '16D').position === 'aisle' && flightSeatInfo('AT76', '16F').position === 'window', 'ATR 2-2: D aisle, F window');
ok(flightSeatInfo('AT76', '1D').position === 'aisle' && flightSeatInfo('AT76', '1F').position === 'window', 'ATR 1D/1F pair');
ok(flightSeatInfo('A359', '3A').position === 'window' && flightSeatInfo('A359', '3B').position === 'aisle', 'A350 business 1-2-1: only A/D are windows');
ok(flightSeatInfo('A359', '3C').position === 'aisle', 'A350 business: C is aisle');
ok(flightSeatInfo('B77W', '20G').position === 'aisle', '777 3-4-3 middle block has aisle access');
ok(flightSeatInfo('E190', '5B') === null, 'E190 skips B: there is no middle seat to book');
ok(flightSeatInfo('E190', '5C').position === 'aisle' && flightSeatInfo('E190', '5A').position === 'window', 'E190 A/C/D/F: window/both-aisle/window');
ok(flightSeatInfo('A20N', '24Z') === null, 'letter outside the cabin rejected');
ok(flightSeatInfo('A20N', '99A') === null, 'row outside the cabin rejected');

console.log('== seeds ==');
ok(SEED_SWAPS.length === SEED_PEOPLE.length, 'every seed cleared geometry: ' + SEED_SWAPS.length + '/' + SEED_PEOPLE.length);
ok(SEED_SWAPS.every(s => s.info && s.service.includes(s.date)), 'all seeds carry a service-instance key');
const dates = new Set(SEED_SWAPS.filter(s => s.serviceNo === '12951').map(s => s.date));
ok(dates.size === 2, '12951 seeds span 2 dates -> must never cross-match');

console.log('== swap gain ==');
ok(trainPosition(raj, 'B2', 19).berth === 'UB', 'bay 3 runs 17 LB, 18 MB, 19 UB, 20 LB, 21 MB, 22 UB, 23 SL, 24 SU');
const g2 = swapGain(trainPosition(raj, 'B2', 7), trainPosition(raj, 'B2', 17));
console.log('   side-lower 7 -> lower 17: delta ' + g2.delta + ' | ' + g2.why.join(', '));
ok(g2.better.some(x => /main bay/.test(x)), 'side -> main bay is called out as a win');
const g3 = swapGain(trainPosition(raj, 'B2', 22), trainPosition(raj, 'B2', 17));
console.log('   upper 22 -> lower 17: delta ' + g3.delta + ' | ' + g3.why.join(', '));
ok(g3.better.some(x => /drops you to floor/.test(x)), 'upper -> lower reads as a drop to floor level');

console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nAll data-layer checks passed.');
process.exit(fail ? 1 : 0);
