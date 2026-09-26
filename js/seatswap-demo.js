/* SeatSwap demo brain — clearly-labeled on-device simulation so the full
   loop (send > accept > pay > lock > chat > meet > confirm > credit) works
   end-to-end before the backend lands. Every simulated action is logged in
   activity_log with actor_role 'demo'. Disable with SeatSwapConfig.demo=false. */
const SeatSwapDemo = (() => {
  const C = (typeof SeatSwapConfig !== 'undefined' ? SeatSwapConfig : { demo: true });
  const timers = {};
  const later = (key, ms, fn) => {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => { try { fn(); } catch (e) { console.warn('[demo]', e.message); } }, ms);
  };
  const on = () => C.demo !== false;

  function seedsForTrip(tripId) {
    const t = SeatSwapStore.get(tripId);
    if (!t) return [];
    return SeatSwapData.seedsFor(t);
  }

  /* After offers are sent, the top match accepts after a short delay. */
  function onOffersSent(reqId) {
    if (!on()) return;
    later('accept:' + reqId, 22000, () => {
      const offers = SeatSwapEngine.offersFor(reqId).filter((o) => o.status === 'sent');
      if (!offers.length) return;
      const req = SeatSwapEngine.getRequest(reqId);
      if (req.status !== 'searching') return;
      const first = offers[0];
      SeatSwapEngine.acceptOffer(first.id, first.acceptor_id);
      const d = SeatSwapEngine.db();
      d.activity.unshift({ id: 'a-demo', actor: first.acceptor_id, actor_role: 'demo', action: 'offer_accepted', entity: 'offer', entity_id: first.id, meta: {}, created_at: new Date().toISOString() });
      try { localStorage.setItem('seatswap_db_v1', JSON.stringify(d)); } catch {}
      rerender();
    });
  }

  /* Seeded chat partner replies + mirrors confirmations. */
  function onUserMessage(reqId, text) {
    if (!on()) return;
    later('reply:' + reqId, 12000, () => {
      const req = SeatSwapEngine.getRequest(reqId);
      if (req.status !== 'locked') return;
      const chat = SeatSwapEngine.chatFor(reqId);
      const offer = req.locked_offer_id ? SeatSwapEngine.getOffer(req.locked_offer_id) : null;
      const name = offer ? seedName(offer.acceptor_id, req.booking_id) : 'Helper';
      const low = String(text || '').toLowerCase();
      let reply = 'Great, see you on board!';
      if (/where|coach|berth|meet/.test(low)) reply = 'I’m at my berth now. Meet me near the coach door?';
      else if (/thank/.test(low)) reply = 'Happy to help. Safe journey!';
      else if (/time|when/.test(low)) reply = 'I’ll come over after the next stop.';
      SeatSwapEngine.postMessage(chat.id, 'seed', name, reply);
      SeatSwapEngine.notify(SeatSwapEngine.db(), req.requester_id, 'partner_msg', name + ' replied', reply, '#/chat/' + chat.id);
      rerender();
    });
  }
  function onUserOutcome(reqId, outcome) {
    if (!on()) return;
    later('mirror:' + reqId, 18000, () => {
      const req = SeatSwapEngine.getRequest(reqId);
      if (!['locked', 'disputed'].includes(req.status)) return;
      const offer = req.locked_offer_id ? SeatSwapEngine.getOffer(req.locked_offer_id) : null;
      if (!offer || !String(offer.acceptor_id).startsWith('seed:')) return;
      SeatSwapEngine.submitOutcome(reqId, offer.acceptor_id, outcome === 'swapped' ? 'swapped' : outcome);
      rerender();
    });
  }
  function seedName(seedId, tripId) {
    const s = seedsForTrip(tripId).find((x) => x.id === seedId);
    return s ? s.first_name : 'Helper';
  }
  function seedOf(seedId, tripId) {
    return seedsForTrip(tripId).find((x) => x.id === seedId) || null;
  }
  function rerender() {
    try { if (typeof SeatSwapApp !== 'undefined') SeatSwapApp.render(); } catch {}
  }
  return { onOffersSent, onUserMessage, onUserOutcome, seedsForTrip, seedName, seedOf, enabled: on };
})();
