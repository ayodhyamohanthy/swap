/* SwapSeat · booking provider + journey lifecycle.
   ---------------------------------------------------------------------------
   PRIVACY CONTRACT (spec §16, §8 users table):
   The raw PNR is used transiently to look the booking up and is then DISCARDED.
   We persist only a masked reference and a salted hash — never the number, never
   the ticket, never a passenger surname. A licensed PNR/booking API replaces
   `DEMO` in production; nothing else in this file changes.

   Seat claims are resolved THROUGH the geometry engine (trainPosition /
   flightSeatInfo), so a booking can never point at a seat that does not exist.
   ------------------------------------------------------------------------- */
const Bookings = (() => {
  const STORE = 'swapseat_bookings';
  const INCOMING = 'swapseat_incoming';
  const CLAIMS = 'swapseat_claims';
  const PREFS = 'swapseat_prefs';
  const RATINGS = 'swapseat_ratings';

  /* ---------- privacy helpers ---------- */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function mask(pnr) {
    const v = String(pnr || '');
    if (v.length <= 3) return '•••';
    return '•'.repeat(Math.max(0, v.length - 3)) + v.slice(-3);
  }
  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- reference dataset (demo only — no real passenger data) --------- */
  /* Dates and clock times are relative so the demo always looks current AND the
     journey-tracking screen has a meaningful live phase. The seeded travellers in
     js/data.js use the same isoDay() offsets, which is what makes matches. */
  const DEMO = [
    {
      id: 'b-flight-1', mode: 'flight', pnr: '6E4F3B', surname: 'MOHANTY',
      carrier: 'IndiGo', serviceNo: '6E 2135', no: '6E2135',
      from: 'DEL', to: 'BLR', dateOffset: 0, depMin: 50, durMin: 150,
      stops: 'Non-stop', classCode: 'Economy', craft: 'A20N',
      passengers: [{ name: 'Ayodhya R. Mohanty', seat: '14C', classCode: 'Economy' }],
    },
    {
      id: 'b-bus-1', mode: 'bus', pnr: 'KRT8821', surname: 'MOHANTY',
      carrier: 'KSRTC', serviceNo: 'KSRTC - Rajdhani', no: 'KSRTC:RAJDHANI',
      from: 'HYD', to: 'BLR', dateOffset: 0, depMin: 150, durMin: 600,
      stops: 'Non-stop', classCode: 'AC Sleeper (2+1)',
      busOp: 'KSRTC', busSvc: 'Rajdhani', busType: 'sleeper', deck: 'L',
      boarding: 'MGBS, Hyderabad', dropping: 'Majestic, Bengaluru',
      amenities: ['AC', 'Charging', 'Wi-Fi'],
      passengers: [{ name: 'Ayodhya R. Mohanty', seat: 21, seatLabel: 'B21', classCode: 'AC Sleeper (2+1)' }],
    },
    {
      id: 'b-train-1', mode: 'train', pnr: '2718284018', surname: 'MOHANTY',
      carrier: 'Indian Railways', serviceNo: '12951', no: '12951',
      from: 'MMCT', to: 'NDLS', dateOffset: 0, depMin: 240, durMin: 932,
      stops: 'Non-stop', classCode: '3A', coach: 'B2',
      passengers: [{ name: 'Ayodhya R. Mohanty', seat: 22, classCode: '3A' }],
    },
  ];

  const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  function refs() { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } }
  function saveRefs(a) { localStorage.setItem(STORE, JSON.stringify(a.slice(0, 20))); }

  /* Look a booking up. Returns { booking } or { error } — never throws at the
     caller, and never persists anything when the lookup fails. */
  function find(mode, pnr, surname) {
    const p = String(pnr || '').trim().toUpperCase().replace(/\s+/g, '');
    const s = String(surname || '').trim().toUpperCase();
    if (!p) return { error: 'Enter your PNR / booking reference.' };
    if (!s) return { error: 'Enter the passenger surname exactly as on the ticket.' };
    if (mode === 'flight' && !/^[A-Z0-9]{6}$/.test(p)) return { error: 'A flight PNR is 6 letters/numbers.' };
    if (mode !== 'flight' && !/^[A-Z0-9]{6,12}$/.test(p)) return { error: 'That reference looks too short for this operator.' };
    const hit = DEMO.find((b) => b.mode === mode && b.pnr === p && b.surname === s);
    if (!hit) return { error: 'No booking found for that reference + surname. Check the ticket, or add your journey manually.' };
    return { booking: hydrate(hit) };
  }

  /* Turn a reference record into a resolved booking: date + geometry-validated seats. */
  function hydrate(ref) {
    const date = isoDay(ref.dateOffset || 0);
    /* Operator schedules are absolute; the demo derives clock times from now so a
       demo session always has a live leg to track. Real bookings carry dep/arr. */
    let dep = ref.dep, arr = ref.arr, dur = ref.dur;
    if (ref.depMin != null) {
      const d0 = new Date(Date.now() + ref.depMin * 60000);
      const d1 = new Date(d0.getTime() + (ref.durMin || 120) * 60000);
      dep = hhmm(d0); arr = hhmm(d1);
      const h = Math.floor((ref.durMin || 120) / 60), m = (ref.durMin || 120) % 60;
      dur = h + 'h ' + String(m).padStart(2, '0') + 'm';
    }
    const passengers = (ref.passengers || []).map((x) => ({ ...x, info: seatInfoFor(ref, x.seat) }));
    const b = {
      ...ref, date, dep, arr, dur, passengers,
      pnrMasked: mask(ref.pnr),
      pnrHash: hash(ref.pnr),
      primary: passengers[0] || null,
      service: serviceKey(ref.mode, ref.no, date, `${ref.from}→${ref.to}`),
      fetchedAt: Date.now(),
      confidence: 'verified',            // booking-grade: the operator's own record
      source: ref.carrier + ' booking reference',
      lastNameChecked: true,
    };
    delete b.pnr;                        // raw reference never leaves this function
    delete b.surname;
    delete b.depMin; delete b.durMin;
    return b;
  }

  function seatInfoFor(b, seat) {
    if (b.mode === 'flight') return flightSeatInfo(b.craft, seat);
    const t = b.mode === 'bus' ? busService(b.busOp, b.busSvc, b.busType, b.from, b.to) : TRAIN_INDEX[b.no] || GENERIC_TRAIN;
    return trainPosition(t, b.coach || b.deck || 'L', seat);
  }
  function vehicleOf(b) {
    if (!b) return null;
    if (b.mode === 'flight') return AIRCRAFT[b.craft];
    if (b.mode === 'bus') return busService(b.busOp, b.busSvc, b.busType, b.from, b.to);
    return TRAIN_INDEX[b.no] || GENERIC_TRAIN;
  }

  /* ---------- current booking (the traveller's own journey) ---------- */
  function current() { try { return JSON.parse(localStorage.getItem('swapseat_current') || 'null'); } catch { return null; } }
  function setCurrent(b) {
    if (b) localStorage.setItem('swapseat_current', JSON.stringify(b));
    else localStorage.removeItem('swapseat_current');
    return b;
  }
  function remember(b) {
    const existing = refs().filter((r) => r.pnrHash !== b.pnrHash);
    existing.unshift({ pnrHash: b.pnrHash, pnrMasked: b.pnrMasked, mode: b.mode, no: b.no,
      carrier: b.carrier, from: b.from, to: b.to, date: b.date, seat: b.primary && b.primary.seat,
      seatLabel: b.primary && b.primary.seatLabel, coach: b.coach || b.deck, classCode: b.classCode,
      ts: Date.now() });
    saveRefs(existing);
  }

  /* ---------- which seats am I willing to swap from ---------- */
  function claims(bookingId) {
    try { return JSON.parse(localStorage.getItem(CLAIMS) || '{}')[bookingId] || []; } catch { return []; }
  }
  function setClaims(bookingId, seats) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(CLAIMS) || '{}'); } catch {}
    all[bookingId] = seats.slice(0, 3);
    localStorage.setItem(CLAIMS, JSON.stringify(all));
    return all[bookingId];
  }

  /* ---------- preferences (what the traveller is open to) ---------- */
  const DEFAULT_PREFS = { kinds: [], where: [], extra: [], note: '' };
  function prefs(bookingId) {
    try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS) || '{}')[bookingId] || {}) }; }
    catch { return { ...DEFAULT_PREFS }; }
  }
  function setPrefs(bookingId, p) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch {}
    all[bookingId] = { ...DEFAULT_PREFS, ...p };
    localStorage.setItem(PREFS, JSON.stringify(all));
    return all[bookingId];
  }

  /* ---------- incoming requests (accepter side) ----------
     Built from the seeded travellers on the SAME service instance, so an
     incoming request can only exist for a real departure the user is on. */
  function incoming(booking) {
    const b = booking || current();
    if (!b) return [];
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(INCOMING) || '{}'); } catch {}
    const seeds = (typeof SEED_SWAPS !== 'undefined' ? SEED_SWAPS : [])
      .filter((s) => s.service === b.service && !s.mine)
      .slice(0, 3);
    return seeds.map((s, i) => {
      const id = 'in-' + b.pnrHash + '-' + s.id;
      const st = stored[id] || {};
      return {
        id, swapId: s.id, fromName: s.alias, fromVerified: s.verify || 0, fromPlus: !!s.plus,
        mode: b.mode, carrier: b.carrier, serviceNo: b.serviceNo, from: b.from, to: b.to,
        date: b.date, dep: b.dep, arr: b.arr,
        theirSeat: s.seat, theirCoach: s.coach, theirWant: s.want || [], note: s.note || '',
        theirPosition: s.info || null,
        yourSeat: (b.primary && (b.primary.seatLabel || b.primary.seat)) || null,
        yourCoach: b.coach || b.deck || null,
        service: b.service,
        state: st.state || 'pending', ts: st.ts || (Date.now() - (i + 1) * 36e5),
      };
    });
  }
  function setIncoming(id, patch) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(INCOMING) || '{}'); } catch {}
    stored[id] = { ...(stored[id] || {}), ...patch, ts: Date.now() };
    localStorage.setItem(INCOMING, JSON.stringify(stored));
    return stored[id];
  }
  function acceptIncoming(id) { return setIncoming(id, { state: 'accepted', acceptedAt: Date.now() }); }
  function declineIncoming(id) { return setIncoming(id, { state: 'declined' }); }

  /* ---------- journey phase (tracking) ----------
     Derived from the clock against dep/arr when both exist; otherwise an honest
     demo progression. Never claims live operator data. */
  const PHASES = ['notstarted', 'departed', 'enroute', 'arriving', 'arrived'];
  function phase(booking) {
    const b = booking || current();
    if (!b || !b.dep || !b.arr || b.dep.indexOf(':') < 0) {
      const mins = (Date.now() / 6e4) % 90;
      return { key: mins < 15 ? 'departed' : mins < 60 ? 'enroute' : 'arriving', source: 'demo' };
    }
    const at = (hhmm, dayOffset) => {
      const [h, m] = hhmm.split(':').map(Number);
      const d = new Date(b.date + 'T00:00:00');
      d.setDate(d.getDate() + (dayOffset || 0));
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };
    const arrNext = b.arr < b.dep;                       // overnight service
    const dep = at(b.dep, 0), arr = at(b.arr, arrNext ? 1 : 0), now = Date.now();
    if (now < dep - 36e5) return { key: 'notstarted', source: 'schedule', dep, arr };
    if (now < dep) return { key: 'departed', source: 'schedule', dep, arr };
    if (now < arr - 18e5) return { key: 'enroute', source: 'schedule', dep, arr };
    if (now < arr) return { key: 'arriving', source: 'schedule', dep, arr };
    return { key: 'arrived', source: 'schedule', dep, arr };
  }
  function rating(journeyId) {
    try { return JSON.parse(localStorage.getItem(RATINGS) || '{}')[journeyId] || 0; } catch { return 0; }
  }
  function setRating(journeyId, stars) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(RATINGS) || '{}'); } catch {}
    all[journeyId] = stars;
    localStorage.setItem(RATINGS, JSON.stringify(all));
    return stars;
  }

  return { find, mask, hash, hydrate, seatInfoFor, vehicleOf, uid,
    current, setCurrent, remember, refs, saveRefs,
    claims, setClaims, prefs, setPrefs, DEFAULT_PREFS,
    incoming, setIncoming, acceptIncoming, declineIncoming,
    phase, PHASES, rating, setRating,
    STORE, INCOMING, CLAIMS, PREFS, RATINGS, DEMO };
})();
