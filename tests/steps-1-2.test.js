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
        'profile.myTrips', 'settings.title', 'del.confirm', 'swaps.none', 'home.travelBetter',
        'req.title', 'req.needChoices', 'match.sendFree', 'reqm.free', 'incoming.earn',
        'pay.noSwap', 'pay.lockNote', 'paystatus.failedB', 'paystatus.pendingB',
        'swap.diffB', 'confirm.swapped', 'chat.riskT', 'meet.title', 'summary.title',
        'swapdone.earnedT', 'rate.title', 'updates.title', 'onb.title', 'grp.price',
        'inv.bad', 'admin.title', 'signin.demoName']) {
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
    for (const f of ['js/seatswap-app.js', 'js/seatswap-pnr.js', 'js/seatswap-store.js', 'js/seatswap-i18n.js', 'js/seatswap-config.js', 'js/seatswap-data.js', 'js/seatswap-engine.js', 'js/seatswap-pay.js', 'js/seatswap-demo.js', 'js/seatswap-auth.js', 'js/seatswap-screens1.js', 'js/seatswap-screens2.js', 'js/seatswap-screens3.js', 'index.html']) {
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

describe('engine state machines + money outcomes', () => {
  function world() {
    const store = new Map();
    const sandbox = {
      console,
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
      sessionStorage: {
        getItem: () => null, setItem: () => {}, removeItem: () => {},
      },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    for (const f of ['js/seatswap-config.js', 'js/seatswap-pnr.js', 'js/seatswap-store.js', 'js/seatswap-data.js', 'js/seatswap-engine.js']) {
      vm.runInContext(read(f), sandbox, { filename: f });
    }
    return sandbox;
  }
  async function flow(steps) {
    const ctx = world();
    const script = `(async () => {
      const out = {};
      const me = SeatSwapEngine.signIn({ first_name: 'Ravi', last_initial: 'K', via: 'demo' });
      out.me = me.id;
      const trip = await SeatSwapStore.addTrip({ pnr: '9999999999', train_no: '12951',
        journey_date: '2026-06-12', from_code: 'NDLS', to_code: 'BPL', class: '3A',
        coach: 'B2', berth_no: '34', berth_type: 'UB', status: 'CNF', quota: 'GN', source: 'typed',
        passengers: [{ label: 'Passenger 1', coach: 'B2', berth_no: '34', berth_type: 'UB', status: 'CNF', quota: 'GN', is_child_no_berth: false }] });
      out.trip = trip.id;
      const _s0 = SeatSwapData.seedsFor(trip);
      const ch = [...new Set([_s0[0].berth_type, 'LB', 'MB', 'UB', 'SL', 'SU'])].slice(0, 3);
      ${steps}
      return out;
    })()`;
    return vm.runInContext(script, ctx);
  }

  it('request > offer > accept > pay > lock > both swapped > confirmed', async () => {
    const out = await flow(`
      const req = SeatSwapEngine.newRequest({ tripId: trip.id, choices: ch, sameCoach: false, keepTogether: false, reason: 'family' });
      out.req = req.id; out.st1 = req.status;
      const seeds = SeatSwapData.seedsFor(trip);
      const rows = SeatSwapData.scoreMatches(req, trip, seeds, {});
      out.matches = rows.length;
      const offers = SeatSwapEngine.sendOffers(req.id, rows.slice(0, 2).map(x => x.seed.id));
      out.sent = offers.length;
      SeatSwapEngine.acceptOffer(offers[0].id, offers[0].acceptor_id);
      out.st2 = SeatSwapEngine.getRequest(req.id).status;
      const pay = SeatSwapEngine.createPayment(req.id, { provider: 'demo', useCredit: false });
      out.provider = pay.provider;
      SeatSwapEngine.gatewayResult(pay.id, 'paid', 'demo_x1');
      const locked = SeatSwapEngine.getRequest(req.id);
      out.st3 = locked.status;
      out.superseded = SeatSwapEngine.offersFor(req.id).filter(o => o.status === 'superseded').length;
      SeatSwapEngine.submitOutcome(req.id, me.id, 'swapped');
      SeatSwapEngine.submitOutcome(req.id, offers[0].acceptor_id, 'swapped');
      out.st4 = SeatSwapEngine.getRequest(req.id).status;
      out.log = SeatSwapEngine.db().activity.length > 5;
    `);
    assert.equal(out.st1, 'searching');
    assert.ok(out.matches >= 1, 'expected demo matches, got ' + out.matches);
    assert.ok(out.sent >= 1, 'expected offers sent');
    assert.equal(out.st2, 'accepted_awaiting_payment');
    assert.equal(out.provider, 'demo');
    assert.equal(out.st3, 'locked');
    assert.equal(out.superseded, out.sent - 1);
    assert.equal(out.st4, 'confirmed');
    assert.ok(out.log, 'activity log written');
  });

  it('money: no-show agreed > requester +9900 credit; failed payment charges nothing', async () => {
    const out = await flow(`
      const req = SeatSwapEngine.newRequest({ tripId: trip.id, choices: ch, sameCoach: false, keepTogether: false, reason: '' });
      const seeds = SeatSwapData.seedsFor(trip);
      const rows = SeatSwapData.scoreMatches(req, trip, seeds, {});
      const offers = SeatSwapEngine.sendOffers(req.id, [rows[0].seed.id]);
      SeatSwapEngine.acceptOffer(offers[0].id, offers[0].acceptor_id);
      const pay = SeatSwapEngine.createPayment(req.id, { provider: 'demo', useCredit: false });
      SeatSwapEngine.gatewayResult(pay.id, 'paid', 'demo_x2');
      SeatSwapEngine.submitOutcome(req.id, me.id, 'no_show');
      SeatSwapEngine.submitOutcome(req.id, offers[0].acceptor_id, 'no_show');
      out.st = SeatSwapEngine.getRequest(req.id).status;
      out.bal = SeatSwapEngine.myBalance();
      const req2 = SeatSwapEngine.newRequest({ tripId: trip.id, choices: ch, sameCoach: false, keepTogether: false, reason: '' });
      const rows2 = SeatSwapData.scoreMatches(req2, trip, seeds, {});
      const off2 = SeatSwapEngine.sendOffers(req2.id, [rows2[0].seed.id]);
      SeatSwapEngine.acceptOffer(off2[0].id, off2[0].acceptor_id);
      const pay2 = SeatSwapEngine.createPayment(req2.id, { provider: 'demo', useCredit: false });
      SeatSwapEngine.gatewayResult(pay2.id, 'failed');
      out.payFailed = SeatSwapEngine.db().payments[pay2.id].status;
      out.stillWaiting = SeatSwapEngine.getRequest(req2.id).status;
    `);
    assert.equal(out.st, 'voided');
    assert.equal(out.bal, 9900, 'requester credit should be exactly ₹99, got ' + out.bal);
    assert.equal(out.payFailed, 'failed');
    assert.equal(out.stillWaiting, 'accepted_awaiting_payment');
  });

  it('money: credit covers full amount > instant lock, provider credit', async () => {
    const out = await flow(`
      SeatSwapEngine.adminAdjust(me.id, 9900, 'test grant');
      out.bal0 = SeatSwapEngine.myBalance();
      const req = SeatSwapEngine.newRequest({ tripId: trip.id, choices: ch, sameCoach: false, keepTogether: false, reason: '' });
      const seeds = SeatSwapData.seedsFor(trip);
      const rows = SeatSwapData.scoreMatches(req, trip, seeds, {});
      const offers = SeatSwapEngine.sendOffers(req.id, [rows[0].seed.id]);
      SeatSwapEngine.acceptOffer(offers[0].id, offers[0].acceptor_id);
      const pay = SeatSwapEngine.createPayment(req.id, { provider: 'demo', useCredit: true });
      out.provider = pay.provider;
      out.st = SeatSwapEngine.getRequest(req.id).status;
      out.bal1 = SeatSwapEngine.myBalance();
    `);
    assert.equal(out.bal0, 9900);
    assert.equal(out.provider, 'credit');
    assert.equal(out.st, 'locked');
    assert.equal(out.bal1, 0);
  });

  it('dispute on differing answers; admin resolves; cancel > credit', async () => {
    const out = await flow(`
      const req = SeatSwapEngine.newRequest({ tripId: trip.id, choices: ch, sameCoach: false, keepTogether: false, reason: '' });
      const seeds = SeatSwapData.seedsFor(trip);
      const rows = SeatSwapData.scoreMatches(req, trip, seeds, {});
      const offers = SeatSwapEngine.sendOffers(req.id, [rows[0].seed.id]);
      SeatSwapEngine.acceptOffer(offers[0].id, offers[0].acceptor_id);
      const pay = SeatSwapEngine.createPayment(req.id, { provider: 'demo', useCredit: false });
      SeatSwapEngine.gatewayResult(pay.id, 'paid', 'demo_x3');
      SeatSwapEngine.submitOutcome(req.id, me.id, 'swapped');
      SeatSwapEngine.submitOutcome(req.id, offers[0].acceptor_id, 'no_show');
      out.disputed = SeatSwapEngine.getRequest(req.id).status;
      SeatSwapEngine.resolveDispute(req.id, me.id, 'voided', '');
      out.resolved = SeatSwapEngine.getRequest(req.id).status;
      out.bal = SeatSwapEngine.myBalance();
      const req2 = SeatSwapEngine.newRequest({ tripId: trip.id, choices: ch, sameCoach: false, keepTogether: false, reason: '' });
      const rows2 = SeatSwapData.scoreMatches(req2, trip, seeds, {});
      const off2 = SeatSwapEngine.sendOffers(req2.id, [rows2[0].seed.id]);
      SeatSwapEngine.acceptOffer(off2[0].id, off2[0].acceptor_id);
      const pay2 = SeatSwapEngine.createPayment(req2.id, { provider: 'demo', useCredit: true });
      SeatSwapEngine.gatewayResult(pay2.id, 'paid', 'demo_x4');
      SeatSwapEngine.cancelSwap(req2.id, me.id);
      out.cancelled = SeatSwapEngine.getRequest(req2.id).status;
    `);
    assert.equal(out.disputed, 'disputed');
    assert.equal(out.resolved, 'voided');
    assert.equal(out.bal, 9900);
    assert.equal(out.cancelled, 'voided');
  });

  it('guards: auth required, daily limit, backout returns to searching', async () => {
    const ctx = world();
    const script = `(async () => {
      const out = {};
      try { SeatSwapEngine.newRequest({ tripId: 'x', choices: ['LB'], reason: '' }); out.noauth = 'allowed'; }
      catch (e) { out.noauth = e.message; }
      const me = SeatSwapEngine.signIn({ first_name: 'R', last_initial: 'K', via: 'demo' });
      const trip = await SeatSwapStore.addTrip({ pnr: '8888888888', train_no: '12951',
        journey_date: '2026-06-12', from_code: 'A', to_code: 'B', class: 'SL',
        coach: 'S1', berth_no: '12', berth_type: 'LB', status: 'CNF', quota: 'GN', source: 'typed',
        passengers: [{ label: 'P1', coach: 'S1', berth_no: '12', berth_type: 'LB', status: 'CNF', quota: 'GN', is_child_no_berth: false }] });
      const _s0 = SeatSwapData.seedsFor(trip);
      const ch = [...new Set([_s0[0].berth_type, 'LB', 'MB', 'UB', 'SL', 'SU'])].slice(0, 3);
      const req = SeatSwapEngine.newRequest({ tripId: trip.id, choices: ch, sameCoach: false, keepTogether: false, reason: '' });
      const seeds = SeatSwapData.seedsFor(trip);
      const rows = SeatSwapData.scoreMatches(req, trip, seeds, {});
      const ids = rows.map(x => x.seed.id);
      while (ids.length < 11) ids.push('seed:' + trip.id + ':x' + ids.length);
      try { SeatSwapEngine.sendOffers(req.id, ids.slice(0, 11)); out.limit = 'allowed'; }
      catch (e) { out.limit = e.message; }
      const offers = SeatSwapEngine.sendOffers(req.id, [ids[0]]);
      SeatSwapEngine.acceptOffer(offers[0].id, offers[0].acceptor_id);
      SeatSwapEngine.backOutOffer(offers[0].id, offers[0].acceptor_id);
      out.back = SeatSwapEngine.getRequest(req.id).status;
      out.bo = SeatSwapEngine.backedOut30d(offers[0].acceptor_id);
      return out;
    })()`;
    const out = await vm.runInContext(script, ctx);
    assert.equal(out.noauth, 'auth_required');
    assert.equal(out.limit, 'daily_limit');
    assert.equal(out.back, 'searching');
    assert.equal(out.bo, 1);
  });
});
