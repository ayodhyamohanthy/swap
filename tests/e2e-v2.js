/* SwapSeat v2: master-spec compliance (privacy, payments, bus, lifecycle).
   Run: node tests/e2e-v2.js (server on :8099; BASE/CHROME/PLAYWRIGHT_CORE envs) */
const PW = process.env.PLAYWRIGHT_CORE || '/Users/ayodhyarammohanthy/node_modules/playwright-core';
const { chromium } = require(PW);
const BASE = process.env.BASE || 'http://localhost:8099/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };
const ls = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  const today = new Date().toISOString().slice(0, 10);

  console.log('== bus engine ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('#classicShell .mode-tabs button[data-mode="bus"]');
  await page.fill('#busOp', 'VRL');
  await page.fill('#journeyNo', 'HYD42');
  await page.fill('#segFrom', 'HYD');
  await page.fill('#segTo', 'BLR');
  await page.click('#lookupBtn');
  await page.waitForSelector('#seatmap .coach-shell', { timeout: 8000 });
  ok(await page.evaluate(() => !!document.querySelector('#coachPills button[data-c="S"]')), 'bus seater map draws (coach S)');
  await page.click('#seatmap [data-seat="5"]');
  const bsum = await page.textContent('#pickSummary');
  ok(/S · 5/.test(bsum), 'bus seat pickable: ' + bsum.slice(0, 60));
  await page.click('#busTypeRow button[data-bt="sleeper"]');
  await page.click('#lookupBtn');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !!document.querySelector('#coachPills button[data-c="L"]')), 'sleeper offers Lower/Upper decks');

  console.log('== search gate + seat privacy ==');
  await page.click('#classicShell .mode-tabs button[data-mode="train"]');
  await page.click('#lookupBtn');
  await page.waitForSelector('#paySearch', { timeout: 8000 });
  ok(true, 'market locked behind ₹49 search fee');
  await page.click('#paySearch');
  await page.waitForSelector('#modal:not([hidden]) #payOk', { timeout: 5000 });
  await page.click('#payOk');
  await page.waitForSelector('#swapList .swap', { timeout: 8000 });
  const market = await page.textContent('#swapList');
  ok(/Approximate position/.test(market), 'other seats masked as approximate');
  ok(!/B2 · 22/.test(market), 'no exact seat numbers leak pre-payment');
  await page.click('#coachPills button[data-c="B2"]');
  await page.waitForTimeout(400);
  await page.click('#seatmap [data-seat="22"]');
  await page.waitForTimeout(400);
  await page.click('#swapList .swap:has-text("Kestrel") [data-preview]');
  await page.waitForSelector('#modal:not([hidden]) #pvReq', { timeout: 5000 });
  const pv = await page.textContent('#modal');
  ok(/a compatible seat/.test(pv), 'preview masks their exact seat');
  ok(/not.*reassignment/i.test(pv), 'preview keeps approval disclaimer');

  console.log('== request → accept → ₹99 completion → reveal ==');
  await page.click('#pvReq');
  await page.waitForTimeout(500);
  ok(/Requested/.test(await page.textContent('#myReqs')), 'request recorded');
  await page.click('#myReqs [data-acc]');
  await page.waitForTimeout(400);
  await page.click('#myReqs [data-payc]');
  await page.waitForSelector('#modal:not([hidden]) #payOk', { timeout: 5000 });
  await page.click('#payOk');
  await page.waitForTimeout(500);
  await page.click('#swapList .swap:has-text("Kestrel") [data-preview]');
  await page.waitForSelector('#modal:not([hidden])', { timeout: 5000 });
  const pv2 = await page.textContent('#modal');
  ok(/B2 · 7/.test(pv2) && /SWAP-/.test(pv2), 'exact seats + confirmation ID after completion payment');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('modal').hidden = true);

  console.log('== multi-request auto-cancel on complete ==');
  await page.click('#swapList .swap:has-text("Falcon") [data-preview]');
  await page.waitForSelector('#modal:not([hidden]) #pvReq', { timeout: 5000 });
  await page.click('#pvReq');
  await page.waitForTimeout(400);
  await page.click('#swapList .swap:has-text("Ibis") [data-preview]');
  await page.waitForSelector('#modal:not([hidden]) #pvReq', { timeout: 5000 });
  await page.click('#pvReq');
  await page.waitForTimeout(400);
  await page.click('#myReqs .swap:has-text("Falcon") [data-acc]');
  await page.waitForTimeout(400);
  await page.click('#myReqs .swap:has-text("Falcon") [data-done]');
  await page.waitForTimeout(500);
  const cancelled = await page.evaluate(() => JSON.parse(localStorage.getItem('swapseat_reqs') || '[]').filter(r => r.state === 'cancelled').length);
  ok(cancelled >= 1, `pending alternatives auto-cancelled (${cancelled})`);

  console.log('== chat locked pre-acceptance ==');
  await page.click('#swapList .swap:has-text("Ibis") [data-chat]');
  await page.waitForTimeout(300);
  ok(/unlocks after both/.test(await page.textContent('#toast')), 'chat gated until acceptance');

  console.log('== no-match → wallet credit ==');
  await page.fill('#journeyNo', '99999');
  await page.click('#lookupBtn');
  await page.waitForSelector('#paySearch', { timeout: 8000 });
  await page.click('#paySearch');
  await page.waitForSelector('#modal:not([hidden]) #payOk', { timeout: 5000 });
  await page.click('#payOk');
  await page.waitForSelector('#swapList .swap', { timeout: 8000 });
  const nm = await page.textContent('#swapList');
  ok(/No match yet/.test(nm) && /WhatsApp/.test(nm), 'no-match sheet with share actions');
  const wallet = await page.textContent('#walletBox');
  ok(/₹49/.test(wallet), '₹49 search fee auto-credited to wallet');

  console.log('== admin wallet grant ==');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('swapseat_wallet') || '{}').balance || 0);
  await page.evaluate(() => document.getElementById('admin').scrollIntoView());
  await page.click('#issueCredit');
  await page.fill('#creditAmt', '20');
  await page.click('#creditGo');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('swapseat_wallet') || '{}').balance || 0);
  ok(after === before + 20, `admin grant lands in wallet (${before} → ${after})`);

  console.log('ERRORS:', errors.length ? errors : 'none');
  ok(errors.length === 0, 'zero console/page/network errors');
  await browser.close();
  console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll v2 checks passed.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E_FATAL:', e.message); process.exit(1); });
