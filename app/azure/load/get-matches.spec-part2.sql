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
-- RESOLVED (2026-09-28, L8) — the two questions left open above:
--
--   a) Booking split across pages. Keep row-based pagination: the split is
--      harmless, but NOT for the reason an earlier note gave ("the client
--      regroups by booking_id" — that only helps if the client holds every
--      page, which a first render does not). The real reason is that
--      match_cards exposes no per-booking seat count, so the client cannot
--      derive anything from how many rows of a booking it happens to have.
--      That is a constraint on any future fix, not a licence: if seat counts
--      are ever added for the keep-together score, they must be added as a
--      PER-ROW column (every row of a booking carrying the booking's full
--      count), never counted client-side from rows received. Per-row keeps
--      splitting harmless by construction; client-side counting would turn a
--      page boundary into a silently under-counted candidate.
--
--   b) The 50-row clamp vs "never more than 20 rows on a phone". Both stay, and
--      they are different things. 50 is the server's abuse ceiling — what the
--      function guarantees no caller can exceed. 20 is the phone client's own
--      page size, a payload choice the server has no business encoding: it
--      cannot know the device, and a desktop caller may legitimately want
--      more. rpc-contract-note.ts is reworded to say exactly that instead of
--      presenting the two numbers as a contradiction.
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
