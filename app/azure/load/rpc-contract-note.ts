// SeatSwap hot-train note: get_matches() RPC is a PROPOSAL here.
// Full function body lives in get-matches.spec-part2.sql (split for editor limits).
// Contract: get_matches(p_train text, p_date date, p_class travel_class,
// p_after uuid, p_limit int=20) returns match_cards rows in a stable order by
// booking_id (NOT newest-first — match_cards exposes no created_at, see the
// review note in part 2). Keyset pagination via p_after, which is a uuid
// because it is compared against booking_id.
//
// Two page sizes, deliberately different things (resolved 2026-09-28, L8):
//   - p_limit is clamped to 1..50. 50 is the SERVER ceiling — the most any
//     caller can be given in one page, whatever they ask for.
//   - 20 is the PHONE CLIENT's own page size, a payload choice. The server does
//     not encode it: it cannot know the device, and a desktop caller may want
//     more. So "never more than 20 rows on a phone" is a client promise the
//     client keeps, not a guarantee this function makes.
//
// One booking with several passengers yields several rows. That is safe to
// split across pages ONLY because match_cards carries no per-booking seat
// count, so a client cannot infer anything from the rows it happens to hold.
// If seat counts are ever added for the keep-together score (docs/08 line 19),
// add them PER ROW — every row of a booking carrying the booking's full count —
// never as a client-side count of rows received.
export {}
