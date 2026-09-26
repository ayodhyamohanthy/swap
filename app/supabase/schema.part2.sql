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
