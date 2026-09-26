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

-- ------------------------------------------------------------------ wallet
-- Self-only ledger; inserts happen through server functions / webhooks.
CREATE POLICY wallet_owner_read ON public.wallet_tx
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY wallet_owner_insert ON public.wallet_tx
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

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
