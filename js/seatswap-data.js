/* SeatSwap demo world + matching (docs/02, docs/08 matching).
   Candidates = same train_no + journey_date + class, overlapping segment,
   CNF, not blocked/paused, within acceptor daily limit, filters respected,
   berth type in requester's choices. Score: choice rank 50/35/20 +
   same coach 10 + keep-together fit 10 + rating 0-10. Quota berths (SS/LD/HP)
   shown only to people who qualify. Exact berth numbers of others are NEVER
   stored here — UI shows "Berth ••" until a swap locks. */
const SeatSwapData = (() => {
  const FIRST = ['Arjun', 'Priya', 'Riya', 'Meena', 'Sneha', 'Rohan', 'Kavya', 'Vikram', 'Anita', 'Ramesh'];
  const LAST = ['M', 'S', 'K', 'R', 'P', 'V', 'N', 'D'];
  const REASONS = ['Travelling with family', 'Knee issue, need lower berth', 'Senior citizen', 'Kids in another coach', 'Prefer side berth', 'Group of 3 together'];
  const WANTS = [['LB'], ['LB', 'SL'], ['SL'], ['MB'], ['LB', 'MB'], ['SU'], ['UB'], ['UB', 'SU'], ['MB', 'UB']];
  const COACHES_SLEEPER = ['S1', 'S2', 'S3', 'B1', 'B2', 'B3', 'A1', 'A2'];
  const BERTHS_SLEEPER = ['LB', 'MB', 'UB', 'SL', 'SU'];
  const SEATS_CHAIR = ['WINDOW', 'AISLE', 'MIDDLE_SEAT'];

  function hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pick(rng, arr) { return arr[rng % arr.length]; }

  /* Deterministic demo travelers for a trip (stable per trip id). */
  function seedsFor(trip) {
    const chair = SeatSwapPNR.isChair(trip.class);
    const h = hash32(trip.id + trip.train_no + trip.journey_date);
    const myCoach = (trip.passengers[0] && trip.passengers[0].coach) || (chair ? 'C1' : 'B2');
    const coaches = chair ? ['C1', 'C2', 'C3'] : COACHES_SLEEPER;
    const n = 3 + (h % 2); // 3-4 travelers
    const out = [];
    const myBerth = (trip.passengers[0] && trip.passengers[0].berth_type) || 'LB';
    for (let i = 0; i < n; i++) {
      const r = hash32(trip.id + ':seed:' + i);
      const coach = i === 0 ? myCoach : pick(r >>> 3, coaches);
      const berthType = chair ? pick(r >>> 5, SEATS_CHAIR) : pick(r >>> 5, BERTHS_SLEEPER);
      out.push({
        id: 'seed:' + trip.id + ':' + i,
        trip_id: trip.id,
        first_name: pick(r >>> 0, FIRST),
        last_initial: pick(r >>> 2, LAST),
        coach, berth_type: berthType,
        rating: 3.5 + ((r >>> 7) % 16) / 10, // 3.5-5.0
        verified: true,
        // first traveler always wants something like mine, so a request can match
        wants: i === 0 ? [myBerth, 'LB'] : pick(r >>> 9, WANTS),
        reason: pick(r >>> 11, REASONS),
        quota: 'GN',
        paused: false,
        backed_out_30d: 0,
      });
    }
    return out;
  }

  function berthLabel(t, cls) { return SeatSwapPNR.berthLabel(t, cls); }

  /* Ranked match scoring for a request against seeds. */
  function scoreMatches(req, trip, seeds, opts) {
    const o = opts || {};
    const mine = trip.passengers[0] || {};
    const myBerth = mine.berth_type;
    const rows = [];
    for (const s of seeds) {
      if (o.blocked && o.blocked.includes(s.id)) continue;
      if (s.paused || s.backed_out_30d >= 3) continue;
      if (req.same_coach && s.coach !== mine.coach) continue;
      if (o.womenOnly && !o.womenOnlyOk) continue;
      // quota: SS/LD/HP berths only to qualifying people (demo: requester qualifies if same quota)
      if ((mine.quota === 'SS' || mine.quota === 'LD' || mine.quota === 'HP') && s.quota !== mine.quota && s.quota !== 'GN') continue;
      const rank = req.choices.indexOf(s.berth_type);
      if (rank < 0) continue; // offers nothing in my choices
      // they must want something like mine
      if (!s.wants.includes(myBerth)) continue;
      let score = rank === 0 ? 50 : rank === 1 ? 35 : 20;
      if (s.coach === mine.coach) score += 10;
      if (req.keep_together) score += 10;
      score += Math.max(0, Math.min(10, Math.round((s.rating - 3.5) * 6)));
      rows.push({ seed: s, rank, score: Math.min(100, score) });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  /* Static berth layout info for public train pages (no availability claims). */
  function layoutFor(cls) {
    if (SeatSwapPNR.isChair(cls)) {
      return { kind: 'chair', rows: 'Window / Aisle / Middle. Facing direction varies by coach.', seats: ['WINDOW', 'AISLE', 'MIDDLE_SEAT'] };
    }
    return { kind: 'sleeper', rows: 'Lower, Middle, Upper + Side Lower, Side Upper per bay.', seats: ['LB', 'MB', 'UB', 'SL', 'SU'] };
  }
  return { seedsFor, scoreMatches, berthLabel, layoutFor, COACHES_SLEEPER };
})();
