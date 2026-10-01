-- =====================================================================
-- SeatSwap migration 2: get_matches(), the cross-user match RPC.
-- Applied 2026-10-01 from the reviewed proposal in app/azure/load/
--   get-matches.spec-part2.sql (which stays as the review record) and
--   get-matches.spec-part1.sql (indexes — deliberately NOT applied, see
--   the bottom of this file). Contract note: app/azure/load/rpc-contract-note.ts.
--
-- WHY THIS IS LOAD-BEARING, NOT A SCALE OPTIMISATION. Part 7 already
-- shipped: `match_cards` is created WITH (security_invoker = true) and
-- the three `*_match_read` policies on profiles/bookings/passengers are
-- dropped. So a client SELECT on that view is evaluated under RLS as the
-- caller, and after part 7 the caller's only surviving read policies are
-- their own rows — a signed-in user sees their OWN open trips and nothing
-- else. Cross-user matching cannot work through the view at all. That is
-- rule 13 working as intended (never expose another user's PNR, berth or
-- contact details), and it makes this function the one sanctioned path to
-- another traveller's open trip: SECURITY DEFINER runs the read with
-- elevated rights, and the function's body chooses the columns.
--
-- RULE 13 IS THE REASON THE BODY IS WHAT IT IS. It returns exactly the
-- `match_cards` column set, which part 7 already narrowed to the
-- pre-payment-safe fields: booking/train/date/class/coach/berth_type and
-- first_name + last_initial. No berth_no, no pnr_hash, no email, no
-- phone, and deliberately not `passengers.label` (free text, see the
-- note on `match_cards` in schema.part7.sql). Exact berth numbers stay
-- behind `locked_berths`, which is party-checked.
--
-- WHAT IT DOES NOT DO, despite having been the only path matching can
-- take: overlapping segment, not blocked or paused, the acceptor's daily
-- cap, women-only / families-only / same-coach, and quota qualification
-- all stay in app/src/lib/matching.ts rankMatches(). Scoring lives there
-- too. This RPC narrows; the app filters and ranks. Keeping it a
-- narrowing query is also what keeps two implementations of the same
-- rules from drifting apart.
--
-- NEVER EXECUTED AGAINST POSTGRES. This repo has no Postgres and no
-- Supabase project yet (docs/12 §4 records both refs as "— none yet"),
-- so this file has been reviewed and pinned by tests/schema.test.ts but
-- has never been run. The first thing to do when a database exists is
-- apply it and confirm the two questions the guards cannot answer from
-- the text: (1) that the p_limit clamp below behaves as the contract note
-- claims for an explicitly passed NULL — Postgres's GREATEST/LEAST ignore
-- NULL arguments, which is relied on here and is exactly the kind of thing
-- that is cheaper to verify than to reason about; and (2) that `LANGUAGE
-- sql` accepts the body, since sql bodies are validated at CREATE time and
-- a type error fails the whole migration rather than the call.
--
-- NOTE ON THE HEADER, because it bit this file's own mutation run: the clamp
-- expression is written out in full exactly ONCE, in the SQL below. An earlier
-- draft of this comment repeated it, and a scripted `s/GREATEST(...), 50/…/`
-- with no /g flag then rewrote the comment instead of the statement — the
-- suite stayed green on a mutation that had never touched the schema. L7 hit
-- the same thing on the admin table (docs/14, backlog 7). Do not reintroduce
-- a second copy of any expression that also appears in the SQL.
-- =====================================================================

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

-- PUBLIC is revoked before the grant, so the function is unreachable to
-- anon and to the default public EXECUTE grant; `authenticated` and the
-- webhook/job path get it explicitly. SET search_path = public above stops
-- a caller-controlled search_path from resolving public.match_cards to
-- something else inside a SECURITY DEFINER body.
REVOKE ALL ON FUNCTION public.get_matches(text, date, travel_class, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_matches(text, date, travel_class, uuid, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- NOT IN THIS FILE: the six partial indexes from get-matches.spec-part1.sql
-- (bookings_hot_idx, passengers_open_idx, offers_request_status_idx,
-- offers_acceptor_day_idx, requests_searching_idx, activity_entity_idx).
--
-- Deliberate, and recorded in docs/DECISIONS.md rather than left as a
-- silent omission, because part 1 is filed as the same proposal and a
-- reader should not have to guess whether it was forgotten.
--
--   - They are not needed for this function to work. Its whole predicate
--     is (train_no, journey_date, class) on `bookings`, and schema.sql
--     already carries bookings_train_date_class_idx on exactly those
--     three columns. The access path is already indexed.
--   - They do not address correctness at all. Part 1's own header calls
--     them the "ultimate scale fix for lakhs" — a scale argument, and a
--     later one.
--   - There is nothing yet to scale. Both Supabase projects are
--     uncreated (docs/12 §4), so every one of these tables holds zero
--     rows; six new indexes would cost write amplification and CREATE
--     INDEX lock time against a database with no data in it.
--
-- They stay parked in get-matches.spec-part1.sql as a second migration
-- when there is a real table to measure, which is the only thing that
-- would justify picking them.
