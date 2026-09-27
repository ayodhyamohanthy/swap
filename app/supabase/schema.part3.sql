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
  request_id uuid REFERENCES public.swap_requests (id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.group_trips (id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS payments_group_idx ON public.payments (group_id);
-- A payment targets exactly one thing: a single swap request, or one group
-- trip (docs/01: ₹199 covers up to 3 swaps). Payer-only RLS below is
-- target-agnostic, so group payments inherit the same self-only reads.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_target;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_target CHECK (
    (request_id IS NULL) != (group_id IS NULL)
  );

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
