# 02 — Data Model (Postgres)

Money = integer paise. All timestamps `timestamptz`. RLS enabled on every table with explicit GRANTs.

```sql
create type app_role as enum ('admin','support','user');
create type travel_class as enum ('1A','2A','3A','3E','SL','CC','EC','2S');
create type berth_type as enum ('LB','MB','UB','SL','SU','WINDOW','AISLE','MIDDLE_SEAT');
create type ticket_status as enum ('CNF','RAC','WL','CAN');
create type quota as enum ('GN','SS','LD','HP','TQ','PT','OTHER'); -- SS senior, LD ladies, HP disability
create type request_status as enum ('draft','searching','accepted_awaiting_payment','locked','confirmed','voided','disputed','expired','withdrawn');
create type offer_status as enum ('sent','accepted','declined','superseded','expired');
create type outcome as enum ('swapped','no_show','not_possible','changed_mind');
create type pay_provider as enum ('razorpay','paypal','credit');
create type pay_status as enum ('created','pending','paid','failed');

profiles(id uuid pk -> auth.users, first_name, last_initial, gender_optional, language, easy_mode bool,
         rating numeric, created_at)
user_roles(id, user_id -> auth.users, role app_role, unique(user_id, role))
settings(user_id pk, women_only bool, families_only bool, same_coach_only bool, paused bool,
         max_requests_per_day int default 3, notify_push bool)

bookings(id, user_id, pnr_hash text, pnr_last4 text, train_no, train_name, journey_date date,
         from_code, to_code, class travel_class, is_chair_car bool, source ('typed'|'sms_paste'),
         chart_prepared bool, created_at)           -- never store full PNR in plain text
passengers(id, booking_id, label ('Passenger 1'), coach, berth_no, berth_type, status ticket_status,
           quota quota, is_child_no_berth bool, board_code, drop_code)

group_trips(id, organiser_id, name, created_at)
group_members(group_id, booking_id)

swap_requests(id, requester_id, booking_id, passenger_ids uuid[], group_id null,
              choices berth_type[3],               -- ranked 1st/2nd/3rd
              same_coach bool, keep_together bool, reason text, status request_status,
              locked_offer_id null, created_at, updated_at)
swap_offers(id, request_id, acceptor_id, acceptor_booking_id, acceptor_passenger_id,
            matched_choice_rank int, status offer_status, created_at, responded_at)

payments(id, request_id, payer_id, provider pay_provider, provider_ref, amount_paise int,
         credit_used_paise int, currency 'INR', status pay_status, created_at)
receipts(id, payment_id, number 'SS-10482', pdf_path)

wallet_tx(id, user_id, amount_paise int, kind ('acceptor_credit'|'swap_to_credit'|'used'|'expired'|'admin_adjust'),
          ref_request_id, expires_at, created_at)  -- balance = sum(amount) where not expired

confirmations(request_id, user_id, outcome outcome, created_at, primary key(request_id,user_id))
disputes(id, request_id, status ('open'|'resolved'), resolution, admin_id, created_at)

chats(id, request_id) ; messages(id, chat_id, sender_id, text, flagged_risky bool, created_at)
reports(id, reporter_id, reported_id, request_id, reason, status ('open'|'closed'), created_at)
blocks(blocker_id, blocked_id)

notifications(id, user_id, kind, title, body, link, read_at, created_at)   -- in-app Updates list
push_subscriptions(user_id, endpoint, keys jsonb)

activity_log(id, actor_id, actor_role, action text, entity text, entity_id uuid,
             meta jsonb, created_at)                -- EVERY state change writes here
```

## Visibility rules (enforce in RLS + server functions)
- Other users' PNR, names beyond first name + initial, phone, email: never readable.
- `passengers.berth_no` of the other party readable only when the request is `locked` or later.
- `activity_log`, `reports`, `disputes`: admin/support only (via `has_role`).
- Users read only their own wallet_tx, payments, receipts, notifications.
