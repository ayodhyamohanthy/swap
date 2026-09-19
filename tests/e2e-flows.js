/* SwapSeat flows: invites, watchlist, reports+admin, funnel.
   Run: node tests/e2e-flows.js (server on :8099; BASE/CHROME/PLAYWRIGHT_CORE envs) */
const PW = process.env.PLAYWRIGHT_CORE || '/Users/ayodhyarammohanthy/node_modules/playwright-core';
const { chromium } = require(PW);
const BASE = process.env.BASE || 'http://localhost:8099/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 480, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });

  const today = new Date().toISOString().slice(0, 10);

  console.log('== invite link ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(`${BASE}#j=train|12951|${today}|B2|MMCT→NDLS`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#seatmap .coach-shell', { timeout: 8000 });
  ok(await page.evaluate(() => document.querySelector('#coachPills button[data-c="B2"]').classList.contains('on')), 'invite preselects coach B2');
  ok((await page.inputValue('#segFrom')) === 'MMCT', 'invite fills segment');
  const cards = await page.$$eval('#swapList .swap', els => els.length);
  ok(cards > 0, `invite lands on matching service (${cards} cards)`);

  console.log('== watchlist ==');
  await page.click('#watchBtn');
  const watch = await page.evaluate(() => JSON.parse(localStorage.getItem('swapseat_watches') || '[]'));
  ok(watch.length === 1 && /12951/.test(watch[0].service), 'watch stored for service');
  ok(/Watching/.test(await page.textContent('#watchBtn')), 'watch button reflects state');

  console.log('== report → admin ==');
  await page.click('#swapList [data-report]');
  await page.waitForSelector('#modal:not([hidden]) [data-r]', { timeout: 5000 });
  await page.click('#modal [data-r]');
  await page.waitForTimeout(400);
  const admin = await page.textContent('#reportList');
  ok(/Seat not where shown|Abusive|Spam|Other/.test(admin) || /12951|6E2031/.test(admin), 'report appears in admin queue');
  const afterReport = await page.$$eval('#swapList .swap', els => els.length);
  ok(afterReport === cards - 1, `reported card hidden (${cards} → ${afterReport})`);

  console.log('== layout correction ==');
  await page.click('#layoutBtn');
  await page.fill('#layoutNote', 'E2E probe: bay 1 side berths mislabeled');
  await page.click('#layoutSend');
  await page.waitForTimeout(400);
  ok(/E2E probe/.test(await page.textContent('#layoutList')), 'layout correction queued');

  console.log('== funnel ==');
  const funnel = await page.textContent('#funnel');
  ok(/Map resolution.*resolved/.test(funnel.replace(/\s+/g, ' ')), 'funnel shows resolution + coverage');

  console.log('ERRORS:', errors.length ? errors : 'none');
  ok(errors.length === 0, 'zero console/page/network errors');
  await browser.close();
  console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll flow checks passed.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E_FATAL:', e.message); process.exit(1); });
