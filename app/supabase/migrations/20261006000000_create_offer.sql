-- =====================================================================
-- SeatSwap migration 3: create_offer(), the requester-to-acceptor write path.
--
-- WHY THIS EXISTS. get_matches() (migration #2) gave the requester a READ
-- path to another traveller's open trip, but no client code calls it yet for
-- a second reason beyond wiring: there is nothing to call AFTER the match.
-- `swap_offers` carries no INSERT policy for the requester (only SELECT), and
-- no RPC creates an offer — so the cross-user loop has a sanctioned read with
-- no sanctioned write. The acceptor's accept/decline transitions already exist
-- (`apply_offer_transition`, trigger-guarded); this closes the creation side.
--
-- RULE 13 IS THE REASON THE SIGNATURE IS WHAT IT IS. Inputs are two uuids and
-- a rank — no names, no PNR, no berth numbers cross in either direction, and
-- the function returns a single offer uuid. SECURITY DEFINER reads other
-- users' bookings/passengers rows, so the body re-checks every precondition
-- the app already enforces locally: ownership, searching status, CNF,
-- open_to_swap, no self-offers, blocks in either direction, a live journey
-- date, and a rank inside the request's own choice list.
--
-- IDEMPOTENT BY CONSTRUCTION. Sending is free and double taps happen
-- (docs/03: max 10/day is enforced in the app): an open offer for the same
-- (request, passenger) returns its id instead of inserting a duplicate.
--
-- OPEN QUESTIONS (named, not hidden — never executed against Postgres; both
-- Supabase projects are uncreated):
--   1. Rank CONTENT is trusted: p_rank must sit inside the request's choice
--      list length, but the server does not verify the acceptor's berth_type
--      against choices[p_rank]. Scoring stays in the app (docs/08); the abuse
--      surface is spam offers, capped at 10/day in the app — which the server
--      does NOT enforce. A server-side send cap wants activity counting
--      design, not one more line here.
--   2. Journey-date floor uses CURRENT_DATE (server day): a same-day
--      late-night journey in IST vs UTC could read as past. Kept because a
--      dead-journey offer is the worse failure (jobs-device tests pin the
--      device half); revisit with an explicit timezone when live.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_offer(
  p_request uuid, p_passenger uuid, p_rank int
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_req_requester uuid;
  v_req_status request_status;
  v_req_choices berth_type[];
  v_acc_booking uuid;
  v_acc_user uuid;
  v_acc_status ticket_status;
  v_acc_child boolean;
  v_acc_open boolean;
  v_acc_date date;
  v_existing uuid;
BEGIN
  IF p_rank IS NULL OR p_rank < 1 OR p_rank > 3 THEN
    RAISE EXCEPTION 'bad_rank';
  END IF;

  SELECT requester_id, status, choices
    INTO v_req_requester, v_req_status, v_req_choices
    FROM public.swap_requests WHERE id = p_request;
  IF NOT FOUND OR v_req_requester IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  IF v_req_status <> 'searching' THEN
    RAISE EXCEPTION 'request_not_searching';
  END IF;
  IF p_rank > coalesce(array_length(v_req_choices, 1), 0) THEN
    RAISE EXCEPTION 'rank_out_of_range';
  END IF;

  SELECT p.booking_id, b.user_id, p.status, p.is_child_no_berth,
         b.open_to_swap, b.journey_date
    INTO v_acc_booking, v_acc_user, v_acc_status, v_acc_child,
         v_acc_open, v_acc_date
    FROM public.passengers p
    JOIN public.bookings b ON b.id = p.booking_id
    WHERE p.id = p_passenger;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'passenger_not_found';
  END IF;
  IF v_acc_status <> 'CNF' OR v_acc_child OR NOT v_acc_open THEN
    RAISE EXCEPTION 'acceptor_not_open';
  END IF;
  IF v_acc_user = v_caller THEN
    RAISE EXCEPTION 'no_self_offer';
  END IF;
  IF v_acc_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'journey_over';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = v_caller AND blocked_id = v_acc_user)
       OR (blocker_id = v_acc_user AND blocked_id = v_caller)
  ) THEN
    RAISE EXCEPTION 'blocked';
  END IF;

  SELECT id INTO v_existing FROM public.swap_offers
    WHERE request_id = p_request
      AND acceptor_passenger_id = p_passenger
      AND status = 'sent';
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.swap_offers (
    request_id, acceptor_id, acceptor_booking_id,
    acceptor_passenger_id, matched_choice_rank
  ) VALUES (
    p_request, v_acc_user, v_acc_booking, p_passenger, p_rank
  ) RETURNING id INTO v_existing;
  RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.create_offer(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_offer(uuid, uuid, int) TO authenticated, service_role;
