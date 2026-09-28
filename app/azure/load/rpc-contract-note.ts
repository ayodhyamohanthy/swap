// SeatSwap hot-train note: get_matches() RPC is a PROPOSAL here.
// Full function body lives in get-matches.spec-part2.sql (split for editor limits).
// Contract: get_matches(p_train text, p_date date, p_class travel_class,
// p_after uuid, p_limit int=20) returns match_cards rows in a stable order by
// booking_id (NOT newest-first — match_cards exposes no created_at, see the
// review note in part 2). Keyset pagination via p_after, which is a uuid
// because it is compared against booking_id.
// p_limit is clamped to 1..50, so "never more than 20 rows on a phone" is a
// client convention, not something the function enforces. Decide one.
export {}
