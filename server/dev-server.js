/**
 * SwapSeat dev server (Milestone 2 slice) - zero npm dependencies.
 * Serves the static PWA and the identity + swap-coordination API:
 *
 *   POST /api/auth/request-otp   {phone}                      -> {ok:true, devCode?}
 *   POST /api/auth/verify-otp    {phone, code}                -> {token, user:{id, phoneMasked}}
 *   GET  /api/auth/session       (Bearer)                     -> {user:{id, phoneMasked}}
 *   POST /api/auth/logout        (Bearer)                     -> {ok:true}
 *
 *   GET  /api/swap-requests?journeyKey=...        (Bearer)    -> {requests:[...]}
 *   POST /api/swap-requests      {journeyKey, mode, seat, seatType, coach, want[], note}   (Bearer)
 *   POST /api/swap-requests/:id/accept   {seat, seatType, coach}                            (Bearer)
 *   POST /api/swap-requests/:id/complete                                                    (Bearer, owner)
 *   POST /api/swap-requests/:id/cancel                                                      (Bearer, owner)
 *
 * Privacy contract (SPEC section 13):
 *   - phone numbers never leave the server (clients only ever see a masked label);
 *   - exact seat numbers are hidden until the owner completes an accepted swap;
 *   - a request can be accepted exactly once (no double-commit), and only the
 *     owner can complete or cancel it.
 *
 * Dev mode (default outside production): request-otp returns the code in the
 * response as devCode so the demo and the e2e suite can sign in without an SMS
 * provider. Set NODE_ENV=production to disable devCode forever.
 *
 * Run:  node server/dev-server.js   (PORT default 8100)
 * Data: server/data/swap-data.json (override with SWAP_DATA=/path/file.json)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const exchange = require('./exchange.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8100);
const DEV = process.env.NODE_ENV !== 'production';
const DATA_FILE = process.env.SWAP_DATA || path.join(__dirname, 'data', 'swap-data.json');

const OTP_TTL_MS = Number(process.env.SWAP_OTP_TTL_MS || 10 * 60 * 1000);
const OTP_RESEND_MS = Number(process.env.SWAP_OTP_RESEND_MS || 30 * 1000);
const OTP_MAX_PER_WINDOW = Number(process.env.SWAP_OTP_MAX_PER_WINDOW || 5);
const OTP_WINDOW_MS = Number(process.env.SWAP_OTP_WINDOW_MS || 10 * 60 * 1000);
const OTP_MAX_ATTEMPTS = Number(process.env.SWAP_OTP_MAX_ATTEMPTS || 5);
const REQ_TTL_MS = Number(process.env.SWAP_REQ_TTL_MS || 24 * 60 * 60 * 1000);

/* ---------- store ---------- */
const otps = new Map(); // phone -> {code, exp, attempts, lastSentAt, sentWindow:[]}
let db = { users: {}, sessions: {}, requests: {}, journeys: {}, quotes: {}, payments: {}, entitlements: {}, exchangeRequests: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch (_) {}
function save() {
  try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) { console.error('[store] save failed:', e.message); }
}
const uid = (p) => p + '_' + crypto.randomBytes(9).toString('base64url');

/* ---------- helpers ---------- */
function normPhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
function maskPhone(digits) { return '+'.concat(digits.length > 10 ? digits.slice(0, digits.length - 10) : '', ' ', '\u2022'.repeat(6), ' ', digits.slice(-2)).replace(/\s+/g, ' '); }
function publicUser(u) { return { id: u.id, phoneMasked: u.phoneMasked }; }
function travellerLabel(u) { return 'Traveller ' + u.phoneMasked.slice(-2); }

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = token && db.sessions[token];
  if (!s) return null;
  const u = db.users[s.userId];
  return u || null;
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 64 * 1024) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
const clean = (v, n) => String(v == null ? '' : v).slice(0, n);

/* ---------- swap-request shaping ---------- */
function shapeFor(r, viewer) {
  const mine = viewer && r.ownerId === viewer.id;
  const party = viewer && (r.ownerId === viewer.id || r.acceptedBy === viewer.id);
  const owner = db.users[r.ownerId];
  const accepter = r.acceptedBy ? db.users[r.acceptedBy] : null;
  const base = {
    id: r.id, journeyKey: r.journeyKey, mode: r.mode,
    seatType: r.seatType, coach: r.coach, want: r.want, note: r.note,
    state: r.state, createdAt: r.createdAt, expiresAt: r.expiresAt,
    by: travellerLabel(owner),
    mine: !!mine,
    acceptedByMe: !!(viewer && r.acceptedBy === viewer.id),
  };
  /* Exact seats stay private until completion, and only between the two
     parties. Listings always show seat TYPE (lower berth, window...) instead. */
  if (mine) base.seat = r.seat;
  if (r.state === 'accepted' || r.state === 'completed') {
    if (mine && accepter) base.acceptedByLabel = travellerLabel(accepter);
    if (party && r.state === 'completed') {
      base.reveal = mine
        ? { yourSeat: r.seat, theirSeat: r.accepterSeat, theirLabel: travellerLabel(accepter) }
        : { yourSeat: r.accepterSeat, theirSeat: r.seat, theirLabel: travellerLabel(owner) };
    }
  }
  return base;
}
function sweepExpired() {
  const now = Date.now();
  let changed = false;
  for (const r of Object.values(db.requests)) {
    if ((r.state === 'open' || r.state === 'accepted') && r.expiresAt < now) { r.state = 'expired'; changed = true; }
  }
  if (changed) save();
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};

  if (url.pathname === '/api/health') return send(res, 200, { ok: true, dev: DEV });

  /* ----- auth ----- */
  if (url.pathname === '/api/auth/request-otp' && req.method === 'POST') {
    const phone = normPhone(body.phone);
    if (!phone) return send(res, 400, { error: 'Enter a valid phone number with country code.' });
    const now = Date.now();
    const rec = otps.get(phone);
    if (rec) {
      if (now - rec.lastSentAt < OTP_RESEND_MS) return send(res, 429, { error: 'Code already sent. Wait half a minute before asking again.', retryAfterSec: Math.ceil((OTP_RESEND_MS - (now - rec.lastSentAt)) / 1000) });
      rec.sentWindow = (rec.sentWindow || []).filter((t) => now - t < OTP_WINDOW_MS);
      if (rec.sentWindow.length >= OTP_MAX_PER_WINDOW) return send(res, 429, { error: 'Too many codes requested. Try again later.' });
    }
    const code = String(crypto.randomInt(100000, 999999));
    const entry = rec || { sentWindow: [] };
    entry.code = code; entry.exp = now + OTP_TTL_MS; entry.attempts = 0; entry.lastSentAt = now;
    entry.sentWindow = [...(entry.sentWindow || []), now];
    otps.set(phone, entry);
    console.log('[otp] code for', maskPhone(phone), '=', code, DEV ? '(dev)' : '');
    const out = { ok: true, phoneMasked: maskPhone(phone), expiresInSec: OTP_TTL_MS / 1000 };
    if (DEV) out.devCode = code;
    return send(res, 200, out);
  }

  if (url.pathname === '/api/auth/verify-otp' && req.method === 'POST') {
    const phone = normPhone(body.phone);
    const code = clean(body.code, 8).replace(/\s+/g, '');
    const rec = phone && otps.get(phone);
    if (!phone || !rec) return send(res, 401, { error: 'Request a code first.' });
    if (rec.exp < Date.now()) { otps.delete(phone); return send(res, 401, { error: 'That code expired. Request a new one.' }); }
    rec.attempts += 1;
    if (rec.attempts > OTP_MAX_ATTEMPTS) { otps.delete(phone); return send(res, 429, { error: 'Too many wrong tries. Request a new code.' }); }
    if (code !== rec.code) return send(res, 401, { error: 'That code does not match.', attemptsLeft: OTP_MAX_ATTEMPTS - rec.attempts });
    otps.delete(phone);
    let user = Object.values(db.users).find((u) => u.phone === phone);
    if (!user) { user = { id: uid('u'), phone, phoneMasked: maskPhone(phone), createdAt: Date.now() }; db.users[user.id] = user; }
    /* session rotation: any previous tokens for this number die now */
    for (const [t, s] of Object.entries(db.sessions)) if (s.userId === user.id) delete db.sessions[t];
    const token = crypto.randomBytes(24).toString('base64url');
    db.sessions[token] = { userId: user.id, createdAt: Date.now() };
    save();
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (url.pathname === '/api/auth/session' && req.method === 'GET') {
    const u = authUser(req);
    if (!u) return send(res, 401, { error: 'not signed in' });
    return send(res, 200, { user: publicUser(u) });
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (token && db.sessions[token]) { delete db.sessions[token]; save(); }
    return send(res, 200, { ok: true });
  }

  /* ----- swap requests ----- */
  if (url.pathname === '/api/swap-requests' && req.method === 'GET') {
    const u = authUser(req);
    if (!u) return send(res, 401, { error: 'sign in to see swap requests' });
    sweepExpired();
    const jk = clean(url.searchParams.get('journeyKey'), 160);
    if (!jk) return send(res, 400, { error: 'journeyKey required' });
    if (process.env.SWAP_DEBUG) {
      console.log('[dbg] jk =', JSON.stringify(jk), 'len', jk.length);
      for (const r of Object.values(db.requests)) console.log('[dbg] stored', JSON.stringify(r.journeyKey), 'len', r.journeyKey.length, 'match', r.journeyKey === jk);
    }
    const list = Object.values(db.requests)
      .filter((r) => r.journeyKey === jk && r.state !== 'cancelled' && r.state !== 'expired')
      .filter((r) => r.ownerId === u.id || r.acceptedBy === u.id || r.state === 'open')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => shapeFor(r, u));
    return send(res, 200, { requests: list });
  }

  if (url.pathname === '/api/swap-requests' && req.method === 'POST') {
    const u = authUser(req);
    if (!u) return send(res, 401, { error: 'sign in to publish a swap request' });
    const jk = clean(body.journeyKey, 160);
    if (!jk) return send(res, 400, { error: 'journeyKey required' });
    const dup = Object.values(db.requests).find((r) => r.journeyKey === jk && r.ownerId === u.id && (r.state === 'open' || r.state === 'accepted'));
    if (dup) return send(res, 409, { error: 'You already have a live request on this journey.', id: dup.id });
    const r = {
      id: uid('r'), journeyKey: jk, mode: clean(body.mode, 12),
      ownerId: u.id,
      seat: clean(body.seat, 12), seatType: clean(body.seatType, 40), coach: clean(body.coach, 8),
      want: Array.isArray(body.want) ? body.want.slice(0, 6).map((w) => clean(w, 40)) : [],
      note: clean(body.note, 280),
      state: 'open', acceptedBy: null, accepterSeat: null,
      createdAt: Date.now(), expiresAt: Date.now() + REQ_TTL_MS,
    };
    db.requests[r.id] = r; save();
    if (process.env.SWAP_DEBUG) console.log('[dbg] stored-now', r.id, 'dbsize', Object.keys(db.requests).length, Date.now());
    return send(res, 200, { request: shapeFor(r, u) });
  }

  const act = url.pathname.match(/^\/api\/swap-requests\/([\w-]+)\/(accept|complete|cancel)$/);
  if (act && req.method === 'POST') {
    const u = authUser(req);
    if (!u) return send(res, 401, { error: 'sign in first' });
    sweepExpired();
    const r = db.requests[act[1]];
    if (!r || r.state === 'cancelled' || r.state === 'expired') return send(res, 404, { error: 'request not found' });

    if (act[2] === 'accept') {
      if (r.ownerId === u.id) return send(res, 403, { error: 'You cannot accept your own request.' });
      if (r.state !== 'open') return send(res, 409, { error: 'Already accepted by someone else.' });
      r.state = 'accepted'; r.acceptedBy = u.id;
      r.accepterSeat = clean(body.seat, 12); r.accepterSeatType = clean(body.seatType, 40); r.accepterCoach = clean(body.coach, 8);
      save();
      return send(res, 200, { request: shapeFor(r, u) });
    }
    if (act[2] === 'complete') {
      if (r.ownerId !== u.id) return send(res, 403, { error: 'Only the traveller who published can complete the swap.' });
      if (r.state !== 'accepted') return send(res, 409, { error: 'Nothing to complete yet.' });
      r.state = 'completed'; r.completedAt = Date.now(); save();
      return send(res, 200, { request: shapeFor(r, u) });
    }
    if (act[2] === 'cancel') {
      if (r.ownerId !== u.id) return send(res, 403, { error: 'Only the owner can cancel.' });
      r.state = 'cancelled'; save();
      return send(res, 200, { ok: true });
    }
  }

  /* ----- M3 exchange module: journeys, matches, quotes, payments, entitlements ----- */
  {
    const handled = await exchange.handle(req, res, url, body, { db, save, send, uid, clean, authUser, travellerLabel });
    if (handled !== false) return;
  }

  return send(res, 404, { error: 'not found' });
}

/* ---------- static ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (process.env.SWAP_DEBUG && url.pathname.includes('swap-requests')) console.log('[dbg] recv', req.method, url.pathname, 'dbsize', Object.keys(db.requests).length, Date.now());
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let p = path.normalize(decodeURIComponent(url.pathname));
    if (p === '/' || p === '\\') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    send(res, e.message === 'bad json' ? 400 : 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, () => console.log('SwapSeat dev server on http://localhost:' + PORT + (DEV ? ' (dev mode: OTP codes returned in responses)' : '')));
