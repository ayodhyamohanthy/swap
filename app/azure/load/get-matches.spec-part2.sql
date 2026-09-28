-- 2. Paginated get_matches() RPC (proposal, mirrors match_cards + rankMatches
-- hard filters: same train/date/class, overlapping segment, CNF, open,
-- not blocked/paused, inside daily caps, filters respected, quota-qualified.
-- Scoring stays in app/lib/matching.ts rankMatches(); the RPC only narrows.)
CREATE OR REPLACE FUNCTION public.get_matches(
  p_train text, p_date date, p_class travel_class,
  p_after timestamptz DEFAULT NULL, p_limit int DEFAULT 20
)
RETURNS SETOF public.match_cards
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.match_cards
  WHERE train_no = p_train AND journey_date = p_date AND class = p_class
    AND (p_after IS NULL OR booking_id < p_after)
  ORDER BY booking_id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;
REVOKE ALL ON FUNCTION public.get_matches(text, date, travel_class, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_matches(text, date, travel_class, timestamptz, int) TO authenticated, service_role;
