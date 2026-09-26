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
