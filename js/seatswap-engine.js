/* SeatSwap engine — real state machines (docs/03-STATE-MACHINES.md).
   Request: draft>searching>accepted_awaiting_payment>locked>confirmed|voided|disputed (+withdrawn/expired)
   Offer: sent>accepted|declined|expired (+superseded)   Payment: created>pending>paid|failed
   Money outcomes enforced exactly; credit in paise, oldest-first, 12-month expiry.
   Storage: localStorage (shape mirrors Postgres tables in supabase/schema-steps-1-2.sql).
   Every transition writes activity_log. */
const SeatSwapEngine = (() => {
  const DB = 'seatswap_db_v1';
  const ME = 'seatswap_me_v1';
  const blank = () => ({
    users: {}, requests: {}, offers: {}, payments: {}, receipts: {}, wallet: [],
    confirms: {}, disputes: {}, chats: {}, messages: {}, reports: {}, blocks: [],
    notifs: {}, activity: [], invites: {}, groups: {}, group_members: {}, ratings: {},
    counters: { receipt: 10482, invite: 1000 }, backouts: [], sentDay: {},
  });
  function db() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(DB) || '{}')); }
    catch { return blank(); }
  }
  function save(d) { try { localStorage.setItem(DB, JSON.stringify(d)); } catch {} }
  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const C = (typeof SeatSwapConfig !== 'undefined' ? SeatSwapConfig : { PRICE_PAISE: 9900, FEE_PAISE: 4900, CREDIT_PAISE: 5000, CREDIT_MONTHS: 12, MAX_OUT_PER_DAY: 10 });

  function log(d, action, meta) {
    d.activity.unshift(Object.assign({ id: uid('a'), actor: meId(), actor_role: 'user', action, entity: null, entity_id: null, meta: {}, created_at: now() }, meta || { action }));
    d.activity = d.activity.slice(0, 500);
  }

  /* ---------- identity ---------- */
  function meId() { try { return localStorage.getItem(ME) || null; } catch { return null; } }
  function me() { const d = db(); const id = meId(); return id ? (d.users[id] || null) : null; }
  function authed() { const m = me(); return !!(m && m.authed); }
  function signIn(profile) {
    const d = db();
    const id = 'u-' + (profile.sub || Date.now().toString(36));
    d.users[id] = { id, first_name: profile.first_name, last_initial: profile.last_initial || '', authed: profile.via || 'demo', created_at: now() };
    save(d);
    try { localStorage.setItem(ME, id); } catch {}
    if (typeof SeatSwapStore !== 'undefined') {
      SeatSwapStore.attachToAccount(id);
      log(db(), 'sign_in', { entity: 'user', entity_id: id });
    }
    return d.users[id];
  }
  function signOut() { try { localStorage.removeItem(ME); } catch {} }

  /* ---------- notifications (in-app Updates; push plugs in with VAPID+server) ---------- */
  function notify(d, userId, kind, title, body, link) {
    if (!userId) return;
    const n = { id: uid('n'), user_id: userId, kind, title, body, link: link || null, read_at: null, created_at: now() };
    d.notifs[n.id] = n;
  }
  function myNotifs() {
    const d = db(); const id = meId();
    return Object.values(d.notifs).filter((n) => n.user_id === id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  function markRead(notifId) {
    const d = db();
    if (d.notifs[notifId]) { d.notifs[notifId].read_at = now(); save(d); }
  }

  /* ---------- wallet (paise; balance = unexpired sum) ---------- */
  function balance(d, userId) {
    const t = Date.now();
    return d.wallet.filter((w) => w.user_id === userId && new Date(w.expires_at).getTime() > t)
      .reduce((a, w) => a + w.amount_paise, 0);
  }
  function myBalance() { return balance(db(), meId()); }
  function addCredit(d, userId, amount, kind, refId, action) {
    const exp = new Date(Date.now() + (C.CREDIT_MONTHS || 12) * 30.44 * 864e5).toISOString();
    const tx = { id: uid('w'), user_id: userId, amount_paise: amount, kind, ref_request_id: refId || null, expires_at: amount > 0 ? exp : now(), created_at: now() };
    d.wallet.push(tx);
    log(d, action || 'credit_added', { entity: 'wallet', entity_id: tx.id, user_id: userId, amount_paise: amount, kind });
    return tx;
  }
  function consumeCredit(d, userId, need) {
    // oldest-first (earliest expiry first); returns {used, txIds}
    const t = Date.now();
    const avail = d.wallet.filter((w) => w.user_id === userId && w.amount_paise > 0 && new Date(w.expires_at).getTime() > t)
      .sort((a, b) => (a.expires_at < b.expires_at ? -1 : 1));
    let left = need; const used = [];
    for (const w of avail) {
      if (left <= 0) break;
      const take = Math.min(left, w.amount_paise);
      w.amount_paise -= take; left -= take; used.push(w.id);
    }
    if (left > 0) throw new Error('insufficient_credit');
    d.wallet.push({ id: uid('w'), user_id: userId, amount_paise: -need, kind: 'used', ref_request_id: null, expires_at: now(), created_at: now() });
    log(d, 'credit_used', { user_id: userId, amount_paise: need });
    return { used_paise: need };
  }

  /* ---------- requests ---------- */
  function tripOf(tripId) {
    const t = (typeof SeatSwapStore !== 'undefined' ? SeatSwapStore.get(tripId) : null);
    if (!t) throw new Error('trip_missing');
    return t;
  }
  function newRequest(input) {
    if (!authed()) throw new Error('auth_required');
    const trip = tripOf(input.tripId);
    if ((trip.passengers[0] || {}).status === 'CAN') throw new Error('trip_cancelled');
    const d = db();
    const r = {
      id: uid('r'), requester_id: meId(), booking_id: trip.id,
      passenger_ids: (trip.passengers || []).filter((p) => !p.is_child_no_berth).map((p) => p.id || p.label),
      group_id: input.groupId || null,
      choices: (input.choices || []).filter(Boolean).slice(0, 3),
      same_coach: !!input.sameCoach, keep_together: !!input.keepTogether,
      reason: String(input.reason || '').slice(0, 280),
      status: 'searching', locked_offer_id: null, paused: false,
      created_at: now(), updated_at: now(),
    };
    if (!r.choices.length) throw new Error('choices_required');
    d.requests[r.id] = r;
    notify(d, r.requester_id, 'request_sent', 'Request live', 'Sending is free. You pay only if someone says yes.', '#/request/' + r.id);
    log(d, 'request_sent', { entity: 'request', entity_id: r.id, choices: r.choices });
    save(d);
    return r;
  }
  function getRequest(id) { const r = db().requests[id]; if (!r) throw new Error('request_missing'); return r; }
  function myRequests() {
    const d = db(); const id = meId();
    return Object.values(d.requests).filter((r) => r.requester_id === id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  function incomingForMe() {
    // offers on others' requests where I am the acceptor (real multi-user comes with backend;
    // demo seeds act through the demo brain; direct incoming appear via shared links)
    const d = db(); const id = meId();
    return Object.values(d.offers).filter((o) => o.acceptor_id === id && o.status === 'sent');
  }
  function updateRequest(id, patch) {
    const d = db(); const r = d.requests[id];
    if (!r || r.requester_id !== meId()) throw new Error('not_yours');
    if (!['searching', 'accepted_awaiting_payment'].includes(r.status)) throw new Error('locked_state');
    if (patch.choices) r.choices = patch.choices.filter(Boolean).slice(0, 3);
    if (patch.sameCoach != null) r.same_coach = !!patch.sameCoach;
    if (patch.keepTogether != null) r.keep_together = !!patch.keepTogether;
    if (patch.reason != null) r.reason = String(patch.reason).slice(0, 280);
    if (patch.paused != null) r.paused = !!patch.paused;
    r.updated_at = now();
    log(d, 'request_updated', { entity: 'request', entity_id: id });
    save(d);
    return r;
  }
  function withdrawRequest(id) {
    const d = db(); const r = d.requests[id];
    if (!r || r.requester_id !== meId()) throw new Error('not_yours');
    if (!['searching', 'accepted_awaiting_payment'].includes(r.status)) throw new Error('locked_state');
    r.status = 'withdrawn'; r.updated_at = now();
    Object.values(d.offers).filter((o) => o.request_id === id && ['sent', 'accepted'].includes(o.status))
      .forEach((o) => { o.status = 'expired'; o.responded_at = now(); });
    log(d, 'request_withdrawn', { entity: 'request', entity_id: id });
    save(d);
    return r;
  }

  /* ---------- offers ---------- */
  function sendOffers(reqId, acceptorIds) {
    if (!authed()) throw new Error('auth_required');
    const d = db(); const r = d.requests[reqId];
    if (!r || r.requester_id !== meId()) throw new Error('not_yours');
    if (r.status !== 'searching') throw new Error('not_searching');
    const day = new Date().toISOString().slice(0, 10);
    const key = meId() + ':' + day;
    const used = (d.sentDay[key] || 0) + acceptorIds.length;
    if (used > (C.MAX_OUT_PER_DAY || 10)) throw new Error('daily_limit');
    const made = [];
    for (const aid of acceptorIds) {
      const dup = Object.values(d.offers).find((o) => o.request_id === reqId && o.acceptor_id === aid && ['sent', 'accepted'].includes(o.status));
      if (dup) continue;
      const o = { id: uid('o'), request_id: reqId, acceptor_id: aid, acceptor_booking_id: null, acceptor_passenger_id: null, matched_choice_rank: 0, status: 'sent', created_at: now(), responded_at: null };
      d.offers[o.id] = o; made.push(o);
      if (!String(aid).startsWith('seed:')) notify(d, aid, 'new_request', 'New swap request', 'Someone on your train wants to swap. You pay nothing.', '#/incoming/' + o.id);
    }
    d.sentDay[key] = used;
    log(d, 'offers_sent', { entity: 'request', entity_id: reqId, count: made.length });
    save(d);
    return made;
  }
  function getOffer(id) { const o = db().offers[id]; if (!o) throw new Error('offer_missing'); return o; }
  function offersFor(reqId) {
    return Object.values(db().offers).filter((o) => o.request_id === reqId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  function setOfferRank(offerId, rank) {
    const d = db();
    if (d.offers[offerId]) { d.offers[offerId].matched_choice_rank = rank; save(d); }
  }
  function acceptOffer(offerId, byId) {
    const d = db(); const o = d.offers[offerId];
    if (!o || o.status !== 'sent') throw new Error('offer_closed');
    const who = byId || meId();
    if (String(o.acceptor_id).startsWith('seed:') && !byId) {
      // demo brain acts for seeds (logged as seed action)
    } else if (o.acceptor_id !== who) throw new Error('not_yours');
    o.status = 'accepted'; o.responded_at = now();
    const r = d.requests[o.request_id];
    if (r.status === 'searching') {
      r.status = 'accepted_awaiting_payment'; r.updated_at = now();
      notify(d, r.requester_id, 'someone_accepted', 'Someone said yes! Pay ₹99', 'The swap locks once you pay. Until then, your other matches can still accept.', '#/pay/' + r.id);
      log(d, 'offer_accepted', { entity: 'offer', entity_id: offerId });
    } else {
      log(d, 'offer_accepted_late', { entity: 'offer', entity_id: offerId });
    }
    save(d);
    return o;
  }
  function declineOffer(offerId, byId) {
    const d = db(); const o = d.offers[offerId];
    if (!o) throw new Error('offer_missing');
    o.status = 'declined'; o.responded_at = now();
    log(d, 'offer_declined', { entity: 'offer', entity_id: offerId });
    save(d);
    return o;
  }
  function backOutOffer(offerId, byId) {
    // acceptor backs out before payment -> offer expired; request back to searching if it waited on this offer
    const d = db(); const o = d.offers[offerId];
    if (!o) throw new Error('offer_missing');
    o.status = 'expired'; o.responded_at = now();
    const r = d.requests[o.request_id];
    const other = Object.values(d.offers).some((x) => x.request_id === r.id && x.status === 'accepted');
    if (r.status === 'accepted_awaiting_payment' && !other) { r.status = 'searching'; r.updated_at = now(); }
    d.backouts.push({ user: byId || o.acceptor_id, at: now() });
    log(d, 'offer_backout', { entity: 'offer', entity_id: offerId });
    save(d);
    return o;
  }
  function backedOut30d(userId) {
    const t = Date.now() - 30 * 864e5;
    return db().backouts.filter((b) => b.user === userId && new Date(b.at).getTime() > t).length;
  }

  /* ---------- payments ---------- */
  function createPayment(reqId, opts) {
    if (!authed()) throw new Error('auth_required');
    const o = opts || {};
    const d = db(); const r = d.requests[reqId];
    if (!r || r.requester_id !== meId()) throw new Error('not_yours');
    if (r.status !== 'accepted_awaiting_payment') throw new Error('not_awaiting_payment');
    const price = r.group_id ? (C.GROUP_PRICE_PAISE || 19900) : (C.PRICE_PAISE || 9900);
    let creditUsed = 0;
    if (o.useCredit !== false) {
      const avail = balance(d, meId());
      creditUsed = Math.min(avail, price);
      if (creditUsed > 0) consumeCredit(d, meId(), creditUsed);
    }
    const due = price - creditUsed;
    const provider = due <= 0 ? 'credit' : (o.provider || 'demo');
    const p = {
      id: uid('p'), request_id: reqId, payer_id: meId(), provider,
      provider_ref: null, amount_paise: price, credit_used_paise: creditUsed,
      currency: 'INR', status: due <= 0 ? 'paid' : 'created', created_at: now(),
    };
    d.payments[p.id] = p;
    log(d, 'payment_created', { entity: 'payment', entity_id: p.id, provider, amount_paise: price });
    if (due <= 0) {
      settlePaid(d, r, p, 'credit:' + p.id);
    }
    save(d);
    return p;
  }
  function gatewayResult(paymentId, outcome, ref) {
    const d = db(); const p = d.payments[paymentId];
    if (!p) throw new Error('payment_missing');
    const r = d.requests[p.request_id];
    if (outcome === 'paid') {
      if (p.status === 'paid') return p;
      p.status = 'paid'; p.provider_ref = ref || p.provider_ref || ('demo_' + Date.now().toString(36));
      settlePaid(d, r, p, p.provider_ref);
    } else if (outcome === 'pending') {
      p.status = 'pending';
      log(d, 'payment_pending', { entity: 'payment', entity_id: p.id });
    } else {
      p.status = 'failed';
      log(d, 'payment_failed', { entity: 'payment', entity_id: p.id });
    }
    save(d);
    return p;
  }
  function settlePaid(d, r, p, ref) {
    p.status = 'paid';
    if (!p.provider_ref) p.provider_ref = ref;
    // receipt
    d.counters.receipt += 1;
    const rc = { id: uid('rc'), payment_id: p.id, number: 'SS-' + d.counters.receipt, created_at: now() };
    d.receipts[rc.id] = rc;
    // lock (first paid wins; webhook/source-of-truth ordering = call order)
    if (r.status !== 'locked') {
      r.status = 'locked'; r.updated_at = now();
      const accepted = Object.values(d.offers).filter((x) => x.request_id === r.id && x.status === 'accepted');
      const winner = accepted[0] || null;
      if (winner) r.locked_offer_id = winner.id;
      for (const x of Object.values(d.offers)) {
        if (x.request_id === r.id && x.id !== (winner && winner.id) && ['sent', 'accepted'].includes(x.status)) {
          x.status = 'superseded'; x.responded_at = now();
          if (!String(x.acceptor_id).startsWith('seed:')) notify(d, x.acceptor_id, 'superseded', 'Someone else was faster', "You're still open to swap.", '#/swaps');
        }
      }
      // chat
      const chat = { id: uid('c'), request_id: r.id, created_at: now() };
      d.chats[chat.id] = chat;
      notify(d, r.requester_id, 'payment_done', 'Payment successful', 'Berth numbers revealed. Chat is open.', '#/swaps/' + r.id);
      if (winner && !String(winner.acceptor_id).startsWith('seed:')) notify(d, winner.acceptor_id, 'payment_done', 'Swap locked', 'Berth numbers revealed. Chat is open.', '#/swaps/' + r.id);
      log(d, 'payment_paid', { entity: 'payment', entity_id: p.id, provider_ref: p.provider_ref });
      log(d, 'swap_locked', { entity: 'request', entity_id: r.id });
    }
  }
  function paymentsFor(reqId) {
    return Object.values(db().payments).filter((p) => p.request_id === reqId);
  }
  function receiptFor(paymentId) {
    return Object.values(db().receipts).find((r) => r.payment_id === paymentId) || null;
  }

  /* ---------- chat ---------- */
  function chatFor(reqId) {
    const d = db();
    let c = Object.values(d.chats).find((x) => x.request_id === reqId);
    if (!c) { c = { id: uid('c'), request_id: reqId, created_at: now() }; d.chats[c.id] = c; save(d); }
    return c;
  }
  const RISKY = [/upi/i, /\d{10}/, /pay\s*me/i, /cash/i, /sell/i, /gpay|phonepe|paytm/i, /@\w+/, /\+\d{2}/];
  function postMessage(chatId, senderId, senderName, text) {
    const d = db();
    const clean = String(text || '').slice(0, 500);
    if (!clean.trim()) throw new Error('empty_message');
    const flagged = RISKY.some((re) => re.test(clean));
    const m = { id: uid('m'), chat_id: chatId, sender_id: senderId, sender_name: senderName, text: clean, flagged_risky: flagged, created_at: now() };
    d.messages[m.id] = m;
    if (flagged) log(d, 'message_flagged', { entity: 'chat', entity_id: chatId });
    else log(d, 'message_sent', { entity: 'chat', entity_id: chatId });
    save(d);
    return m;
  }
  function messagesFor(chatId) {
    return Object.values(db().messages).filter((m) => m.chat_id === chatId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  }
  function reportBlock(reporterId, reportedId, reqId, reason) {
    const d = db();
    const rep = { id: uid('rep'), reporter_id: reporterId, reported_id: reportedId, request_id: reqId || null, reason: String(reason || '').slice(0, 280), status: 'open', created_at: now() };
    d.reports[rep.id] = rep;
    if (reportedId && !d.blocks.find((b) => b.blocker === reporterId && b.blocked === reportedId)) {
      d.blocks.push({ blocker: reporterId, blocked: reportedId, created_at: now() });
      log(d, 'user_blocked', { entity: 'report', entity_id: rep.id });
    }
    log(d, 'report_created', { entity: 'report', entity_id: rep.id });
    save(d);
    return rep;
  }
  function blockedIds(userId) {
    const d = db();
    return d.blocks.filter((b) => b.blocker === userId).map((b) => b.blocked);
  }

  /* ---------- meet + outcomes ---------- */
  function setMet(reqId, userId, met) {
    const d = db(); const r = d.requests[reqId];
    if (!r || r.status !== 'locked') throw new Error('not_locked');
    r.met_by = r.met_by || {};
    r.met_by[userId] = !!met;
    log(d, met ? 'met_confirmed' : 'met_denied', { entity: 'request', entity_id: reqId });
    save(d);
    return r;
  }
  function submitOutcome(reqId, userId, outcome) {
    // outcome: swapped | no_show | not_possible | changed_mind
    const d = db(); const r = d.requests[reqId];
    if (!r || !['locked', 'disputed'].includes(r.status)) throw new Error('not_locked');
    d.confirms[reqId] = d.confirms[reqId] || {};
    d.confirms[reqId][userId] = { outcome, created_at: now() };
    log(d, 'confirmation', { entity: 'request', entity_id: reqId, outcome });
    const answers = d.confirms[reqId];
    const ids = Object.keys(answers);
    const offer = r.locked_offer_id ? d.offers[r.locked_offer_id] : null;
    const acceptorId = offer ? offer.acceptor_id : null;
    if (ids.length >= 2 || (ids.length === 1 && r.status === 'disputed')) {
      const vals = ids.map((k) => answers[k].outcome);
      if (vals.every((v) => v === 'swapped')) {
        return finalizeConfirmed(d, r, acceptorId);
      }
      if (vals.every((v) => v === vals[0]) && vals[0] !== 'swapped') {
        return finalizeVoided(d, r, 'agreed_' + vals[0]);
      }
      r.status = 'disputed'; r.updated_at = now();
      d.disputes[r.id] = { id: uid('d'), request_id: r.id, status: 'open', resolution: null, admin_id: null, created_at: now() };
      notify(d, r.requester_id, 'dispute', 'Answers don’t match', 'We’ll look at both sides and reply as soon as we can. Your money is held safely meanwhile.', '#/swaps/' + r.id);
      log(d, 'dispute_opened', { entity: 'request', entity_id: r.id });
    } else {
      notify(d, r.requester_id, 'confirm_ask', 'Did you swap?', 'Your answer is saved. Waiting for the other side.', '#/swaps/' + r.id + '/confirm');
    }
    save(d);
    return r;
  }
  function finalizeConfirmed(d, r, acceptorId) {
    r.status = 'confirmed'; r.updated_at = now();
    if (acceptorId && !String(acceptorId).startsWith('seed:')) {
      addCredit(d, acceptorId, C.CREDIT_PAISE || 5000, 'acceptor_credit', r.id, 'credit_added');
      notify(d, acceptorId, 'credit', 'You earned ₹50 credit', 'Thanks for helping.', '#/swaps/' + r.id + '/done');
    } else if (acceptorId) {
      log(d, 'credit_added', { entity: 'request', entity_id: r.id, note: 'seed acceptor (demo)' });
    }
    notify(d, r.requester_id, 'swapped', 'You swapped', 'Share your trip card or add another trip.', '#/swaps/' + r.id + '/done');
    log(d, 'swap_confirmed', { entity: 'request', entity_id: r.id });
    save(d);
    return r;
  }
  function finalizeVoided(d, r, why) {
    r.status = 'voided'; r.updated_at = now();
    addCredit(d, r.requester_id, C.PRICE_PAISE || 9900, 'swap_to_credit', r.id, 'swap_to_credit');
    notify(d, r.requester_id, 'to_credit', '₹99 added to your credit', 'Valid for 12 months · never cash.', '#/swaps/' + r.id);
    log(d, 'swap_voided', { entity: 'request', entity_id: r.id, why });
    save(d);
    return r;
  }
  function cancelSwap(reqId, byId) {
    const d = db(); const r = d.requests[reqId];
    if (!r || r.status !== 'locked') throw new Error('not_locked');
    const offer = r.locked_offer_id ? d.offers[r.locked_offer_id] : null;
    const acceptorId = offer ? offer.acceptor_id : null;
    if (byId && acceptorId && String(acceptorId).startsWith('seed:') === false && byId !== r.requester_id && byId !== acceptorId) throw new Error('not_party');
    if (acceptorId && byId === acceptorId) d.backouts.push({ user: acceptorId, at: now() });
    const out = finalizeVoided(d, r, 'cancelled_by_' + (byId === r.requester_id ? 'requester' : 'acceptor'));
    if (byId === acceptorId && !String(r.requester_id).startsWith('seed:')) {
      notify(d, r.requester_id, 'partner_cancelled', 'They can’t swap now', '₹99 added to your credit. Other matches are still open.', '#/swaps/' + r.id);
    }
    return out;
  }
  function autoConfirmSweep() {
    // locked, journey ended +12h, exactly one 'swapped' answer -> treated as confirmed
    const d = db(); let n = 0;
    for (const r of Object.values(d.requests)) {
      if (r.status !== 'locked') continue;
      const trip = (typeof SeatSwapStore !== 'undefined' ? SeatSwapStore.trips().find((t) => t.id === r.booking_id) : null);
      if (!trip || !trip.journey_date) continue;
      if (Date.now() < new Date(trip.journey_date + 'T00:00:00').getTime() + 36e5) continue;
      const a = d.confirms[r.id] || {};
      const ids = Object.keys(a);
      if (ids.length === 1 && a[ids[0]].outcome === 'swapped') {
        const offer = r.locked_offer_id ? d.offers[r.locked_offer_id] : null;
        finalizeConfirmed(d, r, offer ? offer.acceptor_id : null);
        n++;
      }
    }
    return n;
  }
  function expireSweep() {
    // journey ended + searching -> expired (nothing charged); expired credit stays (balance ignores it)
    const d = db(); let n = 0;
    for (const r of Object.values(d.requests)) {
      if (!['searching', 'accepted_awaiting_payment'].includes(r.status)) continue;
      const trip = (typeof SeatSwapStore !== 'undefined' ? SeatSwapStore.trips().find((t) => t.id === r.booking_id) : null);
      if (!trip || !trip.journey_date) continue;
      if (Date.now() > new Date(trip.journey_date + 'T00:00:00').getTime() + 864e5) {
        r.status = 'expired'; r.updated_at = now();
        notify(d, r.requester_id, 'expired', 'Request expired', 'Nobody accepted before the journey ended. Nothing was charged.', '#/swaps');
        log(d, 'request_expired', { entity: 'request', entity_id: r.id });
        n++;
      }
    }
    if (n) save(d);
    return n;
  }

  /* ---------- disputes + admin ---------- */
  function resolveDispute(reqId, adminId, decision, note) {
    const d = db(); const r = d.requests[reqId];
    if (!r || r.status !== 'disputed') throw new Error('not_disputed');
    const disp = d.disputes[reqId];
    const offer = r.locked_offer_id ? d.offers[r.locked_offer_id] : null;
    disp.status = 'resolved'; disp.resolution = decision; disp.admin_id = adminId;
    log(d, 'dispute_resolved', { entity: 'request', entity_id: reqId, decision, note: note || '' });
    if (decision === 'confirmed') return finalizeConfirmed(d, r, offer ? offer.acceptor_id : null);
    return finalizeVoided(d, r, 'dispute_' + decision);
  }
  function isAdmin() {
    try { return localStorage.getItem('seatswap_admin_v1') === '1'; } catch { return false; }
  }
  function setAdmin(on) { try { localStorage.setItem('seatswap_admin_v1', on ? '1' : '0'); } catch {} }
  function adminAdjust(userId, amountPaise, reason) {
    const d = db();
    addCredit(d, userId, amountPaise, 'admin_adjust', null, 'admin_action');
    d.activity[0].meta.reason = String(reason || '').slice(0, 280);
    save(d);
  }
  function moveToCredit(reqId, adminId) {
    const d = db(); const r = d.requests[reqId];
    if (!r) throw new Error('request_missing');
    log(d, 'admin_action', { entity: 'request', entity_id: reqId, action_detail: 'move_to_credit', admin: adminId });
    return finalizeVoided(d, r, 'admin_move_to_credit');
  }
  function markDone(reqId, adminId) {
    const d = db(); const r = d.requests[reqId];
    if (!r) throw new Error('request_missing');
    const offer = r.locked_offer_id ? d.offers[r.locked_offer_id] : null;
    log(d, 'admin_action', { entity: 'request', entity_id: reqId, action_detail: 'mark_done', admin: adminId });
    return finalizeConfirmed(d, r, offer ? offer.acceptor_id : null);
  }
  function closeReport(reportId, adminId, block) {
    const d = db(); const rep = d.reports[reportId];
    if (!rep) throw new Error('report_missing');
    rep.status = 'closed';
    log(d, 'admin_action', { entity: 'report', entity_id: reportId, action_detail: block ? 'close+block' : 'close', admin: adminId });
    save(d);
  }
  function rateSwap(reqId, byId, stars, targetId) {
    const d = db();
    d.ratings[reqId + ':' + byId] = { request_id: reqId, by: byId, target: targetId, stars: Math.max(1, Math.min(5, stars)), created_at: now() };
    log(d, 'rated', { entity: 'request', entity_id: reqId, stars });
    save(d);
  }

  /* ---------- groups ---------- */
  function newGroup(name) {
    if (!authed()) throw new Error('auth_required');
    const d = db();
    const g = { id: uid('g'), organiser_id: meId(), name: String(name || 'Family trip').slice(0, 60), created_at: now() };
    d.groups[g.id] = g;
    log(d, 'group_created', { entity: 'group', entity_id: g.id });
    save(d);
    return g;
  }
  function addGroupMember(groupId, tripId) {
    const d = db(); const g = d.groups[groupId];
    if (!g || g.organiser_id !== meId()) throw new Error('not_yours');
    tripOf(tripId);
    d.group_members[groupId] = d.group_members[groupId] || [];
    if (!d.group_members[groupId].includes(tripId)) d.group_members[groupId].push(tripId);
    log(d, 'group_member_added', { entity: 'group', entity_id: groupId });
    save(d);
    return g;
  }
  function myGroups() {
    const d = db(); const id = meId();
    return Object.values(d.groups).filter((g) => g.organiser_id === id);
  }
  function groupTrips(groupId) {
    const d = db();
    const ids = d.group_members[groupId] || [];
    const all = (typeof SeatSwapStore !== 'undefined' ? SeatSwapStore.trips() : []);
    return ids.map((i) => all.find((t) => t.id === i)).filter(Boolean);
  }

  /* ---------- invites (share links) ---------- */
  function createInvite(type, refId, meta) {
    const d = db();
    d.counters.invite += 1;
    const code = 'ss' + d.counters.invite.toString(36) + Math.random().toString(36).slice(2, 5);
    d.invites[code] = { code, type, ref_id: refId, meta: meta || {}, created_at: now() };
    log(d, 'invite_created', { entity: 'invite', entity_id: code });
    save(d);
    return code;
  }
  function resolveInvite(code) {
    const inv = db().invites[code];
    if (!inv) throw new Error('invite_missing');
    return inv;
  }

  function activityList(filter) {
    let a = db().activity;
    if (filter && filter.action) a = a.filter((x) => x.action === filter.action);
    if (filter && filter.q) {
      const q = filter.q.toLowerCase();
      a = a.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
    }
    return a.slice(0, 200);
  }

  return {
    me, meId, authed, signIn, signOut,
    notify, myNotifs, markRead,
    myBalance, addCredit, consumeCredit, balance,
    newRequest, getRequest, myRequests, incomingForMe, updateRequest, withdrawRequest,
    sendOffers, getOffer, offersFor, setOfferRank, acceptOffer, declineOffer, backOutOffer, backedOut30d,
    createPayment, gatewayResult, paymentsFor, receiptFor,
    chatFor, postMessage, messagesFor, reportBlock, blockedIds,
    setMet, submitOutcome, cancelSwap, autoConfirmSweep, expireSweep,
    resolveDispute, isAdmin, setAdmin, adminAdjust, moveToCredit, markDone, closeReport, rateSwap,
    newGroup, addGroupMember, myGroups, groupTrips,
    createInvite, resolveInvite, activityList, db,
  };
})();
