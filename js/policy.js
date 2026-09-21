/* SwapSeat policy engine — every pricing, eligibility, seat-privacy and payment
   decision lives HERE, behind one interface, so a production backend can take
   over without touching UI code. The mobile UI must display the RESULT of
   these decisions, never determine them (spec: server decides).
   Demo backing store is localStorage; swap for API calls in production. */
const Policy = (() => {
  const fees = () => {
    try { return effectivePayConfig().fees || { SEARCH_FEE: 49, ONE_SIDED_SWAP_FEE: 99, currency: 'INR' }; }
    catch { return { SEARCH_FEE: 49, ONE_SIDED_SWAP_FEE: 99, currency: 'INR' }; }
  };

  /* ---------- search entitlements: one paid search per service instance ---------- */
  function searches() { try { return JSON.parse(localStorage.getItem('swapseat_searches') || '{}'); } catch { return {}; } }
  function saveSearches(s) { localStorage.setItem('swapseat_searches', JSON.stringify(s)); }
  function hasPaidSearch(service) { return !!(service && searches()[service]?.paid); }
  function markSearchPaid(service, ref) {
    const s = searches();
    s[service] = { paid: true, ts: Date.now(), ref: ref || null, credited: !!(s[service]?.credited) };
    saveSearches(s);
  }
  function markCredited(service) {
    const s = searches();
    if (s[service]) { s[service].credited = true; saveSearches(s); }
  }
  function wasCredited(service) { return !!(service && searches()[service]?.credited); }

  /* ---------- accepter fee status ----------
     Paid search = they were looking too (Plus members / operator-verified
     travellers are treated as search-paid). Otherwise the requester owes the
     one-sided completion fee after acceptance. */
  function accepterPaid(swap) {
    if (!swap) return false;
    return !!(swap.plus || (swap.verify || 0) >= 2 || swap.accepterPaid);
  }
  function completionFeeDue(req, swap) {
    if (!req || req.state !== 'accepted') return false;
    if (req.completionPaid) return false;
    return !accepterPaid(swap);
  }

  /* ---------- seat privacy: exact numbers unlock only when protected ---------- */
  function revealState(req, swap) {
    if (!req || !swap) return { unlocked: false, reason: 'no-request' };
    if (!['accepted', 'crew', 'completed'].includes(req.state)) return { unlocked: false, reason: 'not-accepted' };
    if (!hasPaidSearch(swap.service)) return { unlocked: false, reason: 'search-unpaid' };
    if (completionFeeDue(req, swap)) return { unlocked: false, reason: 'completion-unpaid' };
    return { unlocked: true, reason: 'protected' };
  }

  /* ---------- segment overlap (MVP: exact; backend does stop-index overlap) ----------
     Returns 'exact' | 'overlap' | 'none'. Only 'exact' matches in this build. */
  function segmentOverlap(aSeg, bSeg) {
    if (!aSeg || !bSeg) return 'none';
    if (aSeg === bSeg) return 'exact';
    return 'none';
  }

  return { fees, searches, hasPaidSearch, markSearchPaid, markCredited, wasCredited,
    accepterPaid, completionFeeDue, revealState, segmentOverlap };
})();
