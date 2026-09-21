/* SwapSeat exchange module (M3): train requester flow, server-authoritative.
   Journeys, preferences, privacy-DTO matches, quotes, sandbox payments,
   search activations, exchange requests. Spec: the browser never decides
   payment success, charges, rewards, ownership, disclosure, or acceptance. */
const crypto = require('crypto');
const pricing = require('./pricing.js');
const layouts = require('./layouts.js');

const SERVER_SECRET = process.env.SWAP_EXCHANGE_SECRET || 'dev-only-secret-change-me';

/* Opaque candidate id: stable per (viewer journey, candidate journey), reveals nothing. */
function candidateId(viewerJourneyId, candidateJourneyId) {
  return 'cand_' + crypto.createHmac('sha256', SERVER_SECRET).update(viewerJourneyId + ':' + candidateJourneyId).digest('base64url').slice(0, 16);
}

function maskName(displayName, fallbackLabel) {
  const name = String(displayName || '').trim();
  if (!name) return fallbackLabel;
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase() + parts[0].slice(1) + '.';
  return parts[0][0].toUpperCase() + parts[0].slice(1) + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
}

/* Explainable preference fit. Denominator 100 = sum of factor weights.
   NEVER presented as a probability a swap happens. */
function fitScore(mine, theirs) {
  const mp = mine.preferences || {};
  const tp = theirs.preferences || {};
  const factors = [];
  const myType = mine.berthType;
  const accepted = Array.isArray(mp.acceptTypes) && myType ? mp.acceptTypes.includes(theirs.berthType) : false;
  factors.push({ key: 'berth-type', label: 'Their ' + (layouts.TYPE_LABEL[theirs.berthType] || 'berth') + ' is on your accept list', weight: 50, matched: accepted });
  const coachDelta = Math.abs((parseInt(String(mine.coach).replace(/\D/g, ''), 10) || 0) - (parseInt(String(theirs.coach).replace(/\D/g, ''), 10) || 0));
  factors.push({ key: 'coach', label: coachDelta === 0 ? 'Same coach' : coachDelta === 1 ? 'Adjacent coach' : 'Different coach', weight: 20, matched: coachDelta <= 1 });
  const g1 = mp.genderPref || 'no-preference';
  const g2 = tp.genderPref || 'no-preference';
  const gOk = g1 === 'no-preference' || g2 === 'no-preference' || g1 === g2;
  factors.push({ key: 'gender-pref', label: gOk ? 'Gender preferences compatible' : 'Gender preferences differ', weight: 15, matched: gOk });
  factors.push({ key: 'motivation', label: tp.reason ? 'They shared why they want to move' : 'No reason shared', weight: 15, matched: !!tp.reason });
  const pct = factors.filter(f => f.matched).reduce((s, f) => s + f.weight, 0);
  return { pct, denominator: 100, kind: 'preference-fit', factors };
}

/* Protected candidate DTO: no exact seat, no bay, no user id, no coordinates. */
function candidateDTO(viewerJourney, j, ctx) {
  const owner = ctx.db.users[j.userId] || {};
  return {
    candidateId: candidateId(viewerJourney.id, j.id),
    maskedName: maskName((j.preferences || {}).displayName, ctx.travellerLabel(owner)),
    coarseRegion: { coach: j.coach, berthType: j.berthType, berthTypeLabel: layouts.TYPE_LABEL[j.berthType] || null },
    fit: fitScore(viewerJourney, j),
    searching: !!ctx.db.entitlements[j.userId + ':' + j.serviceKey],
  };
}

function canonicalServiceKey(mode, trainNumber, date) {
  return String(mode || 'TRAIN').toUpperCase() + ':' + String(trainNumber).replace(/\D/g, '') + ':' + String(date);
}

async function handle(req, res, url, body, ctx) {
  const { db, save, send, uid, clean } = ctx;
  const u = ctx.authUser(req);
  const p = url.pathname;

  /* ----- journeys ----- */
  if (p === '/api/journeys' && req.method === 'POST') {
    if (!u) return send(res, 401, { error: 'sign in required' });
    const trainNumber = clean(body.trainNumber, 6).replace(/\D/g, '');
    const date = clean(body.date, 10);
    const boardingIndex = Number(body.boardingIndex), destinationIndex = Number(body.destinationIndex);
    const classCode = clean(body.classCode, 3).toUpperCase();
    const coach = clean(body.coach, 4).toUpperCase();
    const berth = Number(body.berth);
    if (!/^\d{5}$/.test(trainNumber)) return send(res, 400, { error: '5-digit train number required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'journey date (YYYY-MM-DD) required' });
    if (!Number.isInteger(boardingIndex) || !Number.isInteger(destinationIndex) || boardingIndex >= destinationIndex) {
      return send(res, 400, { error: 'boarding stop must come before destination stop' });
    }
    if (!layouts.CLASS_INFO[classCode]) return send(res, 400, { error: 'unsupported class (SL, 3A, 2A, 1A)' });
    if (!coach) return send(res, 400, { error: 'coach required' });
    const bt = layouts.berthType(classCode, berth);
    if (!bt) return send(res, 400, { error: 'valid berth number required' });
    const serviceKey = canonicalServiceKey('TRAIN', trainNumber, date);
    const layout = layouts.resolveLayout(classCode);
    const id = uid('jrn');
    db.journeys[id] = {
      id, userId: u.id, mode: 'TRAIN', trainNumber, date, serviceKey,
      boarding: clean(body.boarding, 40), destination: clean(body.destination, 40),
      boardingIndex, destinationIndex, classCode, coach, berth, berthType: bt,
      layoutConfidence: layout.confidence, layoutSource: layout.source,
      state: 'seated', createdAt: Date.now(), preferences: null,
    };
    save();
    return send(res, 200, { journey: db.journeys[id] });
  }

  if (p === '/api/journeys' && req.method === 'GET') {
    if (!u) return send(res, 401, { error: 'sign in required' });
    return send(res, 200, { journeys: Object.values(db.journeys).filter(j => j.userId === u.id).sort((a, b) => b.createdAt - a.createdAt) });
  }

  const jm = p.match(/^\/api\/journeys\/([\w-]+)(\/map|\/preferences|\/matches|\/activate)?$/);
  if (jm) {
    if (!u) return send(res, 401, { error: 'sign in required' });
    const j = db.journeys[jm[1]];
    if (!j) return send(res, 404, { error: 'journey not found' });
    const sub = jm[2] || '';
    if (sub !== '/matches' && j.userId !== u.id) return send(res, 403, { error: 'not your journey' });

    if (sub === '' && req.method === 'GET') return send(res, 200, { journey: j });

    if (sub === '/map' && req.method === 'GET') {
      return send(res, 200, {
        journeyId: j.id, coach: j.coach, berth: j.berth, berthType: j.berthType,
        classCode: j.classCode, confidence: j.layoutConfidence, source: j.layoutSource,
        layout: layouts.resolveLayout(j.classCode),
      });
    }

    if (sub === '/preferences' && req.method === 'PUT') {
      const acceptTypes = Array.isArray(body.acceptTypes) ? body.acceptTypes.filter(t => layouts.TYPE_LABEL[t]) : [];
      const genderPref = ['no-preference', 'same-gender', 'prefer-not-to-say'].includes(body.genderPref) ? body.genderPref : 'no-preference';
      j.preferences = {
        acceptTypes,
        reason: clean(body.reason, 140),
        genderPref, // stored, NEVER returned in public DTOs
        gender: ['female', 'male', 'other', 'prefer-not-to-say'].includes(body.gender) ? body.gender : undefined,
        displayName: clean(body.displayName, 60), // optional; masked before any sharing
        updatedAt: Date.now(),
      };
      j.state = 'preferences_set';
      save();
      return send(res, 200, { journey: j });
    }

    if (sub === '/matches' && req.method === 'GET') {
      /* MVP eligibility: same canonical service, identical boarding/destination
         stop indexes, compatible class, has own seat, not self. */
      const cands = Object.values(db.journeys).filter(c =>
        c.id !== j.id && c.userId !== u.id &&
        c.serviceKey === j.serviceKey &&
        c.boardingIndex === j.boardingIndex && c.destinationIndex === j.destinationIndex &&
        c.classCode === j.classCode &&
        c.preferences // only opted-in, preference-complete journeys surface
      );
      return send(res, 200, { candidates: cands.map(c => candidateDTO(j, c, ctx)), policy: { exactSeatsHidden: true, reveal: 'exact seats unlock only after mutual agreement and payment rules' } });
    }

    if (sub === '/activate' && req.method === 'POST') {
      const pay = db.payments[clean(body.paymentId, 40)];
      if (!pay || pay.userId !== u.id) return send(res, 404, { error: 'payment not found' });
      if (pay.state !== 'captured') return send(res, 402, { error: 'payment not captured' });
      const q = db.quotes[pay.quoteId];
      if (!q || q.journeyId !== j.id || q.kind !== 'search_activation') return send(res, 400, { error: 'payment does not match this journey activation' });
      const key = u.id + ':' + j.serviceKey;
      if (!db.entitlements[key]) {
        db.entitlements[key] = { userId: u.id, serviceKey: j.serviceKey, source: 'payment', paymentId: pay.id, pricingVersion: q.pricingVersion, active: true, createdAt: Date.now() };
        pay.consumed = true;
        j.state = 'searching';
        save();
      }
      return send(res, 200, { entitlement: db.entitlements[key] });
    }
  }

  /* ----- quotes ----- */
  if (p === '/api/quotes' && req.method === 'POST') {
    if (!u) return send(res, 401, { error: 'sign in required' });
    if (clean(body.kind, 24) !== 'search_activation') return send(res, 400, { error: 'unsupported quote kind' });
    const j = db.journeys[clean(body.journeyId, 40)];
    if (!j || j.userId !== u.id) return send(res, 404, { error: 'journey not found' });
    const market = clean(body.market, 2).toUpperCase() || 'IN';
    if (!pricing.PRICE_BOOKS[market]) return send(res, 400, { error: 'market not supported yet - join the waitlist', waitlist: true });
    const q = pricing.searchActivationQuote({ market, serviceKey: j.serviceKey, journeyId: j.id, userId: u.id });
    const id = uid('quo');
    db.quotes[id] = { ...q, id, createdAt: Date.now() };
    save();
    return send(res, 200, { quote: db.quotes[id], disclosure: pricing.disclosure(market) });
  }

  /* ----- payments (provider abstraction; sandbox only until owner credentials) ----- */
  if (p === '/api/payments/intents' && req.method === 'POST') {
    if (!u) return send(res, 401, { error: 'sign in required' });
    if (pricing.productionBlocked() && pricing.FLAGS.paymentsProvider !== 'sandbox') {
      return send(res, 503, { error: 'payments unavailable: production charges are disabled pending owner approval' });
    }
    const q = db.quotes[clean(body.quoteId, 40)];
    if (!q || q.userId !== u.id) return send(res, 404, { error: 'quote not found' });
    const idem = clean(body.idempotencyKey, 64);
    const existing = Object.values(db.payments).find(x => x.userId === u.id && x.idempotencyKey === idem && idem);
    if (existing) return send(res, 200, { payment: existing, sandbox: true });
    const id = uid('pay');
    db.payments[id] = {
      id, quoteId: q.id, userId: u.id, provider: 'sandbox',
      amountMinor: q.amountMinor, currency: q.currency,
      state: 'captured', // sandbox captures immediately; a real provider goes created->pending->captured via signed webhook
      sandbox: true, idempotencyKey: idem, createdAt: Date.now(),
    };
    save();
    return send(res, 200, { payment: db.payments[id], sandbox: true });
  }

  /* ----- exchange requests ----- */
  if (p === '/api/exchange-requests' && req.method === 'POST') {
    if (!u) return send(res, 401, { error: 'sign in required' });
    const j = db.journeys[clean(body.journeyId, 40)];
    if (!j || j.userId !== u.id) return send(res, 404, { error: 'journey not found' });
    const entKey = u.id + ':' + j.serviceKey;
    if (!db.entitlements[entKey] || !db.entitlements[entKey].active) return send(res, 402, { error: 'search activation required before sending requests' });
    const target = Object.values(db.journeys).find(c => candidateId(j.id, c.id) === clean(body.candidateId, 24));
    if (!target || target.userId === u.id) return send(res, 404, { error: 'candidate not found' });
    if (target.serviceKey !== j.serviceKey) return send(res, 400, { error: 'candidate is on a different service' });
    const dup = Object.values(db.exchangeRequests).find(r => r.requesterJourneyId === j.id && r.accepterJourneyId === target.id && ['pending', 'held', 'payment_due', 'mutually_agreed'].includes(r.state));
    if (dup) return send(res, 200, { request: shapeRequest(dup, u, ctx) });
    const id = uid('xrq');
    db.exchangeRequests[id] = {
      id, serviceKey: j.serviceKey,
      requesterId: u.id, requesterJourneyId: j.id,
      accepterId: target.userId, accepterJourneyId: target.id,
      state: 'pending', createdAt: Date.now(),
      events: [{ at: Date.now(), type: 'created' }],
    };
    save();
    return send(res, 200, { request: shapeRequest(db.exchangeRequests[id], u, ctx) });
  }

  if (p === '/api/exchange-requests' && req.method === 'GET') {
    if (!u) return send(res, 401, { error: 'sign in required' });
    const mine = Object.values(db.exchangeRequests).filter(r => r.requesterId === u.id || r.accepterId === u.id);
    return send(res, 200, { requests: mine.map(r => shapeRequest(r, u, ctx)).sort((a, b) => b.createdAt - a.createdAt) });
  }

  return false; // not handled here
}

function shapeRequest(r, viewer, ctx) {
  const mine = viewer && r.requesterId === viewer.id;
  const party = mine || (viewer && r.accepterId === viewer.id);
  const rj = ctx.db.journeys[r.requesterJourneyId] || {};
  const aj = ctx.db.journeys[r.accepterJourneyId] || {};
  const base = {
    id: r.id, state: r.state, createdAt: r.createdAt, serviceKey: r.serviceKey,
    role: mine ? 'requester' : 'accepter',
    counterpart: mine ? maskName((aj.preferences || {}).displayName, ctx.travellerLabel(ctx.db.users[r.accepterId] || {}))
                      : maskName((rj.preferences || {}).displayName, ctx.travellerLabel(ctx.db.users[r.requesterId] || {})),
  };
  /* Exact seats stay hidden until mutual agreement + payment rules (M4 enforces). */
  if (party && r.state === 'mutually_agreed') {
    base.reveal = mine ? { yourSeat: rj.berth, theirSeat: aj.berth, theirCoach: aj.coach }
                       : { yourSeat: aj.berth, theirSeat: rj.berth, theirCoach: rj.coach };
  }
  return base;
}

module.exports = { handle, candidateId, fitScore, maskName, canonicalServiceKey };
