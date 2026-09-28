// SeatSwap hot-train note: get_matches() RPC is a PROPOSAL here.
// Full function body lives in get-matches.spec-part2.sql (split for editor limits).
// Contract: get_matches(p_train text, p_date date, p_class travel_class,
// p_after timestamptz, p_limit int=20) returns match_cards rows newest-first.
// Phone never gets >20 rows; keyset pagination via p_after.
export {}
