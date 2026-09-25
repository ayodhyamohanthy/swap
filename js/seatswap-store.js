/* SeatSwap store — Steps 1-2 (Trips), local-first.
   Maps 1:1 to docs/02-DATA-MODEL.md tables `bookings`, `passengers`, `activity_log`.
   - Works signed out (localStorage). After Google sign-in, local trips attach to
     the account (see attachToAccount(); server sync lands in Step 3).
   - Money: integer paise everywhere. Credit balance stub = sum of wallet_tx.
   - EVERY state transition writes an activity_log row (local stub; the server
     function path in Step 3+ writes the same shape to Postgres).
   RLS note: the browser never reads another user's rows; exact berth numbers of
   other users stay hidden until a swap locks (enforced in Steps 4+). */
const SeatSwapStore = (() => {
  const TRIPS = 'seatswap_trips_v1';
  const LOG = 'seatswap_activity_v1';
  const WALLET = 'seatswap_wallet_v1';
  const SEEN = 'seatswap_seen_v1';
  const uid = () => 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function trips() {
    try { return JSON.parse(localStorage.getItem(TRIPS) || '[]'); } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(TRIPS, JSON.stringify(list.slice(0, 20))); } catch {}
  }
  function get(id) { return trips().find((t) => t.id === id) || null; }

  function logActivity(action, meta) {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch {}
    log.unshift({
      id: 'a-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      actor: 'self', actor_role: 'user', action: String(action),
      entity: (meta && meta.entity) || null, entity_id: (meta && meta.entity_id) || null,
      meta: meta || {}, created_at: new Date().toISOString(),
    });
    try { localStorage.setItem(LOG, JSON.stringify(log.slice(0, 300))); } catch {}
    return log[0];
  }

  async function addTrip(input) {
    // input: {pnr, train_no, train_name, journey_date, from_code, to_code,
    //  class, coach, passengers:[{label,berth_no,berth_type,status,quota,is_child_no_berth}], source}
    const pnrDigits = SeatSwapPNR.digitsOnly(input.pnr);
    if (!SeatSwapPNR.validPNR(pnrDigits)) throw new Error('pnr_invalid');
    const pnr_hash = await SeatSwapPNR.hash(pnrDigits);
    if (trips().some((t) => t.pnr_hash === pnr_hash)) throw new Error('pnr_duplicate');
    const cls = String(input.class || 'SL').toUpperCase();
    const trip = {
      id: uid(),
      pnr_hash, pnr_last4: SeatSwapPNR.last4(pnrDigits),
      train_no: String(input.train_no || '').trim(),
      train_name: String(input.train_name || '').trim(),
      journey_date: input.journey_date || null,
      from_code: (input.from_code || '').toUpperCase().trim(),
      to_code: (input.to_code || '').toUpperCase().trim(),
      class: SeatSwapPNR.CLASSES.includes(cls) ? cls : 'SL',
      is_chair_car: SeatSwapPNR.isChair(cls),
      source: input.source === 'sms_paste' ? 'sms_paste' : 'typed',
      chart_prepared: false,
      open_to_swap: false,
      user_id: null, // attached on Google sign-in (Step 3)
      passengers: (input.passengers && input.passengers.length ? input.passengers : [{
        label: 'Passenger 1', coach: input.coach || null, berth_no: input.berth_no || null,
        berth_type: input.berth_type || (SeatSwapPNR.isChair(cls) ? 'WINDOW' : 'LB'),
        status: input.status || 'CNF', quota: input.quota || 'GN', is_child_no_berth: false,
      }]).map((p) => ({
        id: uid(), label: p.label || 'Passenger',
        coach: p.coach || null, berth_no: p.berth_no || null,
        berth_type: p.berth_type || 'LB', status: p.status || 'CNF',
        quota: p.quota || 'GN', is_child_no_berth: !!p.is_child_no_berth,
        board_code: p.board_code || null, drop_code: p.drop_code || null,
      })),
      created_at: new Date().toISOString(),
    };
    const list = trips();
    list.unshift(trip);
    save(list);
    logActivity('pnr_added', { entity: 'booking', entity_id: trip.id, train_no: trip.train_no, last4: trip.pnr_last4 });
    return trip;
  }

  function setOpen(id, open) {
    const list = trips();
    const t = list.find((x) => x.id === id);
    if (!t) return null;
    t.open_to_swap = !!open; // no reward for this (rule 5)
    save(list);
    logActivity(open ? 'open_to_swap_on' : 'open_to_swap_off', { entity: 'booking', entity_id: id });
    return t;
  }
  function remove(id) {
    save(trips().filter((t) => t.id !== id));
    logActivity('trip_removed', { entity: 'booking', entity_id: id });
  }

  /* Credit wallet stub (paise). Real ledger arrives with Steps 6-8; shape matches
     wallet_tx rows so the UI never changes. Starts at 0 — no free rewards. */
  function creditPaise() {
    try {
      const tx = JSON.parse(localStorage.getItem(WALLET) || '[]');
      return tx.reduce((a, r) => a + (r.amount_paise || 0), 0);
    } catch { return 0; }
  }
  function seen(key) {
    try { return JSON.parse(localStorage.getItem(SEEN) || '{}')[key] === true; } catch { return false; }
  }
  function markSeen(key) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SEEN) || '{}'); } catch {}
    s[key] = true;
    try { localStorage.setItem(SEEN, JSON.stringify(s)); } catch {}
  }
  function attachToAccount(userId) {
    const list = trips().map((t) => ({ ...t, user_id: t.user_id || userId }));
    save(list);
    logActivity('sign_in', { entity: 'user', entity_id: userId, attached_trips: list.length });
    return list;
  }
  return {
    trips, get, addTrip, setOpen, remove,
    logActivity, creditPaise, seen, markSeen, attachToAccount,
    PRICE_PAISE: 9900, FEE_PAISE: 4900, CREDIT_PAISE: 5000,
  };
})();
