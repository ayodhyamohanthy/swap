-- 2. Paginated get_matches() RPC (proposal).
--
-- This is NOT only a scale optimisation. part 7 drops every *_match_read policy
-- and makes match_cards security_invoker, so a client SELECT on that view
-- returns only the caller's OWN rows. Seeing other travellers' open trips
-- therefore requires a function running with elevated rights — that is what
-- SECURITY DEFINER is for here. Without this RPC (or an equivalent
-- service_role path) matching cannot work at all, which makes it more urgent
-- than "hot-train scale work" suggests.
--
-- What it narrows: same train + date + class, plus what the match_cards view
-- already enforces (open_to_swap, CNF, not a child without a berth).
-- What it does NOT apply, despite an earlier revision of this comment claiming
-- otherwise: overlapping segment, not blocked or paused, inside the acceptor's
-- daily cap, women-only / families-only / same-coach, quota qualification.
-- All of those stay in app/lib/matching.ts rankMatches(), which is also where
-- scoring lives. The RPC only narrows; the app filters and ranks.
--
-- REVIEW NOTE (2026-09-28, L8) — two defects corrected here:
--   a) p_after was declared timestamptz but compared against booking_id, which
--      is uuid. `uuid < timestamptz` has no operator, and LANGUAGE sql bodies
--      are validated at CREATE time, so this function could not have been
--      created and the migration would have failed outright. Now uuid — and
--      the REVOKE/GRANT signatures below had to change with it, or they would
--      have targeted a function that does not exist.
--   b) "newest-first" was promised but match_cards exposes no created_at, so
--      the view cannot support it. The order is stable by booking_id, which is
--      all the client needs: it re-ranks every page in rankMatches() anyway.
-- Still open for whoever applies this: one booking with several passengers
-- yields several match_cards rows, so a LIMIT can split a booking's passengers
-- across two pages. Harmless (the client regroups by booking_id) but wasteful.
-- The 50-row clamp also contradicts the "never more than 20 rows on a phone"
-- promise in azure/load/rpc-contract-note.ts — pick one.
CREATE OR REPLACE FUNCTION public.get_matches(
  p_train text, p_date date, p_class travel_class,
  p_after uuid DEFAULT NULL, p_limit int DEFAULT 20
)
RETURNS SETOF public.match_cards
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.match_cards
  WHERE train_no = p_train AND journey_date = p_date AND class = p_class
    AND (p_after IS NULL OR booking_id < p_after)
  ORDER BY booking_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;
REVOKE ALL ON FUNCTION public.get_matches(text, date, travel_class, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_matches(text, date, travel_class, uuid, int) TO authenticated, service_role;
