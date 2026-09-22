/* SwapSeat M3 e2e (Playwright): the real train requester flow at 390px.
   A drives the UI end to end: journey entry -> own seat + confidence ->
   preferences -> protected matches (masked, fit score, no seat leak) ->
   activation checkout (disclosure, sandbox) -> request sent.
   B's journey is seeded through the same API the UI uses.
   Run:  node tests/e2e-requester.js
   Needs: playwright-core (env PLAYWRIGHT_CORE) + Chrome (env CHROME). */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PW = process.env.PLAYWRIGHT_CORE || '/Users/ayodhyarammohanthy/node_modules/playwright-core';
const { chromium } = require(PW);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PORT = 8600 + Math.floor(Math.random() * 300);
const BASE = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'swapseat-req-' + process.pid + '.json');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || '/tmp';

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

const J = { trainNumber: '12627', date: '2026-10-02', boarding: 'SBC', destination: 'NDLS', boardingIndex: 1, destinationIndex: 10, classCode: 'SL', coach: 'S4' };

async function apiCall(pathname, opts) {
  const o = opts || {};
  const res = await fetch(BASE + pathname, {
    method: o.method || 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function apiSignIn(phone) {
  const r1 = await apiCall('/api/auth/request-otp', { method: 'POST', body: { phone } });
  const r2 = await apiCall('/api/auth/verify-otp', { method: 'POST', body: { phone, code: r1.data.devCode } });
  return r2.data.token;
}

(async () => {
  try { fs.unlinkSync(DATA); } catch (_) {}
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'dev-server.js')], {
    env: { ...process.env, PORT: String(PORT), SWAP_DATA: DATA }, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];
  try {
    /* Traveller B seeds via API (same endpoints the UI uses) */
    const tokenB = await apiSignIn('9000000002');
    const jb = await apiCall('/api/journeys', { method: 'POST', token: tokenB, body: { ...J, berth: 21 } });
    await apiCall('/api/journeys/' + jb.data.journey.id + '/preferences', { method: 'PUT', token: tokenB, body: { acceptTypes: ['LB', 'SL'], reason: 'elderly parent needs a lower berth', displayName: 'Priya Sharma', genderPref: 'same-gender', gender: 'female' } });
    ok(jb.status === 200, 'traveller B seeded via API');

    /* Traveller A drives the UI */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Failed to load resource.*402/.test(t)) return; // activation-required is a designed API state, not a UI fault
      errors.push('CONSOLE: ' + t);
    });
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForSelector('[data-screen="home"]');
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-screen="home"]');

    /* sign in via UI */
    await page.click('#acctCard [data-go-scr="login"]');
    await page.waitForSelector('#loginPhone');
    await page.fill('#loginPhone', '9000000001');
    await page.click('#loginSend');
    await page.waitForSelector('#loginCode', { timeout: 8000 });
    const code = (await page.textContent('#devCodeHint b')).trim();
    await page.fill('#loginCode', code);
    await page.click('#loginVerify');
    await page.waitForSelector('#acctCard [data-go-scr="x-journey"]', { timeout: 12000 });
    ok(true, 'traveller A signed in via UI');

    /* entry point on home */
    await page.click('#acctCard [data-go-scr="x-journey"]');
    await page.waitForSelector('[data-screen="x-journey"]');
    ok(true, 'home entry opens journey entry');

    /* journey form */
    await page.fill('#xjTrain', J.trainNumber);
    await page.fill('#xjDate', J.date);
    await page.fill('#xjFrom', J.boarding);
    await page.fill('#xjFromIdx', '1');
    await page.fill('#xjTo', J.destination);
    await page.fill('#xjToIdx', '10');
    await page.fill('#xjCoach', J.coach);
    await page.fill('#xjBerth', '19');
    await page.click('#xjForm button[type="submit"]');
    await page.waitForSelector('[data-screen="x-map"]', { timeout: 8000 });
    const mapText = await page.textContent('[data-screen="x-map"]');
    ok(mapText.includes('berth 19') && mapText.includes('Upper') && mapText.includes('expected'), 'own seat map shows exact seat + confidence');
    await page.screenshot({ path: path.join(SHOTS, 'm3-map.png') });

    await page.click('#xmOk');
    await page.waitForSelector('[data-screen="x-prefs"]');
    await page.click('#xpTypes .chip[data-t="MB"]');
    await page.fill('#xpReason', 'window side preferred for kid');
    await page.fill('#xpName', 'Arjun Mehta');
    await page.click('#xpForm button[type="submit"]');
    await page.waitForSelector('[data-screen="x-matches"]', { timeout: 8000 });
    await page.waitForSelector('[data-req]', { timeout: 8000 });
    const mText = await page.textContent('[data-screen="x-matches"]');
    ok(mText.includes('Priya S.'), 'candidate shows masked name');
    ok(!mText.includes('21') || mText.indexOf('21') === mText.indexOf('12627') - 4, 'candidate card hides exact berth');
    ok(!/female|same-gender/i.test(mText), 'matches never show gender');
    ok(mText.includes('Preference fit'), 'explainable fit score shown');
    await page.click('[data-why="0"]');
    const whyText = await page.textContent('#why-0');
    ok(whyText.includes('not a chance'), 'fit explainer disclaims probability');
    await page.screenshot({ path: path.join(SHOTS, 'm3-matches.png') });

    /* request -> checkout (activation required) */
    await page.click('[data-req]');
    await page.waitForSelector('[data-screen="x-checkout"]', { timeout: 8000 });
    await page.waitForSelector('#xcPay', { timeout: 8000 });
    const cText = await page.textContent('[data-screen="x-checkout"]');
    ok(cText.includes('₹49'), 'checkout shows ₹49 activation');
    ok(cText.includes('₹148'), 'checkout discloses ₹148 maximum upfront');
    ok(cText.includes('never charged to accept'), 'checkout carries accepter copy');
    ok(/SANDBOX/.test(cText), 'sandbox badge visible');
    await page.waitForSelector('#toast', { state: 'detached', timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, 'm3-checkout.png') });

    await page.click('#xcPay');
    await page.waitForSelector('[data-screen="x-sent"]', { timeout: 10000 });
    const sText = await page.textContent('[data-screen="x-sent"]');
    ok(sText.includes('pending') && sText.includes('Priya S.'), 'request sent with masked counterpart');
    await page.screenshot({ path: path.join(SHOTS, 'm3-sent.png') });

    /* B sees the incoming request */
    const listB = await apiCall('/api/exchange-requests', { token: tokenB });
    ok(listB.data.requests.length === 1 && listB.data.requests[0].role === 'accepter', 'traveller B sees incoming request');
    ok(!JSON.stringify(listB.data).includes('9000000001'), 'no phone leaks in request payloads');

    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    console.log(fail ? fail + ' FAILURES' : 'All M3 requester e2e checks passed');
  } finally {
    await browser.close();
    srv.kill();
    try { fs.unlinkSync(DATA); } catch (_) {}
  }
  process.exit(fail ? 1 : 0);
})();
