/* SwapSeat PWA layer regression checks (pure Node, no dependencies).
   Run: node tests/pwa.test.js
   These fail loudly if the installable-PWA contract regresses: precache list,
   offline document, manifest fields, icon geometry, theme colour consistency,
   the versioned ledger schema, and the offline test matrix hook. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } else console.log('  ok   ' + msg); };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p.replace(/^\.\//, '')));

const sw = read('sw.js');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

console.log('== service worker: precache vs reality ==');
const coreBlock = sw.match(/const CORE = \[([\s\S]*?)\];/);
ok(!!coreBlock, 'CORE precache list is declared');
const core = [...coreBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
ok(core.length > 10, `CORE has ${core.length} entries`);
core.forEach((p) => {
  if (p === './') return;                        // directory index
  ok(exists(p), `precached file exists: ${p}`);
});

console.log('== index.html loads only precached scripts ==');
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"/g)].map((m) => './' + m[1]);
ok(scripts.length >= 15, `${scripts.length} scripts referenced`);
scripts.forEach((s) => ok(core.includes(s), `precache covers ${s}`));
const css = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)"/g)].map((m) => './' + m[1]);
css.forEach((s) => ok(core.includes(s), `precache covers ${s}`));

console.log('== offline document ==');
ok(exists('offline.html'), 'offline.html exists');
ok(/const OFFLINE_URL = '\.\/offline\.html'/.test(sw), 'sw.js declares the offline document');
ok(/request\.mode === 'navigate'/.test(sw), 'navigations handled explicitly');
ok(/caches\.match\(OFFLINE_URL\)/.test(sw), 'navigation fallback serves the offline document');
ok(/NEVER_CACHE/.test(sw) && sw.includes('razorpay.com'), 'payment hosts are on the never-cache list');
ok(/SKIP_WAITING/.test(sw), 'update handshake (SKIP_WAITING) implemented');
const off = read('offline.html');
ok(!/<script[^>]+src="https?:/.test(off) && !/<link[^>]+href="https?:/.test(off), 'offline.html is self-contained (no remote assets)');
ok(/retryBtn/.test(off) && /Retry/.test(off), 'offline.html offers a retry action');
ok(/offlineStamp/.test(off), 'offline.html shows the last-updated timestamp');

console.log('== manifest ==');
['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color']
  .forEach((k) => ok(!!manifest[k], `manifest.${k} present`));
ok(manifest.display === 'standalone', 'display is standalone');
ok(!!manifest.id, 'manifest.id present (installable on newer browsers)');
const purposes = (manifest.icons || []).map((i) => i.purpose);
ok(purposes.includes('any'), 'an "any" purpose icon is declared');
ok(purposes.includes('maskable'), 'a "maskable" icon is declared');
const sizes = (manifest.icons || []).map((i) => i.sizes);
ok(sizes.includes('192x192') && sizes.includes('512x512'), '192px and 512px icons declared');
(manifest.icons || []).forEach((i) => ok(exists(i.src), `manifest icon file exists: ${i.src}`));

console.log('== icon geometry matches the declared sizes ==');
function pngSize(p) {
  const b = fs.readFileSync(path.join(ROOT, p.replace(/^\.\//, '')));
  if (b.slice(1, 4).toString() !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
(manifest.icons || []).forEach((i) => {
  const s = pngSize(i.src);
  const want = i.sizes.split('x');
  ok(s && s.w === parseInt(want[0], 10) && s.h === parseInt(want[1], 10),
    `${i.src} is really ${i.sizes} (got ${s ? s.w + 'x' + s.h : 'unreadable'})`);
});
const m512 = pngSize('./icons/maskable-512.png');
const i512 = pngSize('./icons/icon-512.png');
ok(!!m512 && !!i512, 'both 512 icons readable');
const sameBytes = fs.readFileSync(path.join(ROOT, 'icons/maskable-512.png')).equals(fs.readFileSync(path.join(ROOT, 'icons/icon-512.png')));
ok(!sameBytes, 'maskable icon is a distinct asset from the standard icon (not a byte copy)');

console.log('== theme colour stays consistent across surfaces ==');
const metas = [...html.matchAll(/<meta name="theme-color" content="([^"]+)"/g)].map((m) => m[1]);
ok(metas.length > 0, 'theme-color meta present');
ok(metas.every((c) => c.toLowerCase() === manifest.theme_color.toLowerCase()),
  `every theme-color meta matches the manifest (${manifest.theme_color})`);

console.log('== ledger schema is versioned and documented ==');
const ledger = read('js/ledger.js');
ok(/const SCHEMA_VERSION = \d+/.test(ledger), 'ledger declares SCHEMA_VERSION');
ok(/swapseat_ledger_v' \+ SCHEMA_VERSION/.test(ledger), 'storage key is derived from the schema version');
ok(/function syncFromLegacy/.test(ledger), 'legacy-store migration path exists');
ok(/function onAccountSwitch/.test(ledger), 'account switch clears user-scoped data');
const docs = (() => { try { return read('docs/PWA.md'); } catch { return ''; } })();
ok(!!docs, 'docs/PWA.md exists');
ok(/SCHEMA_VERSION|schemaVersion/.test(docs), 'docs/PWA.md documents the schema version');
['id', 'createdAt', 'updatedAt', 'mode', 'serviceNumber', 'travelDate', 'coachOrCabin', 'ownSeat', 'targetSeat', 'status', 'failureReason', 'quoteSummary']
  .forEach((f) => ok(docs.includes(f), `docs/PWA.md documents field ${f}`));

console.log('== mobile + state surfaces are wired ==');
ok(/id="history"/.test(read('js/history.js')) || /id: 'history'/.test(read('js/history.js')), 'history screen registered');
ok(/tabindex="-1"/.test(html) && /flowLive/.test(html), 'focus target + live region present');
ok(/<noscript>/.test(html), 'no-JS fallback notice present');
ok(/id="updateBar"/.test(html) && /id="iosHint"/.test(html), 'update + iOS install surfaces present');
ok(/safe-area-inset/.test(read('styles.css')), 'safe-area insets used');
ok(/overflow-x:auto/.test(read('styles.css')), 'wide seat rows have a contained scroll');

console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll PWA checks passed.');
process.exit(fail ? 1 : 0);
