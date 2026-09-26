-- =====================================================================
-- SeatSwap — full backend schema, part 1: enums, profiles, roles, settings
-- (docs/02-DATA-MODEL.md, AGENTS.md).
--
-- Apply once on a fresh database:
--   psql "$DATABASE_URL" -f app/supabase/schema.sql
-- (this file is assembled from supabase/schema.part*.sql; do not edit parts
-- after release — add a new migration instead.)
--
-- Money is ALWAYS integer paise (Rs 99 = 9900). Every state change writes
-- an activity_log row. RLS is ON on every table with explicit GRANTs.
-- Privacy: no table exposes another user's PNR, full name, phone, email or
-- ticket photo. Exact berth numbers open to the other party only once a
-- request is locked (see the passengers policies + server functions, which
-- mask berths until then). Tables mirror app/src/lib/store.ts shapes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums (docs/02). Values are fixed by the product spec; never rename.
-- ---------------------------------------------------------------------
CREATE TYPE app_role AS ENUM ('admin', 'support', 'user');
CREATE TYPE travel_class AS ENUM ('1A', '2A', '3A', '3E', 'SL', 'CC', 'EC', '2S');
CREATE TYPE berth_type AS ENUM ('LB', 'MB', 'UB', 'SL', 'SU', 'WINDOW', 'AISLE', 'MIDDLE_SEAT');
CREATE TYPE ticket_status AS ENUM ('CNF', 'RAC', 'WL', 'CAN');
CREATE TYPE quota AS ENUM ('GN', 'SS', 'LD', 'HP', 'TQ', 'PT', 'OTHER');
CREATE TYPE request_status AS ENUM ('draft', 'searching', 'accepted_awaiting_payment', 'locked', 'confirmed', 'voided', 'disputed', 'expired', 'withdrawn');
CREATE TYPE offer_status AS ENUM ('sent', 'accepted', 'declined', 'superseded', 'expired');
CREATE TYPE outcome AS ENUM ('swapped', 'no_show', 'not_possible', 'changed_mind');
CREATE TYPE pay_provider AS ENUM ('razorpay', 'paypal', 'credit');
CREATE TYPE pay_status AS ENUM ('created', 'pending', 'paid', 'failed');

-- ---------------------------------------------------------------------
-- profiles: one row per signed-in user. Only first name + last initial are
-- ever shown to other users (AGENTS.md rule 13). Created on first Google
-- sign-in; anonymous trips stay on the device until then (docs/08).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_initial text NOT NULL DEFAULT '',
  gender text,
  language text NOT NULL DEFAULT 'en',
  easy_mode boolean NOT NULL DEFAULT false,
  rating numeric NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- user_roles + has_role(): roles live apart from profiles and are never
-- checked on the client (AGENTS.md). SECURITY DEFINER so RLS policies can
-- call it without recursing into user_roles policies.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(uid uuid, wanted app_role)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = wanted);
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- settings: acceptor filters (docs/04-B acceptor step 2). paused hides the
-- user from matches; max_requests_per_day caps inbound requests (default 3).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  women_only boolean NOT NULL DEFAULT false,
  families_only boolean NOT NULL DEFAULT false,
  same_coach_only boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  max_requests_per_day int NOT NULL DEFAULT 3 CHECK (max_requests_per_day >= 0 AND max_requests_per_day <= 10),
  notify_push boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
