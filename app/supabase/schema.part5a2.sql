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
