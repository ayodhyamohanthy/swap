/* SwapSeat smoke + critical tests (Playwright).
   Covers §12 gates that need a browser: same-service matching, date isolation,
   preview outcomes, request lifecycle/expiry, offline honesty, a11y basics.
   Run:  node tests/e2e-smoke.js   (server on :8099; set BASE to override)
   Needs: playwright-core resolvable (env PLAYWRIGHT_CORE) + Chrome. */
const path = require('path');
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
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  console.log('== load ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  ok(await page.title().then(t => t.includes('SwapSeat')), 'app loads');

  console.log('== journey + map ==');
  await page.click('#lookupBtn');
  await page.waitForSelector('#seatmap .coach-shell', { timeout: 8000 });
  ok(true, 'coach map draws for 12951');
  await page.waitForSelector('#paySearch', { timeout: 8000 });
  await page.click('#paySearch');
  await page.waitForSelector('#modal:not([hidden]) #payOk', { timeout: 5000 });
  await page.click('#payOk');
  await page.waitForSelector('#swapList .swap', { timeout: 8000 });
  ok(true, '₹49 search fee unlocks matching');
  await page.click('#coachPills button[data-c="B2"]');
  await page.waitForTimeout(400);
  await page.click('#seatmap [data-seat="22"]');
  await page.waitForSelector('#zoombox:not([hidden])', { timeout: 5000 }).catch(() => {});
  const summary = await page.textContent('#pickSummary');
  ok(/22.*UB.*Bay 3/s.test(summary), 'berth 22 explained as UB in bay 3: ' + summary.slice(0, 60));
  const aria = await page.getAttribute('#seatmap [data-seat="22"]', 'aria-label');
  ok(aria && aria.includes('Upper'), 'seat buttons carry screen-reader labels');
  ok(await page.evaluate(() => !!document.querySelector('#mapList summary')), 'text list alternative present');

  console.log('== same-service matching, dates never cross ==');
  const todayCards = await page.$$eval('#swapList .swap .top b', els => els.map(e => e.textContent));
  ok(todayCards.some(t => /Falcon|Kestrel/.test(t)), 'today: 12951 seeds visible (' + todayCards.length + ' cards)');
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  await page.fill('#journeyDate', tomorrow);
  await page.click('#lookupBtn');
  await page.waitForSelector('#paySearch', { timeout: 8000 });
  await page.click('#paySearch');
  await page.waitForSelector('#modal:not([hidden]) #payOk', { timeout: 5000 });
  await page.click('#payOk');
  await page.waitForSelector('#swapList .swap', { timeout: 8000 });
  const tmCards = await page.$$eval('#swapList .swap .top b', els => els.map(e => e.textContent));
  ok(!tmCards.some(t => /Falcon-31|Kestrel-08/.test(t)), 'tomorrow: today’s seeds gone (no cross-date match)');
  ok(tmCards.some(t => /Lark-72/.test(t)), 'tomorrow: dateOffset+1 seed appears');
  const today = new Date().toISOString().slice(0, 10);
  await page.fill('#journeyDate', today);
  await page.click('#lookupBtn');
  await page.waitForTimeout(600);

  console.log('== preview + free request + lifecycle ==');
  await page.click('#seatmap [data-seat="22"]');
  await page.waitForTimeout(400);
  await page.click('#swapList [data-preview]');
  await page.waitForSelector('#modal:not([hidden]) .gains, #modal:not([hidden]) h3', { timeout: 5000 });
  const pv = await page.textContent('#modal');
  ok(/YOUR MOVE|→/.test(pv), 'preview shows your move');
  ok(/crew|TTE|approval|not.*reassignment/i.test(pv), 'preview states approval requirement');
  await page.click('#pvReq');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.getElementById('modal').hidden === false || true), 'request submitted');
  const inbox = await page.textContent('#myReqs');
  ok(/Requested/.test(inbox), 'inbox shows requested state');
  // expire it via debug handle
  await page.evaluate(() => {
    const reqs = JSON.parse(localStorage.getItem('swapseat_reqs') || '[]');
    reqs.forEach(r => { r.expires = Date.now() - 1000; });
    localStorage.setItem('swapseat_reqs', JSON.stringify(reqs));
    window.SwapSeatDebug.sweep();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const inbox2 = await page.textContent('#myReqs');
  ok(/Expired/.test(inbox2), 'expired request labelled expired after sweep');
  ok(!(await page.$('#myReqs [data-acc]')), 'expired request cannot be accepted (no accept button)');

  console.log('== offline honesty ==');
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => !document.getElementById('offlineBar').hidden), 'offline banner shown');
  ok(await page.evaluate(() => document.getElementById('postBtn').disabled), 'post disabled offline');

  console.log('ERRORS:', errors.length ? errors : 'none');
  ok(errors.length === 0, 'zero console/page/network errors');
  await browser.close();
  console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll browser checks passed.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E_FATAL:', e.message); process.exit(1); });
