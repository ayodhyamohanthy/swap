-- =====================================================================
-- SeatSwap demo seed (docs/02 privacy rules respected).
-- Two demo users share one train/date/class with one open trip each.
-- Only pnr_hash + pnr_last4 are stored; demo hashes are SHA-256 of
-- 'seatswap-v1:<pnr>' matching app/src/lib/pnr.ts.
--
-- HOW TO USE: Supabase Auth owns auth.users, so SQL cannot invent users.
-- 1. Create two users (Google sign-in once each, or dashboard Auth users).
-- 2. Replace DEMO_A_ID / DEMO_B_ID below with their real auth uuids.
-- 3. Apply: psql "$DATABASE_URL" -f app/supabase/seed.sql
-- The file is idempotent (re-runnable) and inserts nothing when the ids
-- below are still the zero placeholders.
-- =====================================================================

-- Replace these two constants with real auth.users ids.
-- \set DEMO_A '''11111111-1111-1111-1111-111111111111'''
-- \set DEMO_B '''22222222-2222-2222-2222-222222222222'''

BEGIN;

-- Profiles for the two demo travellers (first name + initial only).
INSERT INTO public.profiles (id, first_name, last_initial, language, rating)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Priya', 'S', 'en', 4.5),
  ('22222222-2222-2222-2222-222222222222', 'Arjun', 'M', 'en', 4.0)
ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name;

-- Acceptor filters: both open, default daily cap (docs/04-B step 2).
INSERT INTO public.settings (user_id, paused, max_requests_per_day, notify_push)
VALUES
  ('11111111-1111-1111-1111-111111111111', false, 3, false),
  ('22222222-2222-2222-2222-222222222222', false, 3, false)
ON CONFLICT (user_id) DO NOTHING;

-- Same train 12951, same date, same class 3A, overlapping NDLS leg.
-- PNR hashes: SHA-256('seatswap-v1:<pnr>'); last4 only beside the hash.
INSERT INTO public.bookings
  (id, user_id, pnr_hash, pnr_last4, train_no, train_name, journey_date,
   from_code, to_code, class, is_chair_car, source, open_to_swap)
VALUES
  ('a0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '5863135310b54e178ee3a4dc2a54260768c9886974041131e0a86be8e8ab8a71',
   '9630', '12951', 'Mumbai Rajdhani', '2026-11-12',
   'MMCT', 'NDLS', '3A', false, 'typed', true),
  ('a0000000-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222',
   'b5a51ea6615cd5cf89f231ad49daadb0dff5fb373e85fd4be28f1f96bd8a58ed',
   '7190', '12951', 'Mumbai Rajdhani', '2026-11-12',
   'BRC', 'NDLS', '3A', false, 'typed', true)
ON CONFLICT (id) DO NOTHING;

-- One confirmed traveller per booking; berth numbers stay masked until a
-- request locks (server functions reveal them only to the two parties).
INSERT INTO public.passengers
  (id, booking_id, label, coach, berth_no, berth_type, status, quota)
VALUES
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'Passenger 1', 'B3', '27', 'UB', 'CNF', 'GN'),
  ('b0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000002',
   'Passenger 1', 'B3', '32', 'LB', 'CNF', 'GN')
ON CONFLICT (id) DO NOTHING;

-- Priya wants a lower berth (1st choice LB); Arjun's LB matches.
INSERT INTO public.swap_requests
  (id, requester_id, booking_id, passenger_ids, choices, same_coach,
   keep_together, reason, status)
VALUES
  ('c0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000001',
   ARRAY['b0000000-0000-0000-0000-000000000001']::uuid[],
   ARRAY['LB', 'MB']::berth_type[], false, false,
   'Travelling with family', 'searching')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.swap_offers
  (id, request_id, acceptor_id, acceptor_booking_id, acceptor_passenger_id,
   matched_choice_rank, status)
VALUES
  ('d0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000002',
   1, 'sent')
ON CONFLICT (id) DO NOTHING;

-- Every state change writes activity_log (here: the seeded request).
INSERT INTO public.activity_log (actor_id, actor_role, action, entity, entity_id, meta)
SELECT '11111111-1111-1111-1111-111111111111', 'user', 'request_sent',
  'swap_request', 'c0000000-0000-0000-0000-000000000001',
  '{"seed": true, "train_no": "12951"}'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

COMMIT;
