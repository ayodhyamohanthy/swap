/* ===========================================================================
   SwapSeat exchange test (M3) — plain Node, no dependencies.
       node tests/exchange.test.js
   Two-user requester flow against dev-server: journey entry, own-seat map,
   preferences, protected matches (privacy leak checks), server quote,
   sandbox payment, search activation, exchange request. Plus authorization
   and payment-safety checks.
   =========================================================================== */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8340 + Math.floor(Math.random() * 200);
const BASE = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'swapseat-xtest-' + process.pid + '.json');

let fail = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

async function call(pathname, opts) {
  const o = opts || {};
  const res = await fetch(BASE + pathname, {
    method: o.method || 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

async function signIn(phone) {
  const r1 = await call('/api/auth/request-otp', { method: 'POST', body: { phone } });
  const code = r1.data.devCode;
  const r2 = await call('/api/auth/verify-otp', { method: 'POST', body: { phone, code } });
  return r2.data.token;
}

const JOURNEY = {
  trainNumber: '12627', date: '2026-10-02', boarding: 'SBC', destination: 'NDLS',
  boardingIndex: 1, destinationIndex: 10, classCode: 'SL', coach: 'S4', berth: 19,
};

(async () => {
  try { fs.unlinkSync(DATA); } catch (_) {}
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'dev-server.js')], {
    env: { ...process.env, PORT: String(PORT), SWAP_DATA: DATA }, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 800));
  try {
    const tokenA = await signIn('9000000001');
    const tokenB = await signIn('9000000002');
    ok(tokenA && tokenB && tokenA !== tokenB, 'two independent users signed in');

    /* --- journey entry --- */
    const bad = await call('/api/journeys', { method: 'POST', token: tokenA, body: { ...JOURNEY, boardingIndex: 10, destinationIndex: 1 } });
    ok(bad.status === 400, 'boarding after destination rejected');
    const ja = await call('/api/journeys', { method: 'POST', token: tokenA, body: JOURNEY });
    ok(ja.status === 200 && ja.data.journey.serviceKey === 'TRAIN:12627:2026-10-02', 'journey created with canonical service key');
    ok(ja.data.journey.berthType === 'UB', 'berth 19 resolves to Upper (IR 3-tier)');
    const jidA = ja.data.journey.id;

    const jb = await call('/api/journeys', { method: 'POST', token: tokenB, body: { ...JOURNEY, coach: 'S4', berth: 21 } });
    const jidB = jb.data.journey.id;
    ok(jb.status === 200 && jb.data.journey.berthType === 'MB', 'second user journey created');

    /* --- object-level authorization --- */
    const stolen = await call('/api/journeys/' + jidA, { token: tokenB });
    ok(stolen.status === 403, 'user B cannot read user A journey');
    const noauth = await call('/api/journeys/' + jidA, {});
    ok(noauth.status === 401, 'unauthenticated read rejected');

    /* --- own-seat map with confidence --- */
    const map = await call('/api/journeys/' + jidA + '/map', { token: tokenA });
    ok(map.status === 200 && map.data.berth === 19 && map.data.confidence === 'expected', 'own map exact seat + expected confidence');
    ok(!!map.data.source, 'map carries a source label');

    /* --- preferences --- */
    const pref = await call('/api/journeys/' + jidB + '/preferences', { method: 'PUT', token: tokenB, body: { acceptTypes: ['LB', 'SL'], reason: 'elderly parent needs lower berth', displayName: 'Priya Sharma', genderPref: 'same-gender', gender: 'female' } });
    ok(pref.status === 200 && pref.data.journey.state === 'preferences_set', 'preferences saved');

    /* --- matches (privacy DTOs) --- */
    const m0 = await call('/api/journeys/' + jidA + '/matches', { token: tokenA });
    ok(m0.status === 200 && m0.data.candidates.length === 1, 'one eligible candidate (same service, same segment)');
    const c = m0.data.candidates[0];
    const raw = JSON.stringify(c);
    /* NOTE: no bare '21' substring check — timestamps/uids contain '21'
       intermittently. Assert on structure + berth-scoped values instead. */
    ok(Object.keys(c).sort().join(',') === 'candidateId,coarseRegion,fit,maskedName,searching', 'candidate DTO shape is fixed');
    ok(c.coarseRegion && Object.keys(c.coarseRegion).sort().join(',') === 'berthType,berthTypeLabel,coach', 'coarse region limited to coach + berth type');
    ok(!/"berth[^"]*"\s*:\s*"?21"?/.test(raw), 'candidate payload has no exact berth number');
    ok(!raw.includes(jidB) && !raw.includes('userId'), 'candidate payload has no journey/user ids');
    ok(!raw.includes('female') && !raw.includes('same-gender'), 'candidate payload never exposes gender');
    ok(c.maskedName === 'Priya S.', 'masked name format "Priya S."');
    ok(c.coarseRegion && c.coarseRegion.coach === 'S4' && c.coarseRegion.berthType === 'MB', 'coarse region limited to coach + berth type');
    ok(c.fit && c.fit.denominator === 100 && Array.isArray(c.fit.factors) && c.fit.kind === 'preference-fit', 'explainable preference-fit score with factors');
    ok(typeof c.searching === 'boolean', 'candidate searching flag present');

    /* --- quote + disclosure --- */
    const q = await call('/api/quotes', { method: 'POST', token: tokenA, body: { journeyId: jidA, kind: 'search_activation', market: 'IN' } });
    ok(q.status === 200 && q.data.quote.amountMinor === 4900 && q.data.quote.maxTotalMinor === 14800, 'server quote: 4900 now, 14800 max');
    ok(q.data.disclosure.points.some(p => /never charged to accept/i.test(p)), 'disclosure carries accepter-not-charged copy');
    const quoteId = q.data.quote.id;
    const quoteRaw = JSON.stringify(q.data);
    ok(!quoteRaw.includes('9000000001'), 'quote never leaks phone');

    /* --- sandbox payment (idempotent) --- */
    const p1 = await call('/api/payments/intents', { method: 'POST', token: tokenA, body: { quoteId, idempotencyKey: 'k1' } });
    ok(p1.status === 200 && p1.data.payment.state === 'captured' && p1.data.sandbox === true, 'sandbox payment captured');
    const p2 = await call('/api/payments/intents', { method: 'POST', token: tokenA, body: { quoteId, idempotencyKey: 'k1' } });
    ok(p2.data.payment.id === p1.data.payment.id, 'idempotency key dedupes payment');
    const theft = await call('/api/payments/intents', { method: 'POST', token: tokenB, body: { quoteId, idempotencyKey: 'k2' } });
    ok(theft.status === 404, 'user B cannot pay against user A quote');

    /* --- activation --- */
    const pre = await call('/api/exchange-requests', { method: 'POST', token: tokenA, body: { journeyId: jidA, candidateId: c.candidateId } });
    ok(pre.status === 402, 'request blocked before activation');
    const act = await call('/api/journeys/' + jidA + '/activate', { method: 'POST', token: tokenA, body: { paymentId: p1.data.payment.id } });
    ok(act.status === 200 && act.data.entitlement.active === true, 'captured payment activates search');
    const act2 = await call('/api/journeys/' + jidA + '/activate', { method: 'POST', token: tokenA, body: { paymentId: p1.data.payment.id } });
    ok(act2.status === 200, 'activation idempotent');

    /* --- exchange request --- */
    const xr = await call('/api/exchange-requests', { method: 'POST', token: tokenA, body: { journeyId: jidA, candidateId: c.candidateId } });
    ok(xr.status === 200 && xr.data.request.state === 'pending', 'exchange request created');
    ok(xr.data.request.counterpart === 'Priya S.', 'request shows masked counterpart only');
    const rq = xr.data.request;
    ok(Object.keys(rq).sort().join(',') === 'counterpart,createdAt,id,role,serviceKey,state', 'request DTO shape is fixed');
    ok(!('reveal' in rq) && !/"berth[^"]*"\s*:\s*"?21"?/.test(JSON.stringify(rq)), 'request payload hides accepter exact seat');
    const xr2 = await call('/api/exchange-requests', { method: 'POST', token: tokenA, body: { journeyId: jidA, candidateId: c.candidateId } });
    ok(xr2.data.request.id === xr.data.request.id, 'duplicate request returns existing');
    const listB = await call('/api/exchange-requests', { token: tokenB });
    ok(listB.status === 200 && listB.data.requests.length === 1 && listB.data.requests[0].role === 'accepter', 'accepter sees the incoming request');

    console.log(count + ' exchange checks, ' + fail + ' failures');
  } finally {
    srv.kill();
    try { fs.unlinkSync(DATA); } catch (_) {}
  }
  process.exit(fail ? 1 : 0);
})();
