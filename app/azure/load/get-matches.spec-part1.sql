-- SeatSwap hot-train proposal — NOT APPLIED. Ultimate scale fix for lakhs.
-- Schema tests forbid drift (migration == schema.sql), so this lives in
-- app/azure/load/ until approved. Apply as ONE migration after review.
-- Problem: match_cards view scans + RLS on every swipe. 12951 + date + 3A
-- with 1500 open trips = full scan. Fix: partial indexes + paginated RPC.
-- 1. Hot-path partial indexes (only open trips enter the match pool).
CREATE INDEX IF NOT EXISTS bookings_hot_idx
  ON public.bookings (train_no, journey_date, class)
  WHERE open_to_swap = true;
CREATE INDEX IF NOT EXISTS passengers_open_idx
  ON public.passengers (booking_id)
  WHERE status = 'CNF' AND is_child_no_berth = false;
CREATE INDEX IF NOT EXISTS offers_request_status_idx
  ON public.swap_offers (request_id, status);
CREATE INDEX IF NOT EXISTS offers_acceptor_day_idx
  ON public.swap_offers (acceptor_id, created_at);
CREATE INDEX IF NOT EXISTS requests_searching_idx
  ON public.swap_requests (booking_id, status)
  WHERE status = 'searching';
CREATE INDEX IF NOT EXISTS activity_entity_idx
  ON public.activity_log (entity, entity_id, created_at DESC);
