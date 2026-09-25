# 08 — PWA, Tech & Operations

## PWA
- `manifest.webmanifest`: name "SeatSwap", short_name "SeatSwap", display standalone, theme #1F6B45, background #FAF6EE, icons 192/512 + maskable.
- Offline: `vite-plugin-pwa` generateSW; NetworkFirst for pages; CacheFirst for hashed assets. Cache "My trips" and every "Swap summary" for offline viewing. Queue chat messages while offline and send when back online.
- Never register the service worker in dev/preview/iframe; support `?sw=off` kill switch.
- Install prompt: gentle card after first successful PNR add ("Add SeatSwap to your home screen").

## Push
Web Push (VAPID) — free. Fallback: in-app Updates list + badge on Swaps tab. Ask permission only after the user sends or accepts a first request.

## Auth
Google OAuth only. On first sign-in create `profiles` row with first name + last initial. Anonymous (pre-sign-in) PNRs stored locally and attached to the account after sign-in.

## PNR input
Type 10 digits or paste the IRCTC booking SMS; parse train no, date, class, coach, berth, status on the client with regex. Store only `pnr_hash` (SHA-256 + salt) and last 4 digits. Automatic PNR lookup via a licensed data provider is a later phase.

## Matching (server)
Candidates = same train_no + journey_date + class, overlapping from/to segments, status CNF, not blocked, acceptor not paused and within their daily limit, filters (women only / families only / same coach) respected, berth type in requester's choices. Score: choice rank (1st 50, 2nd 35, 3rd 20) + same coach 10 + keep-together fit 10 + acceptor rating 0–10. Quota berths shown only to people who qualify.

## Safety
Risky-message detector (cash, UPI IDs, phone numbers, "pay me", "sell") → warn both sides, hide the number, offer Report & block. Rate limits on requests and messages.

## Admin & logs
`/admin` guarded by `has_role(auth.uid(),'admin')` on the server. Activity log captures: sign_in, pnr_added, request_sent, offer_accepted, offer_declined, payment_created/paid/failed, swap_locked, message_flagged, confirmation, dispute_opened/resolved, credit_added/used/expired, report_created, user_blocked, admin_action. CSV export.

## Scheduled jobs
- Expire requests after journey end.
- Auto-confirm locked swaps 12 h after arrival if one side didn't answer.
- Credit expiry (daily) + reminder 30 days before.
- Chart-time notifications (when chart status flips).

## Analytics events
Same names as activity_log actions + share_clicked(platform), install_prompt_accepted, first_screen_viewed.
