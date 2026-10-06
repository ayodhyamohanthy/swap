-- =====================================================================
-- SeatSwap migration 4: the per-user rows a sign-up must create.
--
-- THE DEFECT THIS FIXES, STATED PLAINLY. Two tables hold one row per signed-in
-- user, and nothing created either of them.
--
-- (1) `profiles` — CRITICAL, because matching is gated on it. `match_cards`
-- (part 7) is built as
--
--     FROM public.bookings b
--     JOIN public.passengers p ON p.booking_id = b.id
--     JOIN public.profiles   pr ON pr.id = b.user_id        <-- INNER
--     WHERE b.open_to_swap AND p.status = 'CNF' AND NOT p.is_child_no_berth;
--
-- and `get_matches()` (migration #2) is a bare `SELECT * FROM public.match_cards`
-- narrowed on train/date/class. An INNER JOIN on `profiles` means a booking
-- whose owner has no `profiles` row is not ranked lower or filtered later — it
-- is INVISIBLE to the only path cross-user matching has. So the whole feature
-- rests on one row existing, and part 1's own comment says where it comes from:
--
--     -- profiles: one row per signed-in user. ... Created on first Google
--     -- sign-in; anonymous trips stay on the device until then (docs/08).
--     (app/supabase/schema.part1.sql:33-35)
--
-- (2) `settings` — the acceptor filters, and the operator's pause switch.
-- `server/admin.ts:155` pauses an acceptor with an UPDATE on `settings`
-- (`{ table: 'settings', key: 'user_id', patch: { paused: true } }`). An UPDATE
-- matching no row affects 0 rows and returns NO ERROR through the Supabase
-- client, so with no `settings` row "pause this acceptor" is an operator action
-- that reports success and does nothing.
--
-- Nothing implemented either. Verified 2026-10-06 by execution against
-- PostgreSQL 18.3 (PGlite), not by reading:
--   * zero triggers on auth.users — the 7 triggers in this schema are
--     touch_updated_at on settings/swap_requests/payments/disputes, the two
--     swap transition guards, and messages_safety_guard. None is on a user
--     insert. (Enumerated from pg_trigger, because `grep "CREATE TRIGGER\|…"`
--     returns nothing under BSD BRE — `\|` is a literal pipe — which reads as
--     "there are no triggers" when there are seven.)
--   * zero function bodies in `public` write to either table.
--   * the only writer in the repo is seed.sql, and it writes both for two
--     hardcoded demo uuids. Which is exactly why this is invisible in demo data
--     and would bite every real traveller.
--   * `profiles_self_write` and `settings_owner` grant the INSERT rights —
--     `WITH CHECK (id/user_id = auth.uid())` — so rights exist that nothing
--     exercises.
--   * the decisive experiment for (1): a fixture matching rls-live.test.ts's
--     beforeAll returned **0 rows** from get_matches() with no profiles rows and
--     **2 rows** after adding only those rows. A second fixture showed it is per
--     row, not global: user C (booking, no profile) invisible, user D (booking +
--     profile) visible, and C appearing the moment its profile did.
--   * the decisive experiment for (2): a new user got 0 settings rows; the pause
--     UPDATE affected **0 rows** with no error; the identical UPDATE against a
--     row that exists affected **1 row** and set `paused = true`.
--
-- WHY A TRIGGER AND NOT A CLIENT INSERT. The client is one of several ways a
-- user can appear: Google sign-in, a dashboard-created user, an admin-created
-- user, a future invite flow. A client insert covers only the paths someone
-- remembered to wire, and it fails silently when it fails — offline, mid-flight
-- RLS, a dropped request — leaving exactly the invisible-user state this
-- migration removes. A trigger makes "a user with no rows" unrepresentable,
-- which is the same move L7 made when AdminOverviewInput took the ledger
-- instead of a pre-summed number. It is also Supabase's documented pattern.
--
-- WHY BOTH ROWS IN ONE MIGRATION. They are one root cause with two symptoms,
-- and the second was found by asking whether the first had a sibling. Splitting
-- them would mean a second migration for the same line of reasoning, and would
-- ship a known-identical bug next to its own fix — which is the failure this
-- repo documents repeatedly (design 17's panel built twice; the activity table
-- whose comment and code disagreed for three days). One trigger, both rows, one
-- topic.
--
-- WHY THE `settings` INSERT NAMES ONLY `user_id`. Every other column carries
-- its default in the table definition (`women_only`/`families_only`/
-- `same_coach_only`/`paused`/`notify_push` false, `max_requests_per_day` 3).
-- Restating a default here would be a second copy of it, free to drift from the
-- one the table owns — the same trap migration #2's header records. A guard
-- asserts the column list stays exactly `(user_id)`.
--
-- WHY THERE IS NO BACKFILL, so a reader does not think it was forgotten.
-- There is nothing to backfill: both Supabase projects are uncreated
-- (docs/12 §4 records both refs as "— none yet") and every table holds zero
-- rows. A backfill here would be unexercised code shipped against a state that
-- does not exist. And it could not reuse the name derivation below without
-- copying it, which migration #2's own header forbids in as many words ("Do not
-- reintroduce a second copy of any expression that also appears in the SQL").
-- The day a database exists with users in it, the backfill is one INSERT ...
-- SELECT ... WHERE NOT EXISTS per table, and the live suite below will say so by
-- failing.
--
-- NAME DERIVATION, AND WHY IT IS THIS SMALL. Rule 13 says other travellers see
-- "first name + initial", so a profile row with empty strings would make the
-- match card unusable — the row must be created WITH a name or the fix is only
-- half of one. Google supplies `full_name` (and sometimes `name`) in
-- raw_user_meta_data. First whitespace token becomes first_name, and the first
-- letter of the last token becomes last_initial — never the surname itself, and
-- never more than one letter, so the stored value cannot leak more than rule 13
-- allows even if the provider hands us a full legal name. Lengths are capped
-- because this is caller-influenced data from an external identity provider.
-- `gender` is deliberately left NULL: Google does not reliably supply it, and
-- inferring it from a name would be inventing personal data.
--
-- OPEN QUESTION, NAMED RATHER THAN ASSUMED (the migration #2 discipline). This
-- file has been executed against PostgreSQL 18.3, but against a LOCAL STUB of
-- auth.users owned by the connecting role. On Supabase, `auth.users` belongs to
-- `supabase_auth_admin`, and this migration assumes the role that runs it may
-- create a trigger on that table — which is what every Supabase `handle_new_user`
-- recipe does from the dashboard SQL editor, but which is a privilege fact about
-- Supabase that no test here can prove. If `supabase db push` reports
-- "must be owner of relation users", that is this line and not a typo: apply the
-- trigger from the dashboard SQL editor, or grant the migration role the
-- membership it needs. The live suite's "a new sign-up gets its own rows" test
-- fails loudly if the trigger did not take.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name    text;
  v_parts   text[];
  v_first   text;
  v_initial text;
BEGIN
  v_name := nullif(
    trim(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    )),
    ''
  );

  v_parts := CASE
    WHEN v_name IS NULL THEN '{}'::text[]
    ELSE regexp_split_to_array(v_name, '\s+')
  END;

  v_first := left(coalesce(v_parts[1], ''), 40);

  v_initial := CASE
    WHEN coalesce(array_length(v_parts, 1), 0) > 1
      THEN upper(left(v_parts[array_length(v_parts, 1)], 1))
    ELSE ''
  END;

  /* ON CONFLICT DO NOTHING, not DO UPDATE: this fires on INSERT only, so the
     conflict arm is unreachable in normal operation. It is here because the
     cost of being wrong is a failed sign-up — a trigger that raises on
     auth.users turns a duplicate into "you cannot log in", which is a far
     worse outcome than a profile row that is one sign-in stale. The same
     reasoning covers both inserts. */
  INSERT INTO public.profiles (id, first_name, last_initial)
  VALUES (new.id, v_first, v_initial)
  ON CONFLICT (id) DO NOTHING;

  /* Every column but user_id takes its default from the table definition. Do
     not name one here: a default restated is a default that can drift. */
  INSERT INTO public.settings (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

/* Trigger functions are invoked by the trigger, not by callers: EXECUTE is
   checked when the trigger is created, not when it fires. So the function is
   revoked from PUBLIC and granted to nobody. The `SET search_path` above stops
   a caller-controlled search_path from resolving `profiles` or `settings` to
   something else inside a SECURITY DEFINER body, which is the same guard
   migrations #2 and #3 carry and the same reason. */
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- NOT IN THIS FILE, deliberately:
--
--   * A backfill of existing auth.users rows. See the header: there is no
--     database with users in it, and the version that could exist would have
--     to duplicate the name derivation above.
--
--   * A change to `match_cards`'s INNER JOIN. Making it a LEFT JOIN would
--     make a missing profile degrade to a blank name instead of an invisible
--     traveller, which is tempting — but it would also hide the absence this
--     migration removes, and rule 13 requires a name on a match card. The
--     invariant is fixed at its source instead. If a future census finds a
--     user with no profile row anyway, that is a bug in this trigger and the
--     live suite should fail on it rather than the view quietly papering over
--     it.
--
--   * A writer for the other per-user tables. `wallet_tx` is a ledger that
--     starts empty by design, `push_subscriptions` is written on subscribe
--     (`lib/push.ts`), and `user_roles` is an admin grant. `profiles` and
--     `settings` were the two that hold a row per user from the moment they
--     exist, which is what makes their absence a defect rather than a state.
-- ---------------------------------------------------------------------
