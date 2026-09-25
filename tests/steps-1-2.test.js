/* SeatSwap Steps 1-2 checks: non-negotiable rules + build plan definition of done.
   Run: node --test tests/steps-1-2.test.js
   - No banned words in shipped locales/UI (footer disclaimer sentence excepted).
   - Exactly 3 bottom tabs. Google-only sign-in. ₹99 = ₹49 + ₹50 constants.
   - PNR utils: 10-digit validation, SMS parse, chair-car seats, quota note.
   - PWA manifest tokens + service worker strategy. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FOOTER = 'SeatSwap is not an official railway service.';
const stripFooter = (s) => s.split(FOOTER).join('');
function bannedFound(s, w) {
  // Phrases match as substrings; single words match whole-word only
  // (so "better" never trips "TTE", "passengers" never trips "pass").
  if (w.includes(' ')) return s.toLowerCase().includes(w.toLowerCase());
  return new RegExp('\\b' + w + '\\b', 'i').test(s);
}

describe('locales', () => {
  for (const lang of ['en', 'hi']) {
    it(`${lang}.json parses with required keys`, () => {
      const j = JSON.parse(read(`locales/${lang}.json`));
      for (const k of ['brand.wordmark', 'brand.tagline', 'nav.home', 'nav.swaps', 'nav.profile',
        'first.title', 'first.paste', 'note.body', 'note.c1', 'note.got', 'footer.line2',
        'privacy.i1t', 'trip.quota', 'trip.child', 'trip.addNewPnr', 'profile.creditBody',
        'profile.myTrips', 'settings.title', 'del.confirm', 'swaps.none', 'home.travelBetter']) {
        const v = k.split('.').reduce((a, x) => (a ? a[x] : undefined), j);
        assert.ok(typeof v === 'string' && v.length > 0, `missing ${k}`);
      }
      assert.equal(j.brand.wordmark, 'SeatSwap');
      assert.equal(j.footer.line2, FOOTER);
    });
  }

  it('no banned words in locales (footer disclaimer excepted)', () => {
    const banned = ['TTE', 'swap pass', 'Indian Railways', 'IRCTC approved', 'authorised', 'legal', 'grievance'];
    for (const lang of ['en', 'hi']) {
      const s = stripFooter(read(`locales/${lang}.json`));
      for (const w of banned) assert.ok(!bannedFound(s, w), `${lang} contains banned: ${w}`);
      assert.ok(!/\bofficial\b/i.test(s), `${lang} contains standalone "official" outside footer`);
      assert.ok(!/\bpass\b/i.test(s), `${lang} contains standalone "pass"`);
    }
  });

  it('pricing + positioning copy present', () => {
    const en = JSON.parse(read('locales/en.json'));
    assert.match(en.first.coreValue, /₹99/);
    assert.match(en.first.hint, /₹50/);
    assert.match(en.first.signedOutNote, /signed out/i);
    assert.match(en.signin.body, /Google/i);
    assert.ok(!/otp|password|whatsapp/i.test(en.signin.body), 'sign-in must be Google only');
  });
});

describe('app shell', () => {
  it('exactly 3 bottom tabs: Home / Swaps / Profile', () => {
    const app = read('js/seatswap-app.js');
    assert.ok(app.includes("['home'") && app.includes("['swaps'") && app.includes("['profile'"), 'tabs defined');
    const tabDefs = (app.match(/\['(home|swaps|profile)'/g) || []).length;
    assert.equal(tabDefs, 3);
    assert.ok(!/My Trips|Wallet/.test(app), 'no legacy 4-tab labels');
  });
  it('setup screens hide the tab bar', () => {
    const app = read('js/seatswap-app.js');
    assert.ok(/SETUP.*language.*note.*privacy.*alerts.*signin/s.test(app));
    assert.ok(/el\.hidden = true/.test(app));
  });
  it('money in paise, ₹99 = ₹49 + ₹50', () => {
    const store = read('js/seatswap-store.js');
    assert.ok(/PRICE_PAISE:\s*9900/.test(store));
    assert.ok(/FEE_PAISE:\s*4900/.test(store));
    assert.ok(/CREDIT_PAISE:\s*5000/.test(store));
  });
  it('every state change writes activity_log', () => {
    const store = read('js/seatswap-store.js');
    for (const a of ['pnr_added', 'open_to_swap_on', 'trip_removed', 'sign_in']) {
      assert.ok(store.includes(a), `missing activity ${a}`);
    }
  });
  it('no banned words in shipped UI code (footer excepted)', () => {
    const banned = ['TTE', 'swap pass', 'Indian Railways', 'IRCTC approved', 'authorised', 'legal', 'grievance'];
    for (const f of ['js/seatswap-app.js', 'js/seatswap-pnr.js', 'js/seatswap-store.js', 'js/seatswap-i18n.js', 'index.html']) {
      const s = stripFooter(read(f));
      for (const w of banned) assert.ok(!bannedFound(s, w), `${f} contains banned: ${w}`);
      assert.ok(!/\bofficial\b/i.test(s), `${f} contains "official" outside footer`);
    }
  });
  it('no OTP/phone auth in new code', () => {
    const s = read('js/seatswap-app.js') + read('js/seatswap-store.js');
    assert.ok(!/request-otp|verify-otp|one-time code/i.test(s), 'phone OTP must not exist');
  });
});

describe('pnr utils', () => {
  function loadPNR() {
    const ctx = {};
    vm.createContext(ctx);
    return vm.runInContext(read('js/seatswap-pnr.js') + '\nSeatSwapPNR;', ctx);
  }
  it('10-digit validation', () => {
    const P = loadPNR();
    assert.equal(P.validPNR('1234567890'), true);
    assert.equal(P.validPNR('12345'), false);
    assert.equal(P.validPNR('ABC1234567'), false);
    assert.equal(P.last4('1234567890'), '7890');
  });
  it('parses pasted IRCTC SMS locally', () => {
    const P = loadPNR();
    const p = P.parseSMS('PNR:1234567890 TRN:12951 DOJ:12-06-2026 3A B2 34 UB NDLS to BPL CNF');
    assert.equal(p.pnr, '1234567890');
    assert.equal(p.train_no, '12951');
    assert.equal(p.journey_date, '2026-06-12');
    assert.equal(p.class, '3A');
    assert.equal(p.coach, 'B2');
    assert.equal(p.berth_no, '34');
    assert.equal(p.berth_type, 'UB');
    assert.equal(p.status, 'CNF');
  });
  it('chair-car seat words + quota note', () => {
    const P = loadPNR();
    assert.equal(P.isChair('CC'), true);
    assert.equal(P.isChair('SL'), false);
    assert.equal(P.berthLabel('WINDOW', 'CC'), 'Window');
    assert.equal(P.quotaNote('SS'), true);
    assert.equal(P.quotaNote('GN'), false);
  });
});

describe('pwa + tokens', () => {
  it('manifest per spec', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    assert.equal(m.name, 'SeatSwap');
    assert.equal(m.short_name, 'SeatSwap');
    assert.equal(m.display, 'standalone');
    assert.equal(m.theme_color, '#1F6B45');
    assert.equal(m.background_color, '#FAF6EE');
    const sizes = m.icons.map((i) => i.sizes + ':' + i.purpose).join(',');
    assert.ok(sizes.includes('192x192'), 'icon 192');
    assert.ok(sizes.includes('512x512'), 'icon 512');
    assert.ok(sizes.includes('maskable'), 'maskable icon');
  });
  it('design tokens per docs/07', () => {
    const css = read('styles.css');
    for (const [k, v] of [['--primary', '#1F6B45'], ['--accent', '#F2A33A'], ['--background', '#FAF6EE']]) {
      assert.ok(css.includes(`${k}: ${v}`), `missing token ${k}`);
    }
    assert.ok(/\.tabs/.test(css), 'bottom tab bar styled');
  });
  it('service worker: NetworkFirst pages, kill switch, no SW in dev/iframe', () => {
    const sw = read('sw.js');
    assert.ok(/NetworkFirst|fetch\(request\)/.test(sw));
    assert.ok(/paypal|razorpay/i.test(sw), 'payment hosts excluded');
    const idx = read('index.html');
    assert.ok(idx.includes('sw') && idx.includes('off'), 'kill switch wiring');
    assert.ok(/inFrame|isDev/.test(idx), 'dev/iframe guard');
  });
  it('schema: RLS, grants, has_role, paise-ready', () => {
    const sql = read('supabase/schema-steps-1-2.sql');
    assert.ok(/enable row level security/.test(sql));
    assert.ok(/has_role/.test(sql));
    assert.ok(/pnr_hash/.test(sql) && !/full_pnr|plain_text_pnr/i.test(sql));
    assert.ok(/is_child_no_berth/.test(sql));
    assert.ok(/activity_log/.test(sql));
  });
});
