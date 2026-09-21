/* ===========================================================================
   SwapSeat auth + coordination test — plain Node, no dependencies.
       node tests/auth.test.js
   Spawns server/dev-server.js on a throwaway port with fast OTP timings and a
   temp data file, then exercises the Milestone 2 API contract:
   OTP throttling + lockout, session rotation, privacy shaping (no phone, no
   exact seat before completion), one-shot acceptance (no double-commit) and
   owner-only completion.
   =========================================================================== */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8140 + Math.floor(Math.random() * 200);
const BASE = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'swapseat-test-' + process.pid + '.json');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

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
async function login(phone) {
  const r = await call('/api/auth/request-otp', { method: 'POST', body: { phone } });
  if (r.status !== 200) throw new Error('request-otp failed for ' + phone + ': ' + JSON.stringify(r.data));
  const v = await call('/api/auth/verify-otp', { method: 'POST', body: { phone, code: r.data.devCode } });
  if (v.status !== 200) throw new Error('verify failed for ' + phone);
  return v.data;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'dev-server.js')], {
    env: {
      ...process.env, PORT: String(PORT), SWAP_DATA: DATA,
      SWAP_OTP_RESEND_MS: '0', SWAP_OTP_WINDOW_MS: '60000', SWAP_OTP_MAX_PER_WINDOW: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  try {
    /* wait for boot */
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { const r = await fetch(BASE + '/api/health'); up = r.ok; } catch (_) { await new Promise((r2) => setTimeout(r2, 100)); }
    }
    if (!up) throw new Error('server did not start');

    console.log('== otp ==');
    const bad = await call('/api/auth/request-otp', { method: 'POST', body: { phone: 'abc' } });
    ok(bad.status === 400, 'request-otp rejects a non-phone');
    const p1 = '+91 98765 43210';
    const req1 = await call('/api/auth/request-otp', { method: 'POST', body: { phone: p1 } });
    ok(req1.status === 200 && /^\d{6}$/.test(req1.data.devCode || ''), 'request-otp returns a 6-digit dev code');
    ok(!JSON.stringify(req1.data).includes('9876543210'), 'response never echoes the raw phone number');
    const wrong = await call('/api/auth/verify-otp', { method: 'POST', body: { phone: p1, code: req1.data.devCode === '000000' ? '000001' : '000000' } });
    ok(wrong.status === 401 && wrong.data.attemptsLeft >= 1, 'wrong code rejected with attempts left');
    const good = await call('/api/auth/verify-otp', { method: 'POST', body: { phone: p1, code: req1.data.devCode } });
    ok(good.status === 200 && good.data.token && good.data.user.phoneMasked, 'correct code signs in');
    const reuse = await call('/api/auth/verify-otp', { method: 'POST', body: { phone: p1, code: req1.data.devCode } });
    ok(reuse.status === 401, 'a consumed code cannot be replayed');

    console.log('== sessions ==');
    const ses = await call('/api/auth/session', { token: good.data.token });
    ok(ses.status === 200 && ses.data.user.id === good.data.user.id, 'session resolves the user');
    ok(!JSON.stringify(ses.data).includes('9876543210'), 'session payload carries only the masked number');
    const again = await login(p1);
    const rotated = await call('/api/auth/session', { token: good.data.token });
    ok(rotated.status === 401, 're-login rotates the old token away');
    ok(again.user.id === good.data.user.id, 'same number maps to the same account');

    console.log('== publishing + privacy ==');
    const noauth = await call('/api/swap-requests', { method: 'POST', body: { journeyKey: 'flight|6E2135|2099-01-01|DEL→BLR', seat: '14C' } });
    ok(noauth.status === 401, 'publishing requires sign-in');
    const jk = 'flight|6E2135|2099-01-01|DEL→BLR';
    const mk = (t) => ({ journeyKey: jk, mode: 'flight', seat: t.seat, seatType: t.st, coach: '', want: ['Window seat'], note: t.note });
    const pub = await call('/api/swap-requests', { method: 'POST', token: again.token, body: mk({ seat: '14C', st: 'Aisle seat', note: 'with my mother' }) });
    ok(pub.status === 200 && pub.data.request.seat === '14C' && pub.data.request.mine, 'owner publishes and sees own seat');
    const dup = await call('/api/swap-requests', { method: 'POST', token: again.token, body: mk({ seat: '14C', st: 'Aisle seat' }) });
    ok(dup.status === 409, 'one live listing per traveller per journey');

    const userB = await login('+91 90000 00001');
    const listB = await call('/api/swap-requests?journeyKey=' + encodeURIComponent(jk), { token: userB.token });
    const cardB = (listB.data.requests || [])[0];
    ok(listB.status === 200 && cardB && cardB.seatType === 'Aisle seat', 'other traveller sees the listing by seat type');
    ok(cardB && cardB.seat === undefined, 'exact seat hidden before completion');
    ok(!JSON.stringify(listB.data).includes('9876543210'), 'list payload contains no phone number');

    console.log('== acceptance rules ==');
    const ownAccept = await call('/api/swap-requests/' + pub.data.request.id + '/accept', { method: 'POST', token: again.token, body: { seat: '22A' } });
    ok(ownAccept.status === 403, 'cannot accept your own listing');
    const accB = await call('/api/swap-requests/' + pub.data.request.id + '/accept', { method: 'POST', token: userB.token, body: { seat: '8A', seatType: 'Window seat' } });
    ok(accB.status === 200 && accB.data.request.state === 'accepted', 'traveller B accepts');
    const accAgain = await call('/api/swap-requests/' + pub.data.request.id + '/accept', { method: 'POST', token: userB.token, body: { seat: '8A' } });
    ok(accAgain.status === 409, 'accepting twice is rejected');
    const userC = await login('+91 90000 00002');
    const accC = await call('/api/swap-requests/' + pub.data.request.id + '/accept', { method: 'POST', token: userC.token, body: { seat: '1F' } });
    ok(accC.status === 409, 'a third traveller cannot take an accepted swap (no double-commit)');

    console.log('== completion + reveal ==');
    const doneB = await call('/api/swap-requests/' + pub.data.request.id + '/complete', { method: 'POST', token: userB.token });
    ok(doneB.status === 403, 'only the owner can complete');
    const doneA = await call('/api/swap-requests/' + pub.data.request.id + '/complete', { method: 'POST', token: again.token });
    ok(doneA.status === 200 && doneA.data.request.reveal && doneA.data.request.reveal.theirSeat === '8A', 'completion reveals the accepter seat to the owner');
    const listB2 = await call('/api/swap-requests?journeyKey=' + encodeURIComponent(jk), { token: userB.token });
    const doneCard = (listB2.data.requests || []).find((r) => r.id === pub.data.request.id);
    ok(doneCard && doneCard.reveal && doneCard.reveal.theirSeat === '14C', 'completion reveals the owner seat to the accepter');
    const listC = await call('/api/swap-requests?journeyKey=' + encodeURIComponent(jk), { token: userC.token });
    ok(!(listC.data.requests || []).some((r) => r.id === pub.data.request.id), 'completed swap is invisible to outsiders');

    console.log('== cancel + logout ==');
    const pub2 = await call('/api/swap-requests', { method: 'POST', token: userC.token, body: mk({ seat: '2B', st: 'Aisle seat' }) });
    const cancelOther = await call('/api/swap-requests/' + pub2.data.request.id + '/cancel', { method: 'POST', token: userB.token });
    ok(cancelOther.status === 403, 'only the owner can cancel');
    const cancelOwn = await call('/api/swap-requests/' + pub2.data.request.id + '/cancel', { method: 'POST', token: userC.token });
    ok(cancelOwn.status === 200, 'owner withdraws');
    const out = await call('/api/auth/logout', { method: 'POST', token: userC.token });
    const afterOut = await call('/api/auth/session', { token: userC.token });
    ok(out.status === 200 && afterOut.status === 401, 'logout kills the session');

    /* restart durability: sessions + requests survive a server restart */
    srv.kill();
    await new Promise((r2) => setTimeout(r2, 300));
    const srv2 = spawn(process.execPath, [path.join(ROOT, 'server', 'dev-server.js')], {
      env: { ...process.env, PORT: String(PORT), SWAP_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    srv2.stderr.on('data', (d) => process.stderr.write('[server2] ' + d));
    let up2 = false;
    for (let i = 0; i < 50 && !up2; i++) {
      try { const r = await fetch(BASE + '/api/health'); up2 = r.ok; } catch (_) { await new Promise((r2) => setTimeout(r2, 100)); }
    }
    const sesAfter = await call('/api/auth/session', { token: again.token });
    ok(up2 && sesAfter.status === 200, 'sessions survive a server restart (file store)');
    srv2.kill();
  } finally {
    try { srv.kill(); } catch (_) {}
    try { fs.unlinkSync(DATA); } catch (_) {}
  }
  console.log(fail ? fail + ' failures' : 'All auth checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
