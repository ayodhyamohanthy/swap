/* SwapSeat · local swap ledger — every attempted and completed swap, persisted
   on this device and reviewable in the UI.
   ---------------------------------------------------------------------------
   SCHEMA v1 (documented in docs/PWA.md):
     key  swapseat_ledger_meta      -> {"schemaVersion":1,"updatedAt":"<ISO>"}
     key  swapseat_ledger_v1        -> [ {record}, ... ]  newest first, max 200

     record = {
       id, createdAt, updatedAt,        // ISO-8601 strings
       mode,                            // 'train' | 'bus' | 'flight'
       serviceNumber, travelDate,       // e.g. '12951', '2026-09-24'
       coachOrCabin, ownSeat, targetSeat,
       status,                          // draft|pending|accepted|declined|expired|failed
       failureReason,                   // '' when not failed
       quoteSummary,                    // e.g. 'search ₹49'
       sourceId                         // originating req/listing id (dedupe, optional)
     }

   PRIVACY: this store is user-scoped and never sent anywhere. It is cleared by
   SwapLedger.clear() (Profile -> Erase local data) and on account switch.
   Records also carry the schema version so a future release can migrate them.
   ------------------------------------------------------------------------- */
const SwapLedger = ((() => {
  const SCHEMA_VERSION = 1;
  const KEY_META = 'swapseat_ledger_meta';
  const KEY_DATA = 'swapseat_ledger_v' + SCHEMA_VERSION;
  const MAX = 200;
  const STATUSES = ['draft', 'pending', 'accepted', 'declined', 'expired', 'failed'];
  /* Keys that hold private, user-scoped data from earlier releases. */
  const USER_KEYS = ['swapseat_current', 'swapseat_bookings', 'swapseat_incoming', 'swapseat_claims',
    'swapseat_prefs', 'swapseat_ratings', 'swapseat_swaps', 'swapseat_reqs', 'swapseat_metrics',
    'swapseat_watches', 'swapseat_blocks', 'swapseat_layout_reports', 'swapseat_wallet',
    'swapseat_searches', 'swapseat_txns', 'swapseat_paycfg', 'swapseat_last_sync', 'swapseat_draft_v1'];
  let injected = null;

  function ls() {
    if (injected) return injected;
    try { return (typeof localStorage !== 'undefined' && localStorage) || null; } catch { return null; }
  }
  function read(key, fallback) {
    const s = ls(); if (!s) return fallback;
    try { const v = s.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  }
  function write(key, val) {
    const s = ls(); if (!s) return false;
    try { s.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  }
  const iso = (v) => new Date(v == null ? Date.now() : v).toISOString();
  const uid = () => 'lg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

  function meta() {
    const m = read(KEY_META, null);
    if (m && m.schemaVersion === SCHEMA_VERSION) return m;
    /* Migration path: v0 (no version key) -> v1 keeps whatever records exist. */
    const migrated = { schemaVersion: SCHEMA_VERSION, updatedAt: iso(), migratedFrom: m ? m.schemaVersion : 0 };
    write(KEY_META, migrated);
    return migrated;
  }
  function touch() {
    const m = meta(); m.updatedAt = iso(); write(KEY_META, m);
  }
  function all() {
    meta();
    const rows = read(KEY_DATA, []);
    return Array.isArray(rows) ? rows : [];
  }
  function save(rows) { write(KEY_DATA, rows.slice(0, MAX)); touch(); }

  function normalize(input) {
    const now = iso();
    const rec = {
      id: (input && input.id) || uid(),
      createdAt: (input && input.createdAt) || now,
      updatedAt: now,
      mode: (input && input.mode) || 'train',
      serviceNumber: String((input && input.serviceNumber) || '—'),
      travelDate: (input && input.travelDate) || now.slice(0, 10),
      coachOrCabin: (input && input.coachOrCabin) || '—',
      ownSeat: (input && input.ownSeat) || '—',
      targetSeat: (input && input.targetSeat) || '—',
      status: STATUSES.indexOf(input && input.status) >= 0 ? input.status : 'pending',
      failureReason: (input && input.failureReason) || '',
      quoteSummary: (input && input.quoteSummary) || '',
      sourceId: (input && input.sourceId) || null,
    };
    return rec;
  }

  function add(input) {
    const rec = normalize(input);
    const rows = all().filter((r) => !(rec.sourceId && r.sourceId === rec.sourceId));
    rows.unshift(rec);
    save(rows);
    return rec;
  }
  function update(id, patch) {
    let touched = null;
    const rows = all().map((r) => {
      if (r.id !== id) return r;
      touched = { ...r, ...patch, updatedAt: iso() };
      return touched;
    });
    if (touched) save(rows);
    return touched;
  }
  function upsert(input) {
    if (input && input.sourceId) {
      const hit = all().find((r) => r.sourceId === input.sourceId);
      if (hit) return update(hit.id, input);
    }
    if (input && input.id) {
      const hit = all().find((r) => r.id === input.id);
      if (hit) return update(hit.id, input);
    }
    return add(input);
  }
  function clear() {
    const s = ls();
    if (!s) return 0;
    const rows = all();
    USER_KEYS.forEach((k) => { try { s.removeItem(k); } catch { /* ignore */ } });
    try {
      Object.keys(s).forEach((k) => {
        if (typeof k === 'string' && k.indexOf('swapseat_ledger') === 0) s.removeItem(k);
        if (typeof k === 'string' && k.indexOf('swapseat_thread_') === 0) s.removeItem(k);
      });
    } catch { /* ignore */ }
    /* Re-seed an empty, versioned store so the schema stays explicit. */
    write(KEY_META, { schemaVersion: SCHEMA_VERSION, updatedAt: iso(), clearedAt: iso() });
    write(KEY_DATA, []);
    return rows.length;
  }
  /* Sign-out / account switch must not leak one traveller's data to the next. */
  function onAccountSwitch() { return clear(); }
  function exportJSON() { return JSON.stringify({ schemaVersion: SCHEMA_VERSION, meta: meta(), records: all() }, null, 2); }
  function stats() {
    const rows = all();
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      accepted: rows.filter((r) => r.status === 'accepted').length,
      failed: rows.filter((r) => r.status === 'failed').length,
    };
  }

  /* Reconcile older stores (requests/listings) into the ledger exactly once.
     Older records carried no schema version, so they are the v0 migration. */
  function syncFromLegacy() {
    let added = 0;
    const reqs = read('swapseat_reqs', []);
    (Array.isArray(reqs) ? reqs : []).forEach((r) => {
      const snap = (r && r.snap) || {};
      const map = { requested: 'pending', accepted: 'accepted', declined: 'declined', expired: 'expired', cancelled: 'failed' };
      const rec = add({
        sourceId: 'req:' + (r && r.id), mode: snap.mode || 'train', serviceNumber: snap.no || '—',
        travelDate: iso(r && (r.ts || Date.now())).slice(0, 10),
        coachOrCabin: snap.coach || '—', ownSeat: snap.seat || '—', targetSeat: (r && r.theirSeat) || '—',
        status: map[(r && r.state) || 'requested'] || 'pending',
        createdAt: iso(r && (r.ts || Date.now())),
        failureReason: (r && r.state === 'cancelled') ? 'cancelled' : '',
        quoteSummary: 'swap request',
      });
      added += rec ? 1 : 0;
    });
    const swaps = read('swapseat_swaps', []);
    (Array.isArray(swaps) ? swaps : []).forEach((s) => {
      const no = (s && (s.trainNo || s.busNo || s.flightNo)) || '—';
      add({
        sourceId: 'swap:' + (s && s.id), mode: (s && s.mode) || 'train', serviceNumber: no,
        travelDate: (s && s.date) || iso(s && s.ts).slice(0, 10),
        coachOrCabin: (s && (s.coach || s.deck)) || '—', ownSeat: (s && s.seat) || '—',
        targetSeat: (s && s.wantSeat) || '—',
        status: (s && s.state) === 'completed' ? 'accepted' : 'draft',
        createdAt: iso(s && s.ts), quoteSummary: 'listing',
      });
      added += 1;
    });
    return added;
  }

  const api = { SCHEMA_VERSION, STATUSES, KEY_DATA, KEY_META, USER_KEYS,
    all, add, update, upsert, clear, onAccountSwitch, exportJSON, stats, syncFromLegacy, meta,
    _inject(storage) { injected = storage; } };
  return api;
})());
if (typeof module !== 'undefined' && module.exports) module.exports = SwapLedger;
