-- SeatSwap schema — Build Plan Steps 1-2 (Foundation + Trips).
-- Supabase-compatible Postgres. Money = integer paise (₹99 = 9900).
-- Every table: RLS on, explicit GRANTs. Roles via user_roles + has_role().
-- Later steps add: swap_requests, swap_offers, payments, wallet_tx,
-- confirmations, disputes, chats/messages, reports/blocks, notifications.

-- Roles ---------------------------------------------------------------
create type app_role as enum ('admin', 'support', 'user');
create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);
alter table user_roles enable row level security;
create function has_role(uid uuid, want app_role)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = uid and role = want);
$$;
grant execute on function has_role(uuid, app_role) to authenticated;

-- Profiles (Google sign-in only; created on first sign-in, Step 3) -----
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_initial text not null default '',
  language text not null default 'en',
  easy_mode boolean not null default false,
  rating numeric,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
grant select, insert, update on profiles to authenticated;

-- Reference enums -----------------------------------------------------
create type travel_class as enum ('1A','2A','3A','3E','SL','CC','EC','2S');
create type berth_type as enum ('LB','MB','UB','SL','SU','WINDOW','AISLE','MIDDLE_SEAT');
create type ticket_status as enum ('CNF','RAC','WL','CAN');
create type quota as enum ('GN','SS','LD','HP','TQ','PT','OTHER');

-- Trips ---------------------------------------------------------------
create table bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null, -- null = pre-sign-in local trip
  pnr_hash text not null,          -- SHA-256 + salt; never store full PNR
  pnr_last4 text not null,
  train_no text not null,
  train_name text not null default '',
  journey_date date,
  from_code text not null default '',
  to_code text not null default '',
  class travel_class not null,
  is_chair_car boolean not null default false,
  source text not null default 'typed', -- typed | sms_paste
  chart_prepared boolean not null default false,
  created_at timestamptz not null default now()
);
alter table bookings enable row level security;
grant select, insert, update, delete on bookings to authenticated;

create table passengers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  label text not null default 'Passenger 1',
  coach text,
  berth_no text,
  berth_type berth_type not null default 'LB',
  status ticket_status not null default 'CNF',
  quota quota not null default 'GN',
  is_child_no_berth boolean not null default false, -- counted in group, never offered
  board_code text,
  drop_code text
);
alter table passengers enable row level security;
grant select, insert, update, delete on passengers to authenticated;

-- Activity log: EVERY state change writes a row (server functions) ----
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text not null default 'user',
  action text not null,
  entity text,
  entity_id uuid,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table activity_log enable row level security;
-- users: no direct reads; admins/support read via has_role() policies (Step 12).
grant insert on activity_log to authenticated;
