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
