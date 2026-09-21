/* SwapSeat · accessibility audit (real browser, no app changes).
   Run: node tests/a11y-audit.js     (static server on :8099)
   Env: BASE, CHROME, PLAYWRIGHT_CORE, AXE (path to axe.min.js), OUT (json dir)

   Checks: WCAG AA contrast on rendered text, axe-core violations on the main
   screens, keyboard reachability + visible focus, programmatic labels on form
   fields, and that state changes are announced (aria-live). */
const fs = require('fs');
const path = require('path');
const PW = process.env.PLAYWRIGHT_CORE || '/Users/ayodhyarammohanthy/node_modules/playwright-core';
const { chromium } = require(PW);
const BASE = process.env.BASE || 'http://localhost:8099/index.html';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AXE = process.env.AXE || '/tmp/axe/node_modules/axe-core/axe.min.js';
const OUT = process.env.OUT || path.join(__dirname, '..', '.audit');
const SCREENS = ['home', 'booking', 'seats', 'prefs', 'search', 'matches', 'history', 'offline', 'failure', 'unsupported'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const res = Bookings.find('train', '2718284018', 'MOHANTY');
    if (res && res.booking) { Bookings.setCurrent(res.booking); Flow.ctx.booking = res.booking; Flow.syncEngine(res.booking); }
  });

  const report = { generatedAt: new Date().toISOString(), axe: {}, contrast: {}, keyboard: {}, labels: {}, live: {} };

  /* ---------- 1 · axe-core per screen ---------- */
  for (const id of SCREENS) {
    await page.evaluate((s) => { if (typeof Flow !== 'undefined') Flow.show(s); }, id);
    await page.waitForTimeout(220);
    await page.addScriptTag({ path: AXE });
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document.getElementById('flowScreen') || document.body, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
    });
    report.axe[id] = res;
  }

  /* ---------- 2 · rendered contrast on the flow surface ---------- */
  const contrast = await page.evaluate(() => {
    const lum = (c) => {
      const s = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    };
    const parse = (str) => {
      const m = str.match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(',').map((v) => parseFloat(v));
      return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.9) return c.rgb;
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    const out = [];
    const seen = new Set();
    document.querySelectorAll('#flowScreen *').forEach((el) => {
      const txt = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      if (!txt) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.5) return;
      const fg = parse(cs.color); if (!fg) return;
      const bg = bgOf(el);
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      const r = ratio(fg.rgb, bg);
      const key = cs.color + '|' + bg.join(',') + '|' + Math.round(size);
      if (seen.has(key)) return; seen.add(key);
      if (r < need) out.push({ text: txt.slice(0, 30), color: cs.color, bg: 'rgb(' + bg.join(',') + ')', size: Math.round(size * 10) / 10, ratio: Math.round(r * 100) / 100, need });
    });
    return out;
  });
  report.contrast = { checked: 'rendered text nodes on the flow surface', failures: contrast };

  /* ---------- 3 · keyboard reachability + visible focus ---------- */
  report.keyboard = await page.evaluate(async () => {
    Flow.show('booking');
    return await new Promise((resolve) => setTimeout(() => {
      const mount = document.getElementById('flowScreen');
      const focusedOnScreen = document.activeElement === mount;
      const focusables = Array.from(mount.querySelectorAll('button,a[href],input,select,summary,[tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.getBoundingClientRect().width > 0);
      const noOutline = focusables.filter((el) => {
        el.focus();
        const cs = getComputedStyle(el);
        const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
        const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
        return !(hasOutline || hasShadow);
      }).map((el) => (el.id || el.className || el.tagName).toString().slice(0, 30));
      resolve({ focusMovesToScreen: focusedOnScreen, focusableCount: focusables.length, withoutVisibleFocus: noOutline });
    }, 300));
  });

  /* ---------- 4 · labels + live regions ---------- */
  report.labels = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('#flowScreen input, #flowScreen select, #flowScreen textarea').forEach((el) => {
      const id = el.id;
      const labelled = !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby') ||
        (id && !!document.querySelector('label[for="' + id + '"]')) || !!el.closest('label');
      if (!labelled) problems.push(id || el.outerHTML.slice(0, 60));
    });
    return { unlabelledFields: problems };
  });
  report.live = await page.evaluate(() => ({
    flowLive: !!document.getElementById('flowLive'),
    flowLiveRole: (document.getElementById('flowLive') || {}).getAttribute
      ? document.getElementById('flowLive').getAttribute('role') : null,
    toastRole: (document.getElementById('toast') || {}).getAttribute
      ? document.getElementById('toast').getAttribute('role') : null,
    offlineBarRole: (document.getElementById('offlineBar') || {}).getAttribute
      ? document.getElementById('offlineBar').getAttribute('role') : null,
  }));

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'a11y-audit.json'), JSON.stringify(report, null, 2));

  const axeCount = Object.values(report.axe).reduce((n, v) => n + v.length, 0);
  console.log('== accessibility audit ==');
  console.log('axe violations (wcag2a/2aa) across', SCREENS.length, 'screens:', axeCount);
  Object.entries(report.axe).forEach(([s, v]) => { if (v.length) console.log('   ', s, JSON.stringify(v)); });
  console.log('rendered contrast failures:', contrast.length ? contrast : 'none');
  console.log('keyboard:', JSON.stringify(report.keyboard));
  console.log('labels:', JSON.stringify(report.labels));
  console.log('live regions:', JSON.stringify(report.live));
  console.log('report:', path.join(OUT, 'a11y-audit.json'));
  process.exit(axeCount || contrast.length || report.keyboard.withoutVisibleFocus.length || report.labels.unlabelledFields.length ? 1 : 0);
})().catch((e) => { console.error('A11Y_FATAL', e); process.exit(1); });
