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
