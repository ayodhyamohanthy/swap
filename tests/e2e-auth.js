/* SwapSeat Milestone 2 e2e (Playwright): two travellers, one journey, one swap.
   Drives the real UI against server/dev-server.js (spawned on a throwaway
   port): OTP sign-in, publish, privacy (no phone, no exact seat), accept,
   complete, mutual seat reveal - in two isolated browser contexts.
   Run:  node tests/e2e-auth.js
   Needs: playwright-core resolvable (env PLAYWRIGHT_CORE) + Chrome (env CHROME). */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PW = process.env.PLAYWRIGHT_CORE || '/Users/ayodhyarammohanthy/node_modules/playwright-core';
const { chromium } = require(PW);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PORT = 8300 + Math.floor(Math.random() * 300);
const BASE = 'http://localhost:' + PORT + '/index.html';
const DATA = path.join(os.tmpdir(), 'swapseat-e2e-' + process.pid + '.json');
const ROOT = path.join(__dirname, '..');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

async function newTraveller(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(label + ' PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(label + ' CONSOLE: ' + m.text()); });
  page.on('response', (r) => { if (process.env.E2E_DEBUG && r.url().includes('/api/')) console.log('  [api]', r.request().method(), r.status(), r.url().split('/api/')[1].slice(0, 70)); });
  page.on('pageerror', (e) => { if (process.env.E2E_DEBUG) console.log('  [err]', label, e.message); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('[data-screen="home"]');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-screen="home"]');
  return { ctx, page, errors };
}
async function sampleBooking(page) {
  await page.click('[data-sample]:visible');
  await page.waitForSelector('[data-screen="flightdetails"]', { timeout: 8000 });
  return page.evaluate(() => Bookings.current().primary.seat);
}
async function signIn(page, phone) {
  await page.click('#fsBack'); // back to home
  await page.waitForSelector('[data-screen="home"]');
  await page.click('#acctCard [data-go-scr="board"]');
  await page.waitForSelector('[data-screen="board"]');
  await page.click('[data-screen="board"] [data-go-scr="login"]');
  await page.waitForSelector('#loginPhone');
  await page.fill('#loginPhone', phone);
  await page.click('#loginSend');
  await page.waitForSelector('#loginCode', { timeout: 8000 });
  const code = await page.textContent('#devCodeHint b'); // dev server surfaces the code in the UI
  await page.fill('#loginCode', code.trim());
  await page.click('#loginVerify');
  await page.waitForSelector('[data-screen="board"]', { timeout: 8000 });
}
async function boardReady(page) {
  await page.waitForFunction(() => typeof Flow !== 'undefined' && Flow.current === 'board' && !!Flow.ctx.boardData, null, { timeout: 8000 });
}
async function revisitBoard(page) {
  await page.click('#flowNav [data-go="home"]');
  await page.waitForSelector('[data-screen="home"]');
  await page.evaluate(() => { Flow.ctx.boardData = null; });
  await page.click('#acctCard [data-go-scr="board"]');
  await boardReady(page);
}

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'dev-server.js')], {
    env: { ...process.env, PORT: String(PORT), SWAP_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { const r = await fetch('http://localhost:' + PORT + '/api/health'); up = r.ok; } catch (_) { await new Promise((r2) => setTimeout(r2, 100)); }
    }
    if (!up) throw new Error('dev server did not start');
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    console.log('== traveller A: sign in + publish ==');
    const A = await newTraveller(browser, 'A');
    const seatA = await sampleBooking(A.page);
    ok(!!seatA, 'A loads the sample journey (seat ' + seatA + ')');
    await signIn(A.page, '+91 98765 43210');
    await boardReady(A.page);
    ok(await A.page.$('#boardPublish') !== null, 'A reaches the journey board signed in');
    await A.page.click('#boardPublish');
    await A.page.waitForSelector('#pubWants [data-w]');
    await A.page.click('#pubWants [data-w]');
    await A.page.fill('#pubNote', 'Window please - first time flying');
    await A.page.click('#pubGo');
    await boardReady(A.page);
    const aText = await A.page.textContent('#flowScreen');
    ok(aText.includes('Your listing'), 'A sees the live listing');

    console.log('== traveller B: privacy + accept ==');
    const B = await newTraveller(browser, 'B');
    const seatB = await sampleBooking(B.page);
    await signIn(B.page, '+91 90000 00001');
    await boardReady(B.page);
    const bText = await B.page.textContent('#flowScreen');
    ok(bText.includes('Traveller 10'), 'B sees A as a masked traveller, not a name or number');
    ok(!bText.includes('98765') && !bText.includes('43210'), 'B never sees A\'s phone number');
    ok(!new RegExp('\\b' + seatA + '\\b').test(bText), 'B cannot see A\'s exact seat (' + seatA + ') before completion');
    await B.page.click('[data-accept]');
    await B.page.waitForFunction(() => document.querySelector('#flowScreen').textContent.includes('completes it'), null, { timeout: 8000 });
    const bText2 = await B.page.textContent('#flowScreen');
    ok(bText2.includes('waiting for them to complete') || bText2.includes('completes it'), 'B sees the accepted-waiting state');
    ok(await B.page.$('[data-accept]') === null, 'the accepted listing can never be accepted again');

    console.log('== A completes, both seats revealed ==');
    await revisitBoard(A.page);
    const aText2 = await A.page.textContent('#flowScreen');
    ok(aText2.includes('accepted'), 'A sees B accepted');
    await A.page.click('[data-complete]');
    await A.page.waitForFunction(() => document.querySelector('#flowScreen').textContent.includes('Swap completed'), null, { timeout: 8000 });
    const aText3 = await A.page.textContent('#flowScreen');
    ok(aText3.includes('Swap completed') && aText3.includes(seatB), 'A now sees B\'s seat (' + seatB + ')');
    await revisitBoard(B.page);
    await B.page.waitForFunction(() => document.querySelector('#flowScreen').textContent.includes('Swap completed'), null, { timeout: 8000 });
    const bText3 = await B.page.textContent('#flowScreen');
    ok(bText3.includes('Swap completed') && bText3.includes(seatA), 'B now sees A\'s seat (' + seatA + ')');

    console.log('== sign out ==');
    await A.page.click('#flowNav [data-go="home"]');
    await A.page.waitForSelector('[data-screen="home"]');
    await A.page.click('#acctOut');
    await A.page.waitForFunction(() => document.querySelector('#flowScreen').textContent.includes('Sign in'), null, { timeout: 8000 });
    const aText4 = await A.page.textContent('#flowScreen');
    ok(aText4.includes('Sign in'), 'A signs out cleanly');

    ok(A.errors.length === 0, 'no page errors on A' + (A.errors.length ? ' - ' + A.errors[0] : ''));
    ok(B.errors.length === 0, 'no page errors on B' + (B.errors.length ? ' - ' + B.errors[0] : ''));
    await A.ctx.close(); await B.ctx.close();
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
    try { srv.kill(); } catch (_) {}
    try { fs.unlinkSync(DATA); } catch (_) {}
  }
  console.log(fail ? fail + ' failures' : 'All M2 e2e checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
