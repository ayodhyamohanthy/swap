/* SwapSeat ledger schema tests (pure Node, no dependencies).
   Run: node tests/ledger.test.js
   Verifies the documented v1 schema, migration from earlier unversioned
   records, and that erasing removes user-scoped data. */
const path = require('path');
let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } else console.log('  ok   ' + msg); };

/* Minimal localStorage stub — the ledger only uses get/set/remove/keys. */
function makeStorage(seed) {
  const m = Object.assign({}, seed || {});
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i],
    get length() { return Object.keys(m).length; },
    _dump: () => m,
  };
}
global.localStorage = makeStorage();
const Ledger = require(path.join(__dirname, '..', 'js', 'ledger.js'));
Ledger._inject(global.localStorage);

console.log('== schema ==');
ok(Ledger.SCHEMA_VERSION === 1, 'schema version is 1');
ok(Ledger.KEY_DATA === 'swapseat_ledger_v1', 'data key is versioned: ' + Ledger.KEY_DATA);
const rec = Ledger.add({
  mode: 'train', serviceNumber: '12951', travelDate: '2026-09-24', coachOrCabin: 'B3',
  ownSeat: '42', targetSeat: '7', status: 'pending', quoteSummary: 'search ₹49', sourceId: 'req:r1',
});
['id', 'createdAt', 'updatedAt', 'mode', 'serviceNumber', 'travelDate', 'coachOrCabin', 'ownSeat', 'targetSeat', 'status', 'failureReason', 'quoteSummary']
  .forEach((f) => ok(f in rec, 'record has documented field: ' + f));
ok(/^\d{4}-\d{2}-\d{2}T/.test(rec.createdAt), 'createdAt is ISO-8601');
ok(Ledger.STATUSES.includes(rec.status), 'status is one of the documented states');

console.log('== meta + idempotence ==');
const meta = JSON.parse(global.localStorage.getItem('swapseat_ledger_meta'));
ok(meta.schemaVersion === 1, 'meta records schemaVersion 1');
Ledger.upsert({ sourceId: 'req:r1', status: 'accepted' });
ok(Ledger.all().length === 1, 'upsert by sourceId does not duplicate');
ok(Ledger.all()[0].status === 'accepted', 'upsert applied the status change');
ok(Ledger.stats().accepted === 1, 'stats count accepted records');

console.log('== migration from unversioned (v0) stores ==');
global.localStorage = makeStorage({
  swapseat_reqs: JSON.stringify([{ id: 'r9', state: 'requested', ts: Date.now(), snap: { mode: 'train', no: '12002', coach: 'C2', seat: '11' } }]),
  swapseat_swaps: JSON.stringify([{ id: 's9', mode: 'bus', busNo: 'HYD42', date: '2026-09-25', seat: '5', state: 'open' }]),
});
Ledger._inject(global.localStorage);
Ledger.syncFromLegacy();
const migrated = Ledger.all();
ok(migrated.length === 2, `migrated ${migrated.length} legacy records`);
ok(migrated.some((r) => r.serviceNumber === '12002' && r.status === 'pending'), 'legacy request becomes a pending ledger record');
ok(migrated.some((r) => r.serviceNumber === 'HYD42'), 'legacy listing becomes a ledger record');

console.log('== erase user-scoped data ==');
const cleared = Ledger.clear();
ok(cleared === 2, `cleared ${cleared} records`);
ok(Ledger.all().length === 0, 'ledger empty after clear');
ok(global.localStorage.getItem('swapseat_reqs') === null, 'legacy request store removed on clear');
ok(JSON.parse(global.localStorage.getItem('swapseat_ledger_meta')).schemaVersion === 1, 'schema version re-seeded after clear');
ok(Ledger.exportJSON().indexOf('schemaVersion') >= 0, 'export carries the schema version');

console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll ledger checks passed.');
process.exit(fail ? 1 : 0);
