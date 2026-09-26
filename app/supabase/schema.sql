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
-- =====================================================================
-- SeatSwap schema, part 2: bookings, passengers, groups, requests, offers
-- =====================================================================

-- ---------------------------------------------------------------------
-- bookings: one row per PNR added. Only pnr_hash (SHA-256 + server salt)
-- and pnr_last4 are stored — never the full PNR in plain text (docs/08).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  pnr_hash text NOT NULL,
  pnr_last4 text NOT NULL CHECK (pnr_last4 ~ '^[0-9]{4}$'),
  train_no text NOT NULL,
  train_name text NOT NULL DEFAULT '',
  journey_date date NOT NULL,
  from_code text NOT NULL DEFAULT '',
  to_code text NOT NULL DEFAULT '',
  class travel_class NOT NULL,
  is_chair_car boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'sms_paste')),
  chart_prepared boolean NOT NULL DEFAULT false,
  open_to_swap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pnr_hash)
);
CREATE INDEX IF NOT EXISTS bookings_train_date_class_idx ON public.bookings (train_no, journey_date, class);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON public.bookings (user_id);

-- ---------------------------------------------------------------------
-- passengers: one row per traveller on a booking. A child without a berth
-- counts in the group but is never offered for a swap (docs/04-A step 4).
-- berth_no of the other party is readable only once locked (see policies).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Passenger 1',
  coach text,
  berth_no text,
  berth_type berth_type NOT NULL,
  status ticket_status NOT NULL DEFAULT 'CNF',
  quota quota NOT NULL DEFAULT 'GN',
  is_child_no_berth boolean NOT NULL DEFAULT false,
  board_code text,
  drop_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passengers_booking_idx ON public.passengers (booking_id);

-- ---------------------------------------------------------------------
-- group_trips + group_members: linked family PNRs, one organiser (docs/04-C).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.group_members (
  group_id uuid NOT NULL REFERENCES public.group_trips (id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, booking_id)
);

-- ---------------------------------------------------------------------
-- swap_requests: a ranked ask (1st/2nd/3rd berth choice) on own booking.
-- Sending is free; the requester pays Rs 99 only after someone accepts
-- (AGENTS.md rules 1-2). Lifecycle: docs/03 (draft -> searching ->
-- accepted_awaiting_payment -> locked -> confirmed | voided | disputed).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  passenger_ids uuid[] NOT NULL DEFAULT '{}',
  group_id uuid REFERENCES public.group_trips (id) ON DELETE SET NULL,
  choices berth_type[] NOT NULL DEFAULT '{}',
  same_coach boolean NOT NULL DEFAULT false,
  keep_together boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '',
  status request_status NOT NULL DEFAULT 'draft',
  locked_offer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swap_requests_choices_len CHECK (coalesce(array_length(choices, 1), 0) BETWEEN 1 AND 3)
);
CREATE INDEX IF NOT EXISTS swap_requests_requester_idx ON public.swap_requests (requester_id);
CREATE INDEX IF NOT EXISTS swap_requests_status_idx ON public.swap_requests (status);

-- ---------------------------------------------------------------------
-- swap_offers: one row per acceptor a request was sent to. sent -> accepted
-- | declined | expired; when another offer on the same request is paid, the
-- rest become superseded ("Someone else was faster", docs/03).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.swap_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.swap_requests (id) ON DELETE CASCADE,
  acceptor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  acceptor_booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  acceptor_passenger_id uuid NOT NULL REFERENCES public.passengers (id) ON DELETE CASCADE,
  matched_choice_rank int NOT NULL CHECK (matched_choice_rank BETWEEN 1 AND 3),
  status offer_status NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS swap_offers_request_idx ON public.swap_offers (request_id);
CREATE INDEX IF NOT EXISTS swap_offers_acceptor_idx ON public.swap_offers (acceptor_id);

-- Deferred FK: requests <-> offers form a lock cycle (paid offer wins).
ALTER TABLE public.swap_requests ADD CONSTRAINT swap_requests_locked_offer_fk FOREIGN KEY (locked_offer_id) REFERENCES public.swap_offers (id) ON DELETE SET NULL;
-- =====================================================================
-- SeatSwap schema, part 3: payments, receipts, wallet, confirmations, disputes
-- Money is ALWAYS integer paise: Rs 99 = 9900 (Rs 49 fee + Rs 50 credit).
-- =====================================================================

-- ---------------------------------------------------------------------
-- payments: created after an acceptance, paid locks the swap (docs/03).
-- provider 'credit' when credit covers the full Rs 99. The gateway webhook
-- (service_role) is the source of truth for paid/failed; failed means the
-- bank returns any debit in 3-5 days and nothing is charged here.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.swap_requests (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider pay_provider NOT NULL,
  provider_ref text,
  amount_paise int NOT NULL CHECK (amount_paise >= 0),
  credit_used_paise int NOT NULL DEFAULT 0 CHECK (credit_used_paise >= 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status pay_status NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_request_idx ON public.payments (request_id);
CREATE INDEX IF NOT EXISTS payments_payer_idx ON public.payments (payer_id);

-- ---------------------------------------------------------------------
-- receipts: one receipt per payment, shown on the Swap summary card.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments (id) ON DELETE CASCADE,
  number text NOT NULL UNIQUE,
  pdf_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- wallet_tx: signed credit ledger (docs/03 money outcomes). balance = sum of
-- unexpired rows. Credit lowers future fees only: never cash, never moved
-- out (family trips excepted), expires 12 months after earned. Starts empty:
-- nothing is granted for signing up, adding a PNR or being open to swap.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_tx (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  amount_paise int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('acceptor_credit', 'swap_to_credit', 'used', 'expired', 'admin_adjust')),
  ref_request_id uuid REFERENCES public.swap_requests (id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON public.wallet_tx (user_id);

-- ---------------------------------------------------------------------
-- confirmations: both sides answer "Did you swap?" (docs/04-A step 13).
-- Differing answers open a dispute; money is held meanwhile.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.confirmations (
  request_id uuid NOT NULL REFERENCES public.swap_requests (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  outcome outcome NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);

-- ---------------------------------------------------------------------
-- disputes: staff-only rows (docs/02 visibility). Parties follow progress
-- through the request status + Updates; copy promises no fixed timeline.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.swap_requests (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text,
  admin_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- =====================================================================
-- SeatSwap schema, part 4: chats, messages, reports, blocks,
-- notifications, push subscriptions, activity_log, updated_at trigger
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.swap_requests (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  flagged_risky boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON public.messages (chat_id, created_at);

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.swap_requests (id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_no_self CHECK (reporter_id <> reported_id)
);

CREATE TABLE IF NOT EXISTS public.blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------
-- notifications: the in-app Updates list (free channel alongside web push).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  keys jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint)
);

-- ---------------------------------------------------------------------
-- activity_log: EVERY state change writes here (AGENTS.md). Staff-only to
-- read; admin console exports CSV (docs/04-D).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_role text NOT NULL DEFAULT 'user' CHECK (actor_role IN ('user', 'admin', 'support')),
  action text NOT NULL,
  entity text,
  entity_id uuid,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_action_idx ON public.activity_log (action, created_at);
CREATE INDEX IF NOT EXISTS activity_log_actor_idx ON public.activity_log (actor_id, created_at);

-- Keep updated_at fresh on user-edited rows.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_touch ON public.settings;
CREATE TRIGGER settings_touch BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS swap_requests_touch ON public.swap_requests;
CREATE TRIGGER swap_requests_touch BEFORE UPDATE ON public.swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS payments_touch ON public.payments;
CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS disputes_touch ON public.disputes;
CREATE TRIGGER disputes_touch BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
-- =====================================================================
-- SeatSwap schema, part 5a: RLS on + helpers + policies (profiles, roles,
-- settings, bookings, passengers, groups). Continued in part5a2 + part5b.
-- Visibility rules (docs/02): no other user's PNR hash, names beyond first
-- name + initial, phone or email is ever readable; berth_no of the other
-- party opens only once the request is locked (or later).
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_tx ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Parties of a request: requester + every acceptor.
CREATE OR REPLACE FUNCTION public.is_request_party(req_id uuid, uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.swap_requests WHERE id = req_id AND requester_id = uid) OR EXISTS (SELECT 1 FROM public.swap_offers WHERE request_id = req_id AND acceptor_id = uid); $$;
REVOKE ALL ON FUNCTION public.is_request_party(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_request_party(uuid, uuid) TO authenticated, service_role;

-- Staff check for the admin console (guarded server-side via has_role).
CREATE OR REPLACE FUNCTION public.is_staff(uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT public.has_role(uid, 'admin') OR public.has_role(uid, 'support'); $$;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- profiles: self read/write; match cards read first name + initial only
-- (column masking to first_name/last_initial happens in server functions).
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_self_write ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_match_read ON public.profiles FOR SELECT TO authenticated USING (true);

-- user_roles: never checked on the client; staff read via helpers.
CREATE POLICY user_roles_staff_read ON public.user_roles FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- settings: acceptor filters, owner only.
CREATE POLICY settings_owner ON public.settings FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- bookings: owners manage own rows; others read trip fields for matching
-- but NEVER pnr_hash (column grants in part 6 revoke it from others).
CREATE POLICY bookings_owner ON public.bookings FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY bookings_match_read ON public.bookings FOR SELECT TO authenticated USING (user_id <> auth.uid());
-- Part 5a continued: passengers, groups, requests, offers policies.

-- passengers: owners manage own rows; open trips are match-readable.
-- berth_no of the other party is split by column grants (part 6).
CREATE POLICY passengers_owner ON public.passengers FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()));
CREATE POLICY passengers_match_read ON public.passengers FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id <> auth.uid() AND b.open_to_swap));

-- group trips: organiser owns; members readable by organiser or booking owner.
CREATE POLICY group_trips_owner ON public.group_trips FOR ALL TO authenticated USING (organiser_id = auth.uid()) WITH CHECK (organiser_id = auth.uid());
CREATE POLICY group_members_read ON public.group_members FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.group_trips g WHERE g.id = group_id AND g.organiser_id = auth.uid()) OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()));
CREATE POLICY group_members_owner_write ON public.group_members FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.group_trips g WHERE g.id = group_id AND g.organiser_id = auth.uid()));
CREATE POLICY group_members_owner_delete ON public.group_members FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.group_trips g WHERE g.id = group_id AND g.organiser_id = auth.uid()));

-- swap requests: requester manages; acceptors read their rows; searching
-- rows are list-readable (server functions mask to first name + initial).
CREATE POLICY swap_requests_owner ON public.swap_requests FOR ALL TO authenticated USING (requester_id = auth.uid()) WITH CHECK (requester_id = auth.uid());
CREATE POLICY swap_requests_party_read ON public.swap_requests FOR SELECT TO authenticated USING (public.is_request_party(id, auth.uid()));
CREATE POLICY swap_requests_searching_read ON public.swap_requests FOR SELECT TO authenticated USING (status = 'searching');

-- swap offers: requester reads offers on own requests; acceptor owns own.
CREATE POLICY swap_offers_requester ON public.swap_offers FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.swap_requests r WHERE r.id = request_id AND r.requester_id = auth.uid()));
CREATE POLICY swap_offers_acceptor ON public.swap_offers FOR ALL TO authenticated USING (acceptor_id = auth.uid()) WITH CHECK (acceptor_id = auth.uid());
-- =====================================================================
-- SeatSwap schema, part 5b: RLS policies (money, confirmations, disputes,
-- chat, safety, updates, activity log)
-- =====================================================================

-- ---------------------------------------------------------------- payments
-- Self-only (docs/02). Parties read the rows on their own requests so both
-- sides can follow "waiting for payment" vs "paid" (never amounts of others:
-- server functions only reveal status + own rows).
CREATE POLICY payments_payer ON public.payments
  FOR ALL TO authenticated USING (payer_id = auth.uid()) WITH CHECK (payer_id = auth.uid());
CREATE POLICY payments_party_read ON public.payments
  FOR SELECT TO authenticated USING (public.is_request_party(request_id, auth.uid()));

-- ---------------------------------------------------------------- receipts
CREATE POLICY receipts_payer ON public.receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_id AND p.payer_id = auth.uid()
    )
  );

-- ------------------------------------------------------------ wallet (credit)
-- Ledger rows are written ONLY by server functions and webhooks (service_role,
-- which bypasses RLS). There is deliberately NO authenticated INSERT policy:
-- with `WITH CHECK (user_id = auth.uid())` a passenger could insert
-- amount_paise = 99999999 kind = 'acceptor_credit' and mint unlimited credit,
-- breaking rules 3-6 outright. Rules 3-6 are enforced by the writers, not by
-- trusting the client (docs/08). Clients keep SELECT only, so the Profile
-- wallet still renders.
CREATE POLICY wallet_owner_read ON public.wallet_tx
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ------------------------------------------------------------ confirmations
-- Each party writes only their own answer; both answers are visible to both
-- parties once written (docs/04-A step 13).
CREATE POLICY confirmations_party_read ON public.confirmations
  FOR SELECT TO authenticated USING (public.is_request_party(request_id, auth.uid()));
CREATE POLICY confirmations_self_write ON public.confirmations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------- disputes
-- Staff only (docs/02 visibility). Parties follow progress via the request
-- status + Updates list, never the dispute row itself.
CREATE POLICY disputes_staff ON public.disputes
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------------------------------------------------- chats
-- One chat per request; only the two parties read or write.
CREATE POLICY chats_party_read ON public.chats
  FOR SELECT TO authenticated USING (public.is_request_party(id, auth.uid()));
CREATE POLICY messages_party_read ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND public.is_request_party(c.request_id, auth.uid()))
  );
CREATE POLICY messages_party_write ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND public.is_request_party(c.request_id, auth.uid()))
  );

-- ------------------------------------------------------------------ safety
CREATE POLICY reports_reporter ON public.reports
  FOR SELECT TO authenticated USING (reporter_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY reports_reporter_write ON public.reports
  FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
CREATE POLICY reports_staff_update ON public.reports
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY blocks_owner ON public.blocks
  FOR ALL TO authenticated USING (blocker_id = auth.uid()) WITH CHECK (blocker_id = auth.uid());
-- So matching can exclude both directions, each user reads rows naming them.
CREATE POLICY blocks_named_read ON public.blocks
  FOR SELECT TO authenticated USING (blocker_id = auth.uid() OR blocked_id = auth.uid());

-- ------------------------------------------------------ updates + web push
-- Self-only: the in-app Updates list and push subscriptions.
CREATE POLICY notifications_owner_read ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notifications_owner_update ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY push_subs_owner ON public.push_subscriptions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- -------------------------------------------------------------- activity log
-- Staff only (docs/02 visibility). Every state change writes here through
-- server functions running with the caller's rights; staff read + export.
CREATE POLICY activity_staff_read ON public.activity_log
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY activity_writer ON public.activity_log
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());
-- Part 6a: explicit GRANTs (first half). Every table has RLS on (part 5);
-- grants below give the anon/authenticated roles only what the policies need.
-- service_role (webhooks, scheduled jobs) keeps full access and bypasses RLS.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- profiles: signed-in users read match cards + manage own row.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

-- user_roles: never checked on the client; staff-only rows via policy.
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

-- settings: owner-only via policy.
REVOKE ALL ON TABLE public.settings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.settings TO authenticated;
GRANT ALL ON TABLE public.settings TO service_role;

-- bookings: owner + match-list reads via policy (pnr_hash never readable
-- by others: server functions select it only for the owner).
REVOKE ALL ON TABLE public.bookings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bookings TO authenticated;
GRANT ALL ON TABLE public.bookings TO service_role;

-- passengers: owner + match reads via policy; berth_no of the other party
-- is revealed only once locked (server functions mask until then).
REVOKE ALL ON TABLE public.passengers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passengers TO authenticated;
GRANT ALL ON TABLE public.passengers TO service_role;

-- groups: organiser-owned via policy.
REVOKE ALL ON TABLE public.group_trips FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_trips TO authenticated;
GRANT ALL ON TABLE public.group_trips TO service_role;
REVOKE ALL ON TABLE public.group_members FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.group_members TO authenticated;
GRANT ALL ON TABLE public.group_members TO service_role;

-- requests + offers: parties-only via policy.
REVOKE ALL ON TABLE public.swap_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.swap_requests TO authenticated;
GRANT ALL ON TABLE public.swap_requests TO service_role;
REVOKE ALL ON TABLE public.swap_offers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.swap_offers TO authenticated;
GRANT ALL ON TABLE public.swap_offers TO service_role;
-- Part 6b: explicit GRANTs (second half) + function grants.

-- payments + receipts + wallet: self-only via policy.
REVOKE ALL ON TABLE public.payments FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;
REVOKE ALL ON TABLE public.receipts FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.receipts TO authenticated;
GRANT ALL ON TABLE public.receipts TO service_role;
REVOKE ALL ON TABLE public.wallet_tx FROM PUBLIC, anon;
-- SELECT only: credit is minted by service_role writers, never by the client.
GRANT SELECT ON TABLE public.wallet_tx TO authenticated;
GRANT ALL ON TABLE public.wallet_tx TO service_role;

-- confirmations: parties read, self writes.
REVOKE ALL ON TABLE public.confirmations FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.confirmations TO authenticated;
GRANT ALL ON TABLE public.confirmations TO service_role;

-- disputes + activity log: staff only (never checked on the client).
REVOKE ALL ON TABLE public.disputes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.disputes TO authenticated;
GRANT ALL ON TABLE public.disputes TO service_role;
REVOKE ALL ON TABLE public.activity_log FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.activity_log TO authenticated;
GRANT ALL ON TABLE public.activity_log TO service_role;

-- chats + messages: parties only.
REVOKE ALL ON TABLE public.chats FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.chats TO authenticated;
GRANT ALL ON TABLE public.chats TO service_role;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

-- reports + blocks: reporter/owner + staff via policy.
REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.reports TO authenticated;
GRANT ALL ON TABLE public.reports TO service_role;
REVOKE ALL ON TABLE public.blocks FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.blocks TO authenticated;
GRANT ALL ON TABLE public.blocks TO service_role;

-- notifications: self-only; push subscriptions: owner-only.
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

-- Sequences used by uuid defaults need no grants (gen_random_uuid takes no
-- sequence), but keep search_path helpers executable as declared in part 1/5.
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO authenticated, service_role;
