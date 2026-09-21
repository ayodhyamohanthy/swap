/* SwapSeat · mobile-first audit (real browser measurements).
   Run: node tests/mobile-audit.js        (static server on :8099)
   Env: BASE, CHROME, PLAYWRIGHT_CORE, OUT (screenshot dir)

   Measures, per screen and per viewport:
     · document scrollWidth vs innerWidth  -> horizontal overflow
     · interactive elements smaller than 44x44 CSS px
     · body font size, input font size (mobile zoom risk)
   and captures the device-matrix screenshots. */
const fs = require('fs');
const path = require('path');
const PW = process.env.PLAYWRIGHT_CORE || '/Users/ayodhyarammohanthy/node_modules/playwright-core';
const { chromium } = require(PW);
const BASE = process.env.BASE || 'http://localhost:8099/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || path.join(__dirname, '..', '.audit');

const VIEWPORTS = [
  { name: '320-small-phone', width: 320, height: 568, mobile: true },
  { name: '390-large-phone', width: 390, height: 844, mobile: true },
  { name: '768-tablet', width: 768, height: 1024, mobile: false },
  { name: '1280-desktop', width: 1280, height: 900, mobile: false },
];
const SAFE_SCREENS = ['home', 'booking', 'manual', 'trips', 'wallet', 'profile', 'history', 'offline', 'failure', 'unsupported'];

const measure = async (page) => page.evaluate(() => {
  const de = document.documentElement;
  const mounts = Array.from(document.querySelectorAll('#flowScreen'));
  const target = mounts[0] || document.body;
  const small = [];
  target.querySelectorAll('button,a[href],input,select,summary,[role="tab"],[role="button"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;                 // hidden
    if (getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none') return;
    if (r.width < 44 || r.height < 44) {
      small.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: (el.className || '').toString().slice(0, 40),
        text: (el.textContent || '').trim().slice(0, 24),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  });
  const inputs = Array.from(target.querySelectorAll('input,select,textarea')).map((el) => ({
    id: el.id || null, fontSize: parseFloat(getComputedStyle(el).fontSize),
  }));
  return {
    screen: target.getAttribute('data-screen'),
    innerWidth: window.innerWidth,
    scrollWidth: de.scrollWidth,
    overflow: de.scrollWidth - window.innerWidth,
    bodyFontSize: parseFloat(getComputedStyle(document.body).fontSize),
    smallTargets: small,
    inputs,
    horizontalScrollers: Array.from(document.querySelectorAll('#flowScreen, .seatgrid, .coach-row, .fuselage'))
      .filter((el) => el.scrollWidth > el.clientWidth + 2)
      .map((el) => ({ cls: (el.className || '').toString().slice(0, 30), content: el.scrollWidth, box: el.clientWidth })),
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const report = { generatedAt: new Date().toISOString(), base: BASE, viewports: {}, serviceWorker: {}, offline: {}, install: {} };

  /* ---------- 1 · overflow + tap targets on every reachable screen ---------- */
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    /* Prerendered-home drift check: the static markup in index.html must equal
       what Flow's home screen renders for the default state, or the boot
       optimisation would paint a different screen than the app shows. */
    if (vp.width === 320) {
      const drift = await page.evaluate(() => {
        const norm = (h) => h.replace(/\s+/g, ' ').trim();
        const stat = norm(document.getElementById('flowScreen').innerHTML);
        const dyn = norm(Flow.screens.home.render(Flow.ctx));
        return { equal: stat === dyn, staticLen: stat.length, renderedLen: dyn.length };
      });
      if (!drift.equal) console.log('  NOTE  prerendered home differs from render() (len ' + drift.staticLen + ' vs ' + drift.renderedLen + ')');
      report.prerenderDrift = drift;
    }

    const screens = [];
    for (const id of SAFE_SCREENS) {
      await page.evaluate((s) => { if (typeof Flow !== 'undefined') Flow.show(s); }, id);
      await page.waitForTimeout(180);
      const m = await measure(page);
      screens.push(m);
      if (vp.width === 320) await page.screenshot({ path: path.join(OUT, `320-${id}.png`), fullPage: true });
      if (['home', 'history'].includes(id)) await page.screenshot({ path: path.join(OUT, `${vp.name}-${id}.png`), fullPage: true });
    }

    /* happy path: booking -> seats -> prefs -> search -> matches (via the flow) */
    const walk = ['seats', 'prefs', 'search', 'matches'];
    await page.evaluate(() => {
      const res = Bookings.find('train', '2718284018', 'MOHANTY');
      if (res && res.booking) {
        Bookings.setCurrent(res.booking);
        Flow.ctx.booking = res.booking;
        Flow.syncEngine(res.booking);
      }
    });
    /* accepter / post-confirmation screens: need an incoming request in context */
    await page.evaluate(() => {
      const b = Bookings.current();
      const inc = Bookings.incoming(b);
      if (inc && inc.length) Flow.ctx.incomingId = inc[0].id;
    });
    const fullWalk = walk.concat(['requestSent', 'notif', 'request', 'acceptance', 'track', 'chat', 'done', 'confirmed']);
    for (const id of fullWalk) {
      await page.evaluate((s) => { if (typeof Flow !== 'undefined') Flow.show(s); }, id);
      await page.waitForTimeout(260);
      let m;
      try { m = await measure(page); } catch (e) { m = { screen: id, error: String(e.message) }; }
      screens.push(m);
      if (vp.width === 320) await page.screenshot({ path: path.join(OUT, `320-${id}.png`), fullPage: true });
      if (vp.width === 390) await page.screenshot({ path: path.join(OUT, `${vp.name}-${id}.png`), fullPage: true });
    }
    if (vp.width === 768) await page.evaluate(() => Flow.show('home'));
    if (vp.width === 1280) await page.evaluate(() => Flow.show('home'));

    report.viewports[vp.name] = { width: vp.width, screens, consoleErrors: errors };
    await ctx.close();
  }

  /* ---------- 2 · service worker + offline ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    report.serviceWorker = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      const cache = keys[0] ? await caches.open(keys[0]) : null;
      const reqs = cache ? await cache.keys() : [];
      return {
        registered: !!reg, active: !!(reg && reg.active), scope: reg && reg.scope,
        caches: keys, cachedCount: reqs.length,
        cachedPaths: reqs.map((r) => new URL(r.url).pathname).sort(),
      };
    });
    await page.screenshot({ path: path.join(OUT, '390-online.png'), fullPage: false });

    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
    report.offline = await page.evaluate(() => {
      const bar = document.getElementById('offlineBar');
      return {
        bannerVisible: !!(bar && !bar.hidden),
        bannerText: bar ? bar.textContent.trim().slice(0, 140) : null,
        flowRendered: !!document.querySelector('#flowScreen .fs-head, #flowScreen .fcard'),
        title: document.title,
        simStamp: (document.querySelector('[data-offline-stamp]') || {}).textContent || null,
      };
    });
    /* offline navigation to a page not in cache must serve the offline document */
    const nav = await page.goto('http://localhost:8099/definitely-not-cached.html', { waitUntil: 'domcontentloaded' }).catch(() => null);
    report.offline.fallbackDoc = nav ? { status: nav.status(), url: nav.url(), isOfflineDoc: /offline/i.test(await page.title()) } : { status: 'navigation failed' };
    report.offline.fallbackText = (await page.textContent('body')).replace(/\s+/g, ' ').slice(0, 160);
    await page.screenshot({ path: path.join(OUT, '390-offline-fallback.png'), fullPage: true });
    await ctx.setOffline(false);
    await ctx.close();
  }

  /* ---------- 3 · install prompt surfaces ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt');
      e.prompt = () => {};
      e.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(e);
    });
    await page.waitForTimeout(300);
    report.install.flowButton = await page.evaluate(() => {
      const b = document.getElementById('flowInstall');
      return { present: !!b, visible: !!(b && b.getBoundingClientRect().width > 0), label: b ? b.textContent.trim() : null };
    });
    const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const iosPage = await ios.newPage();
    await iosPage.goto(BASE, { waitUntil: 'networkidle' });
    await iosPage.waitForTimeout(2200);
    report.install.iosHint = await iosPage.evaluate(() => {
      const b = document.getElementById('iosHint');
      return { visible: !!(b && !b.hidden), text: b ? b.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null };
    });
    await iosPage.screenshot({ path: path.join(OUT, 'ios-390-install-hint.png'), fullPage: false });
    await ctx.close(); await ios.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'mobile-audit.json'), JSON.stringify(report, null, 2));

  /* ---------- summary ---------- */
  let worstOverflow = 0; let smallTotal = 0; const offenders = [];
  Object.entries(report.viewports).forEach(([vp, data]) => {
    data.screens.forEach((s) => {
      if (s.overflow > 0) offenders.push(`${vp}/${s.screen}: +${s.overflow}px`);
      worstOverflow = Math.max(worstOverflow, s.overflow);
      smallTotal += s.smallTargets.length;
    });
  });
  console.log('== mobile audit ==');
  console.log('worst horizontal overflow:', worstOverflow, 'px', offenders.length ? '(' + offenders.join(', ') + ')' : '(none)');
  console.log('sub-44px targets across all screen/viewport pairs:', smallTotal);
  console.log('service worker:', report.serviceWorker.registered ? 'registered' : 'NOT registered',
    '| cache:', (report.serviceWorker.caches || []).join(','), '|', report.serviceWorker.cachedCount, 'entries');
  console.log('offline banner:', report.offline.bannerVisible, '| fallback doc:', JSON.stringify(report.offline.fallbackDoc));
  console.log('install: flow button', JSON.stringify(report.install.flowButton), '| iOS hint', JSON.stringify(report.install.iosHint));
  const errs = Object.entries(report.viewports).flatMap(([vp, d]) => d.consoleErrors.map((e) => vp + ' ' + e));
  console.log('console errors:', errs.length ? errs : 'none');
  console.log('report:', path.join(OUT, 'mobile-audit.json'));
  process.exit(worstOverflow > 0 || errs.length ? 1 : 0);
})().catch((e) => { console.error('AUDIT_FATAL', e); process.exit(1); });
