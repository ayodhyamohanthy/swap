-- =====================================================================
-- SeatSwap migration 6: make the rule-13 exact-berth reveal actually reveal.
--
-- THE DEFECT. `locked_berths` shipped as a `security_invoker = true` view
-- over `passengers`. Part 7 drops the three `*_match_read` policies, which
-- leaves `passengers_owner` as the caller's only surviving policy on that
-- table. A `security_invoker` view reads its base tables as the CALLER, so
-- each party could see their own passenger row and not the other side's:
-- the INNER JOIN dropped the peer before `berth_no` was ever projected.
--
-- Executed against PostgreSQL 18.3 (PGlite), not read — a fixture with A as
-- requester (berth 41), B as acceptor (berth 52) and C as a stranger (63),
-- A's request `locked` against B's offer:
--
--     locked_berths   A requester -> {41}    B acceptor -> {52}    C -> {}
--
-- Privacy held: a non-party saw nothing, so this was never a leak. It was a
-- no-op for the only two people the reveal exists for — after paying, each
-- side saw the berth they already knew. Every static guard in
-- tests/schema.test.ts passed while it did, which is why it needed running.
--
-- THE FIX, and the fix it is NOT. Re-adding a broad `passengers` policy would
-- make the join succeed by handing berth numbers to every signed-in user —
-- exactly the leak rule 13 exists to stop. Only a FUNCTION can raise its own
-- rights (a view cannot), so the reveal becomes a SECURITY DEFINER body that
-- performs the party check itself and projects only `coach` + `berth_no`,
-- which is the shape `get_matches()` already uses. The `WHERE` clause was
-- never the broken part: `is_request_party` is itself SECURITY DEFINER, so it
-- gates WHICH REQUESTS you may see, not which passenger rows survive a join.
--
-- The view keeps its name, column list and grant, and becomes a thin wrapper.
-- `security_invoker = true` stays: the privilege that must be checked is the
-- CALLER's EXECUTE on the function; a definer-rights view would check the
-- owner's instead.
--
-- BASELINE-AND-MIGRATION, like migration 5. `schema.part7.sql`, `schema.sql`
-- and `20260925000000_init.sql` carry the same DDL, because `schema.sql` is
-- what tests/schema.test.ts reads as "the schema" and a superseded copy there
-- is how a fixed function reads as still broken. The block below is
-- byte-identical to the baseline (asserted in tests/schema.test.ts) so the two
-- cannot drift.
--
-- OPEN QUESTION, named rather than proven. The function is parameterless
-- because the view has no parameters and must enumerate every request the
-- caller is a party to. If the app ever wants a single-request reveal it
-- should be `get_locked_berths(p_req uuid)`, and the view dropped — the RPC
-- shape `get_matches()` uses. Nothing reads either yet: `revealedBerths()` in
-- app/src/lib/requests.ts reads local device state today, so this view is the
-- server-side path the app will need when real cross-device sync lands, and
-- it was broken before it was ever called.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_locked_berths()
RETURNS TABLE (
  request_id uuid, booking_id uuid, passenger_id uuid, coach text, berth_no text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, p.booking_id, p.id, p.coach, p.berth_no
  FROM public.swap_requests r
  JOIN public.swap_offers o ON o.id = r.locked_offer_id
  JOIN public.passengers p
    ON p.booking_id = r.booking_id OR p.booking_id = o.acceptor_booking_id
  WHERE r.status IN ('locked', 'confirmed', 'disputed')
    AND public.is_request_party(r.id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_locked_berths() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_locked_berths() TO authenticated, service_role;

-- The view keeps its name, its column list and its grant, and becomes a thin
-- wrapper over the definer body above. `security_invoker = true` is retained on
-- purpose: the privilege that must be checked is the CALLER's EXECUTE on the
-- function, whereas a definer-rights view would check the view owner's instead
-- — which is not what the GRANT below is written to mean.
CREATE OR REPLACE VIEW public.locked_berths WITH (security_invoker = true) AS
  SELECT * FROM public.get_locked_berths();
REVOKE ALL ON TABLE public.locked_berths FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.locked_berths TO authenticated;
