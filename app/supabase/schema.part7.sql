-- =====================================================================
-- SeatSwap schema, part 7: hardening (privacy, money, transitions, safety).
-- docs/02 visibility + docs/03 state machines + docs/06 payments, enforced
-- in the database so a misbehaving client cannot bypass the server:
--  - match reads go through safe views (never raw PNR hashes / berth_nos)
--  - payments move created -> pending -> paid|failed via webhook only
--  - wallet amounts/expiry are constrained per kind (rules 3-6)
--  - request/offer status jumps outside docs/03 are rejected by triggers
--  - confirmations + chat creation are parties-only
--  - risky chat text is flagged and senders are rate-limited server-side
-- =====================================================================

-- ---------------------------------------------------------------- payments
-- Payers create rows and read their own; status moves happen service-side
-- (webhook with service_role, which bypasses RLS). No client UPDATE means no
-- forged paid without a gateway (docs/06: webhook is the source of truth).
DROP POLICY IF EXISTS payments_payer ON public.payments;
CREATE POLICY payments_payer_read ON public.payments
  FOR SELECT TO authenticated USING (payer_id = auth.uid());
CREATE POLICY payments_payer_create ON public.payments
  FOR INSERT TO authenticated WITH CHECK (payer_id = auth.uid());
REVOKE UPDATE ON TABLE public.payments FROM authenticated;

-- Idempotency key for webhook replay (docs/06 section 5).
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_uidx
  ON public.payments (provider_ref) WHERE provider_ref IS NOT NULL;

-- ------------------------------------------------------- match-safe views
-- Raw match policies exposed whole rows (pnr_hash, berth_no, profile fields)
-- to any signed-in user. They are replaced by two narrow views:
-- match_cards (open trips, safe columns only) and locked_berths (exact berth
-- numbers, visible only to the two parties of a locked+ request, rule 13).
DROP POLICY IF EXISTS profiles_match_read ON public.profiles;
DROP POLICY IF EXISTS bookings_match_read ON public.bookings;
DROP POLICY IF EXISTS passengers_match_read ON public.passengers;

CREATE OR REPLACE VIEW public.match_cards WITH (security_invoker = true) AS
  SELECT b.id AS booking_id, b.train_no, b.train_name, b.journey_date,
    b.from_code, b.to_code, b.class, b.is_chair_car,
    p.id AS passenger_id, p.label, p.coach, p.berth_type, p.status, p.quota,
    pr.first_name, pr.last_initial
  FROM public.bookings b
  JOIN public.passengers p ON p.booking_id = b.id
  JOIN public.profiles pr ON pr.id = b.user_id
  WHERE b.open_to_swap AND p.status = 'CNF' AND NOT p.is_child_no_berth;
REVOKE ALL ON TABLE public.match_cards FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.match_cards TO authenticated;

CREATE OR REPLACE VIEW public.locked_berths WITH (security_invoker = true) AS
  SELECT r.id AS request_id, p.booking_id, p.id AS passenger_id,
    p.coach, p.berth_no
  FROM public.swap_requests r
  JOIN public.swap_offers o ON o.id = r.locked_offer_id
  JOIN public.passengers p
    ON p.booking_id = r.booking_id OR p.booking_id = o.acceptor_booking_id
  WHERE r.status IN ('locked', 'confirmed', 'disputed')
    AND public.is_request_party(r.id, auth.uid());
REVOKE ALL ON TABLE public.locked_berths FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.locked_berths TO authenticated;

-- ---------------------------------------------------------------- wallet
-- Earning kinds carry fixed values and always expire 12 months out (rule 4).
-- 'used' rows are negative debits; 'expired'/'admin_adjust' are staff-shaped.
ALTER TABLE public.wallet_tx ALTER COLUMN expires_at
  SET DEFAULT (now() + interval '12 months');
ALTER TABLE public.wallet_tx ADD CONSTRAINT wallet_tx_amount_check CHECK (
  amount_paise <> 0 AND (
    (kind IN ('acceptor_credit', 'swap_to_credit') AND amount_paise IN (5000, 9900))
    -- Unused group cover converts at the full ₹199 (docs/01, pay.groupUnder).
    OR (kind = 'swap_to_credit' AND amount_paise = 19900)
    OR (kind = 'used' AND amount_paise < 0)
    OR (kind IN ('expired', 'admin_adjust'))
  )
);
ALTER TABLE public.wallet_tx ADD CONSTRAINT wallet_tx_expiry_check CHECK (
  (kind IN ('acceptor_credit', 'swap_to_credit') AND expires_at IS NOT NULL)
  OR (kind IN ('used', 'expired', 'admin_adjust'))
);

-- -------------------------------------------- request/offer transitions
-- Clients keep SELECT/INSERT/UPDATE but no DELETE; jumps outside docs/03 are
-- rejected even for service_role writers (webhooks/admin must follow the
-- same machine: accepted_awaiting_payment -> locked needs a real payment).
REVOKE DELETE ON TABLE public.swap_requests FROM authenticated;
REVOKE DELETE ON TABLE public.swap_offers FROM authenticated;

-- Rule 2 (docs/03): a swap locks because money landed, never because a
-- client asked. True when a CAPTURED payment exists for this request, or when
-- a captured group payment covers it (docs/01: the Rs 199 bundle locks up to
-- 3 member swaps, and those member swaps have no payment row of their own).
CREATE OR REPLACE FUNCTION public.has_captured_payment(p_req uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payments pay
    WHERE pay.status = 'paid'
      AND ( pay.request_id = p_req
            OR (pay.group_id IS NOT NULL
                AND pay.group_id = (SELECT r.group_id FROM public.swap_requests r WHERE r.id = p_req)) )
  );
$$;
REVOKE ALL ON FUNCTION public.has_captured_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_captured_payment(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_swap_request_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF OLD.status = 'accepted_awaiting_payment' AND NEW.status = 'locked'
    AND NOT public.has_captured_payment(OLD.id) THEN
    RAISE EXCEPTION 'payment_required_for_lock';
  END IF;
  IF NEW.status = 'expired'
    AND OLD.status IN ('draft', 'searching', 'accepted_awaiting_payment') THEN
    RETURN NEW;
  END IF;
  CASE OLD.status
    WHEN 'draft' THEN
      IF NEW.status NOT IN ('searching', 'withdrawn') THEN
        RAISE EXCEPTION 'bad_request_transition % -> %', OLD.status, NEW.status;
      END IF;
    WHEN 'searching' THEN
      IF NEW.status NOT IN ('accepted_awaiting_payment', 'withdrawn', 'expired') THEN
        RAISE EXCEPTION 'bad_request_transition % -> %', OLD.status, NEW.status;
      END IF;
    WHEN 'accepted_awaiting_payment' THEN
      IF NEW.status NOT IN ('locked', 'searching', 'withdrawn', 'expired') THEN
        RAISE EXCEPTION 'bad_request_transition % -> %', OLD.status, NEW.status;
      END IF;
    WHEN 'locked' THEN
      IF NEW.status NOT IN ('confirmed', 'voided', 'disputed') THEN
        RAISE EXCEPTION 'bad_request_transition % -> %', OLD.status, NEW.status;
      END IF;
    WHEN 'disputed' THEN
      IF NEW.status NOT IN ('confirmed', 'voided') THEN
        RAISE EXCEPTION 'bad_request_transition % -> %', OLD.status, NEW.status;
      END IF;
    ELSE
      RAISE EXCEPTION 'bad_request_transition % -> %', OLD.status, NEW.status;
  END CASE;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS swap_requests_transition_guard ON public.swap_requests;
CREATE TRIGGER swap_requests_transition_guard
  BEFORE UPDATE OF status ON public.swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.check_swap_request_transition();

CREATE OR REPLACE FUNCTION public.check_swap_offer_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  CASE OLD.status
    WHEN 'sent' THEN
      IF NEW.status NOT IN ('accepted', 'declined', 'expired', 'superseded') THEN
        RAISE EXCEPTION 'bad_offer_transition % -> %', OLD.status, NEW.status;
      END IF;
    WHEN 'accepted' THEN
      IF NEW.status NOT IN ('superseded', 'declined', 'expired') THEN
        RAISE EXCEPTION 'bad_offer_transition % -> %', OLD.status, NEW.status;
      END IF;
    ELSE
      RAISE EXCEPTION 'bad_offer_transition % -> %', OLD.status, NEW.status;
  END CASE;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS swap_offers_transition_guard ON public.swap_offers;
CREATE TRIGGER swap_offers_transition_guard
  BEFORE UPDATE OF status ON public.swap_offers
  FOR EACH ROW EXECUTE FUNCTION public.check_swap_offer_transition();

-- --------------------------------------- parties-only writes (confirm/chat)
DROP POLICY IF EXISTS confirmations_self_write ON public.confirmations;
CREATE POLICY confirmations_self_write ON public.confirmations
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND public.is_request_party(request_id, auth.uid())
  );

CREATE POLICY chats_party_create ON public.chats
  FOR INSERT TO authenticated WITH CHECK (public.is_request_party(request_id, auth.uid()));

-- ------------------------------------------------------- message safety
-- Mirrors lib/chat-guard.ts server-side (docs/04 A12, rule 15): cash / UPI
-- ids / phone numbers are flagged (UI hides them + warns), and senders past
-- 12 messages in 60 seconds are rejected until the window passes.
CREATE OR REPLACE FUNCTION public.check_message_safety()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  recent int;
BEGIN
  SELECT count(*) INTO recent FROM public.messages
    WHERE chat_id = NEW.chat_id AND sender_id = NEW.sender_id
      AND created_at > now() - interval '60 seconds';
  IF recent >= 12 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.text ~* '[a-z0-9._-]+@[a-z]+'
    OR NEW.text ~* '(^|[^0-9])\+?91[\s-]?[6-9][0-9]{9}([^0-9]|$)'
    OR NEW.text ~* '(^|[^0-9])[6-9][0-9]{9}([^0-9]|$)'
    OR NEW.text ~* '\y(cash|upi|gpay|phonepe|paytm|pay\s?me|send\s+(me\s+)?money|transfer|account\s*(no|number|detail)|ifsc|qr(\s*code)?|sell|buy|extra\s*(money|cash|charge|fee|payment))\y'
  THEN
    NEW.flagged_risky := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_safety_guard ON public.messages;
CREATE TRIGGER messages_safety_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.check_message_safety();

-- --------------------------------------- server-only status transitions
-- Owner UPDATE is revoked below: even a signed-in client cannot jump a
-- request or offer to another state directly (e.g. searching -> locked with
-- no payment). Status moves go through these SECURITY DEFINER functions,
-- which enforce the docs/03 machine exactly like the triggers do. Server
-- functions call them via RPC; the triggers stay as a second wall for
-- service_role writers (webhooks, jobs, admin).
CREATE OR REPLACE FUNCTION public.apply_request_transition(
  p_req uuid, p_status request_status, p_locked_offer uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old request_status;
  v_ok boolean := false;
BEGIN
  SELECT status INTO v_old FROM public.swap_requests WHERE id = p_req;
  IF v_old IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_old = p_status THEN
    UPDATE public.swap_requests SET locked_offer_id = COALESCE(p_locked_offer, locked_offer_id)
      WHERE id = p_req;
    RETURN;
  END IF;
  -- Without this a passenger calls the RPC with their own auth.uid(), lock a
  -- swap they never paid for, then confirm it and mint the acceptor's Rs 50
  -- from nothing. service_role writers (gateway webhooks, scheduled jobs) are
  -- trusted here, matching the forbidden check above.
  IF p_status = 'locked' AND v_old = 'accepted_awaiting_payment'
    AND auth.role() <> 'service_role'
    AND NOT public.has_captured_payment(p_req) THEN
    RAISE EXCEPTION 'payment_required_for_lock';
  END IF;
  IF p_status = 'expired'
    AND v_old IN ('draft', 'searching', 'accepted_awaiting_payment') THEN
    v_ok := true;
  ELSE
    CASE v_old
      WHEN 'draft' THEN v_ok := p_status IN ('searching', 'withdrawn');
      WHEN 'searching' THEN v_ok := p_status IN ('accepted_awaiting_payment', 'withdrawn', 'expired');
      WHEN 'accepted_awaiting_payment' THEN v_ok := p_status IN ('locked', 'searching', 'withdrawn', 'expired');
      WHEN 'locked' THEN v_ok := p_status IN ('confirmed', 'voided', 'disputed');
      WHEN 'disputed' THEN v_ok := p_status IN ('confirmed', 'voided');
      ELSE v_ok := false;
    END CASE;
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'bad_request_transition % -> %', v_old, p_status; END IF;
  UPDATE public.swap_requests
    SET status = p_status, locked_offer_id = COALESCE(p_locked_offer, locked_offer_id)
    WHERE id = p_req;
END $$;
REVOKE ALL ON FUNCTION public.apply_request_transition(uuid, request_status, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_request_transition(uuid, request_status, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_offer_transition(
  p_offer uuid, p_status offer_status, p_responded timestamptz DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old offer_status;
  v_ok boolean := false;
BEGIN
  SELECT status INTO v_old FROM public.swap_offers WHERE id = p_offer;
  IF v_old IS NULL THEN RAISE EXCEPTION 'offer_not_found'; END IF;
  IF v_old = p_status THEN RETURN; END IF;
  CASE v_old
    WHEN 'sent' THEN v_ok := p_status IN ('accepted', 'declined', 'expired', 'superseded');
    WHEN 'accepted' THEN v_ok := p_status IN ('superseded', 'declined', 'expired');
    ELSE v_ok := false;
  END CASE;
  IF NOT v_ok THEN RAISE EXCEPTION 'bad_offer_transition % -> %', v_old, p_status; END IF;
  UPDATE public.swap_offers
    SET status = p_status, responded_at = COALESCE(p_responded, responded_at)
    WHERE id = p_offer;
END $$;
REVOKE ALL ON FUNCTION public.apply_offer_transition(uuid, offer_status, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_offer_transition(uuid, offer_status, timestamptz) TO authenticated, service_role;

REVOKE UPDATE ON TABLE public.swap_requests FROM authenticated;
REVOKE UPDATE ON TABLE public.swap_offers FROM authenticated;

-- --------------------------------- transition RPC authorization (part 7b)
-- The machine alone is not enough: strangers must not move other people's
-- rows even along permitted edges. Both RPCs require party-or-staff, except for
-- service_role writers (webhooks, scheduled jobs), which carry no JWT user.
CREATE OR REPLACE FUNCTION public.apply_request_transition(
  p_req uuid, p_status request_status, p_locked_offer uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old request_status;
  v_ok boolean := false;
BEGIN
  IF auth.role() <> 'service_role'
    AND NOT public.is_request_party(p_req, auth.uid())
    AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT status INTO v_old FROM public.swap_requests WHERE id = p_req;
  IF v_old IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_old = p_status THEN
    UPDATE public.swap_requests SET locked_offer_id = COALESCE(p_locked_offer, locked_offer_id)
      WHERE id = p_req;
    RETURN;
  END IF;
  -- Without this a passenger calls the RPC with their own auth.uid(), lock a
  -- swap they never paid for, then confirm it and mint the acceptor's Rs 50
  -- from nothing. service_role writers (gateway webhooks, scheduled jobs) are
  -- trusted here, matching the forbidden check above.
  IF p_status = 'locked' AND v_old = 'accepted_awaiting_payment'
    AND auth.role() <> 'service_role'
    AND NOT public.has_captured_payment(p_req) THEN
    RAISE EXCEPTION 'payment_required_for_lock';
  END IF;
  IF p_status = 'expired'
    AND v_old IN ('draft', 'searching', 'accepted_awaiting_payment') THEN
    v_ok := true;
  ELSE
    CASE v_old
      WHEN 'draft' THEN v_ok := p_status IN ('searching', 'withdrawn');
      WHEN 'searching' THEN v_ok := p_status IN ('accepted_awaiting_payment', 'withdrawn', 'expired');
      WHEN 'accepted_awaiting_payment' THEN v_ok := p_status IN ('locked', 'searching', 'withdrawn', 'expired');
      WHEN 'locked' THEN v_ok := p_status IN ('confirmed', 'voided', 'disputed');
      WHEN 'disputed' THEN v_ok := p_status IN ('confirmed', 'voided');
      ELSE v_ok := false;
    END CASE;
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'bad_request_transition % -> %', v_old, p_status; END IF;
  UPDATE public.swap_requests
    SET status = p_status, locked_offer_id = COALESCE(p_locked_offer, locked_offer_id)
    WHERE id = p_req;
END $$;

CREATE OR REPLACE FUNCTION public.apply_offer_transition(
  p_offer uuid, p_status offer_status, p_responded timestamptz DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old offer_status;
  v_req uuid;
  v_ok boolean := false;
BEGIN
  SELECT status, request_id INTO v_old, v_req FROM public.swap_offers WHERE id = p_offer;
  IF v_old IS NULL THEN RAISE EXCEPTION 'offer_not_found'; END IF;
  IF auth.role() <> 'service_role'
    AND NOT public.is_request_party(v_req, auth.uid())
    AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_old = p_status THEN RETURN; END IF;
  CASE v_old
    WHEN 'sent' THEN v_ok := p_status IN ('accepted', 'declined', 'expired', 'superseded');
    WHEN 'accepted' THEN v_ok := p_status IN ('superseded', 'declined', 'expired');
    ELSE v_ok := false;
  END CASE;
  IF NOT v_ok THEN RAISE EXCEPTION 'bad_offer_transition % -> %', v_old, p_status; END IF;
  UPDATE public.swap_offers
    SET status = p_status, responded_at = COALESCE(p_responded, responded_at)
    WHERE id = p_offer;
END $$;

-- Admin pause/unpause ( reversible block, docs/04-D ). The RPC itself
-- demands the admin role, so the check lives in the database, not the app.
CREATE OR REPLACE FUNCTION public.admin_set_paused(p_target uuid, p_paused boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.settings (user_id, paused) VALUES (p_target, p_paused)
    ON CONFLICT (user_id) DO UPDATE SET paused = EXCLUDED.paused;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_paused(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_paused(uuid, boolean) TO authenticated, service_role;
