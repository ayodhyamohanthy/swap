/* SwapSeat · validation + failure-path audit (real browser).
   Run: node tests/states-audit.js        (static server on :8099)
   Env: BASE, CHROME, PLAYWRIGHT_CORE, OUT

   Proves, with observed values rather than code reading:
     · empty / malformed / unknown input is blocked inline before submission
       and the user stays on the form
     · the confirm action is really disabled while the input is invalid
     · timeout, offline, gateway, stale-quote, rejected and unsupported-browser
       paths each render a distinct, non-blocking, actionable state
     · no loading state can hang */
const fs = require('fs');
const path = require('path');
const PW = process.env.PLAYWRIGHT_CORE || '/Users/ayodhyarammohanthy/node_modules/playwright-core';
const { chromium } = require(PW);
const BASE = process.env.BASE || 'http://localhost:8099/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || path.join(__dirname, '..', '.audit');

let pass = 0; let fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  ok   ' + msg + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  FAIL ' + msg + (extra ? '  [' + extra + ']' : '')); }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const evidence = { generatedAt: new Date().toISOString(), validation: {}, failureStates: {}, loading: {} };
  const shown = () => page.evaluate(() => Flow.current);

  console.log('== input validation blocks submission ==');
  await page.evaluate(() => Flow.show('booking'));
  await page.waitForTimeout(200);

  /* empty PNR */
  await page.click('#bFetch');
  await page.waitForTimeout(150);
  let err = await page.evaluate(() => {
    const e = document.getElementById('bErr');
    return { hidden: e.hidden, text: e.textContent.trim(), screen: Flow.current };
  });
  ok(!err.hidden && /PNR/.test(err.text), 'empty reference blocked inline: "' + err.text + '"');
  ok(err.screen === 'booking', 'stayed on the booking form (no submission)');
  evidence.validation.emptyReference = err;

  /* malformed (too short for a flight PNR) */
  await page.fill('#bPnr', '12');
  await page.fill('#bSurname', 'MOHANTY');
  await page.click('#bFetch');
  await page.waitForTimeout(150);
  err = await page.evaluate(() => ({ hidden: document.getElementById('bErr').hidden, text: document.getElementById('bErr').textContent.trim(), screen: Flow.current }));
  ok(!err.hidden && /6 letters\/numbers/.test(err.text), 'malformed reference blocked: "' + err.text + '"');
  ok(err.screen === 'booking', 'stayed on the booking form');
  evidence.validation.malformedReference = err;

  /* missing surname */
  await page.fill('#bPnr', '6E4F3B');
  await page.fill('#bSurname', '');
  await page.click('#bFetch');
  await page.waitForTimeout(150);
  err = await page.evaluate(() => ({ hidden: document.getElementById('bErr').hidden, text: document.getElementById('bErr').textContent.trim(), screen: Flow.current }));
  ok(!err.hidden && /surname/i.test(err.text), 'missing surname blocked: "' + err.text + '"');
  evidence.validation.missingSurname = err;

  /* unknown reference (format valid, no such asset/booking) */
  await page.fill('#bPnr', 'ZZ9999');
  await page.fill('#bSurname', 'NOBODY');
  await page.click('#bFetch');
  await page.waitForTimeout(150);
  err = await page.evaluate(() => ({ hidden: document.getElementById('bErr').hidden, text: document.getElementById('bErr').textContent.trim(), screen: Flow.current }));
  ok(!err.hidden && /No booking found/.test(err.text), 'unknown reference blocked: "' + err.text + '"');
  evidence.validation.unknownReference = err;

  /* valid input proceeds (proves the blocker is the input, not the form) */
  await page.fill('#bPnr', '6E4F3B');
  await page.fill('#bSurname', 'MOHANTY');
  await page.click('#bFetch');
  await page.waitForTimeout(300);
  const afterValid = await shown();
  ok(afterValid === 'flightdetails', 'valid input proceeds to the next step', afterValid);
  evidence.validation.validProceeds = afterValid;

  /* manual-entry form */
  await page.evaluate(() => Flow.show('manual'));
  await page.waitForTimeout(200);
  await page.click('#mGo');
  await page.waitForTimeout(150);
  const mErr = await page.evaluate(() => ({ hidden: document.getElementById('mErr').hidden, text: document.getElementById('mErr').textContent.trim(), screen: Flow.current }));
  ok(!mErr.hidden && /service number/i.test(mErr.text), 'manual entry: empty service blocked: "' + mErr.text + '"');
  ok(mErr.screen === 'manual', 'stayed on the manual form');
  evidence.validation.manualEmpty = mErr;

  /* seat step: nothing selected -> inline error, no navigation */
  await page.evaluate(() => {
    const res = Bookings.find('train', '2718284018', 'MOHANTY');
    if (res && res.booking) { Bookings.setCurrent(res.booking); Flow.ctx.booking = res.booking; Flow.syncEngine(res.booking); }
    Flow.show('seats');
  });
  await page.waitForTimeout(300);
  const seatsInfo = await page.evaluate(() => ({
    screen: Flow.current,
    mine: document.querySelectorAll('#flowScreen [data-seat].mine').length,
    sel: document.querySelectorAll('#flowScreen [data-seat].sel').length,
  }));
  ok(seatsInfo.screen === 'seats' && seatsInfo.mine >= 1, 'seat step renders with the booked seat preselected', JSON.stringify(seatsInfo));
  /* the booked seat counts as picked even though it is styled as "mine", not
     "sel" — deselect it (and anything else selected) to reach an empty pick */
  await page.evaluate(() => {
    document.querySelectorAll('#flowScreen [data-seat].sel, #flowScreen [data-seat].mine').forEach((b) => b.click());
  });
  await page.waitForTimeout(200);
  const beforeSeats = await shown();
  await page.click('#seatNext');
  await page.waitForTimeout(250);
  const seatErr = await page.evaluate(() => {
    const e = document.getElementById('seatErr');
    return { present: !!e, hidden: e ? e.hidden : null, text: e ? e.textContent.trim() : null, screen: Flow.current };
  });
  ok(seatErr.present && !seatErr.hidden && /Select at least one seat/.test(seatErr.text || ''), 'seat step blocks an empty selection: "' + seatErr.text + '"');
  ok(seatErr.screen === beforeSeats, 'stayed on the seat step (no submission)', seatErr.screen);
  evidence.validation.emptySeatSelection = seatErr;

  console.log('== confirm stays disabled while the input is invalid ==');
  const gate = await page.evaluate(() => {
    const b = Bookings.current();
    const inc = Bookings.incoming(b);
    Flow.ctx.incomingId = inc[0].id;
    Flow.show('acceptance');
    const btn = document.querySelector('#flowScreen [data-confirm]');
    return { found: !!btn, disabled: btn ? btn.disabled : null, ariaDisabled: btn ? btn.getAttribute('aria-disabled') : null, option: btn ? btn.dataset.option : null };
  });
  await page.waitForTimeout(200);
  evidence.feeGate = gate;
  if (gate.option === 'B') {
    ok(gate.disabled === true, 'Option A is really disabled when the policy says Option B', JSON.stringify(gate));
    /* demo records are re-hydrated with fresh clock times on every read, so
       compare only the fields the acceptance could actually change */
    const proj = () => page.evaluate(() => {
      const x = Bookings.incoming(Bookings.current())[0] || {};
      return JSON.stringify({ id: x.id, state: x.state, confirmedAt: x.confirmedAt || null, completionPaid: !!x.completionPaid });
    });
    const before = await proj();
    await page.evaluate(() => { const b = document.querySelector('#flowScreen [data-confirm]'); if (b) b.click(); });
    await page.waitForTimeout(200);
    const after = await proj();
    ok(before === after, 'clicking the disabled Option A cannot confirm the swap', before + ' -> ' + after);
  } else {
    ok(gate.option === 'A', 'demo incoming request resolves to Option A (no fee due)', JSON.stringify(gate));
  }

  console.log('== failure states are distinct and actionable ==');
  const seenTitles = [];
  for (const reason of ['timeout', 'gateway', 'stale', 'rejected', 'generic']) {
    await page.evaluate((r) => window.SwapSeatStates.fail(r, { back: 'home', retry: 'home', detail: 'audit' }), reason);
    await page.waitForTimeout(220);
    const state = await page.evaluate(() => ({
      screen: Flow.current,
      heading: (document.querySelector('#flowScreen h2') || {}).textContent,
      body: (document.querySelector('#flowScreen .fmuted') || {}).textContent,
      retryLabel: (document.querySelector('#flowScreen [data-fretry]') || {}).textContent,
      hasBack: !!document.querySelector('#flowScreen [data-go-scr]'),
    }));
    seenTitles.push(state.heading);
    ok(state.screen === 'failure' && !!state.heading && !!state.retryLabel && state.hasBack,
      `${reason}: failure screen with retry + back`, `${state.heading} / ${state.retryLabel}`);
    evidence.failureStates[reason] = state;
  }
  ok(new Set(seenTitles).size === seenTitles.length, 'every failure reason renders a distinct message (' + seenTitles.length + ' unique)');

  /* offline routes to the offline state, not a generic error */
  await ctx.setOffline(true);
  await page.evaluate(() => window.SwapSeatStates.fail('timeout', { back: 'home' }));
  await page.waitForTimeout(250);
  const offState = await page.evaluate(() => ({ screen: Flow.current, heading: (document.querySelector('#flowScreen h2') || {}).textContent, retry: !!document.querySelector('#flowScreen [data-fretry]') }));
  ok(offState.screen === 'offline', 'offline + timeout routes to the dedicated offline state', JSON.stringify(offState));
  evidence.failureStates.offlineRoute = offState;
  await page.evaluate(() => Flow.show('offline'));
  await page.waitForTimeout(200);
  const offlineScreen = await page.evaluate(() => ({
    hasHistoryLink: !!document.querySelector('#flowScreen [data-go-scr="history"]'),
    explainsPaused: /paused|need a connection/i.test(document.querySelector('#flowScreen').textContent),
    stamp: (document.querySelector('#flowScreen [data-offline-stamp]') || {}).textContent || null,
  }));
  ok(offlineScreen.hasHistoryLink && offlineScreen.explainsPaused, 'offline screen says what is paused and still offers history', JSON.stringify(offlineScreen));
  evidence.failureStates.offlineScreen = offlineScreen;
  await ctx.setOffline(false);
  await page.waitForTimeout(200);

  /* unsupported browser */
  await page.evaluate(() => Flow.show('unsupported'));
  await page.waitForTimeout(200);
  const unsup = await page.evaluate(() => ({
    heading: (document.querySelector('#flowScreen h2') || {}).textContent,
    continueAnyway: !!document.querySelector('#flowScreen [data-go-scr="home"]'),
  }));
  ok(/Update your browser/i.test(unsup.heading || '') && unsup.continueAnyway, 'unsupported browser explains and still allows continuing', JSON.stringify(unsup));
  evidence.failureStates.unsupported = unsup;

  console.log('== no loading state can hang ==');
  await page.evaluate(() => Flow.show('searching'));
  await page.waitForTimeout(1600);
  const resolved = await shown();
  ok(resolved !== 'searching', 'matching interstitial resolves instead of spinning forever', resolved);
  evidence.loading.searchingResolvesTo = resolved;

  /* offline mid-search must not pretend progress */
  await ctx.setOffline(true);
  await page.evaluate(() => Flow.show('searching'));
  await page.waitForTimeout(1600);
  const offlineDuringSearch = await shown();
  ok(offlineDuringSearch === 'offline', 'going offline mid-search produces the offline state, not a fake result', offlineDuringSearch);
  evidence.loading.offlineDuringSearch = offlineDuringSearch;
  await ctx.setOffline(false);

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'states-audit.json'), JSON.stringify(evidence, null, 2));
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('report:', path.join(OUT, 'states-audit.json'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('STATES_FATAL', e); process.exit(1); });
