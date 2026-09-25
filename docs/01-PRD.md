# 01 — Product Requirements (PRD)

## Problem
Indian train passengers often get berths that don't suit them: families split across coaches, elders on upper berths, groups scattered. Today they ask strangers on board, awkwardly and with no way to find who wants to swap. SeatSwap finds the right person on the same train in advance or on board.

## Users
| Role | Who | Goal |
|---|---|---|
| Requester | Passenger wanting a better berth (family, elder, medical, group) | Find a willing person fast; pay only if someone says yes |
| Acceptor | Passenger open to swapping | Help someone, earn ₹50 credit, stay safe |
| Organiser | One person managing a family/wedding/pilgrim group | Seat everyone together |
| Admin | SeatSwap team (1 person at launch) | See every action, fix problems, move money to credit |

## Core value
"Tell us what berth you want. We find people on your train who want to swap. You pay ₹99 only when someone says yes."

## Scope v1
- All Indian trains, all classes (1A, 2A, 3A, 3E, SL, CC, EC, 2S).
- Add PNR (type or paste IRCTC booking SMS; parse locally). Automatic PNR lookup is a later phase.
- Multiple PNRs per user; multiple passengers per PNR; passengers in different coaches.
- Family/group trips: link PNRs; organiser pays; partial results ("3 of 4 together"). Group price ₹199 covers up to 3 swaps.
- Ranked preferences: 1st, 2nd, 3rd choice of berth type.
- Send to many matches for free; first to accept wins; requester pays to lock.
- Before-chart and on-board swaps (live coach board until your stop).
- Chat inside the app (text + quick replies; no attachments, no calls).
- Both-sides confirmation "Did you swap?".
- Credit wallet, receipts, payment history.
- Sharing: WhatsApp, Instagram, Facebook, Telegram, SMS, Copy link, QR.
- Public train pages (berth layout) for search traffic.
- Admin console: activity log, users, swaps, payments, credits, reports, overview.
- Languages: English + Hindi translated at launch; i18n ready for all 22.
- Easy mode (bigger text, one button), "Swapping for my parents".

## Out of scope v1
Buses, flights, trains outside India, cash payouts, phone OTP, masked calls, SMS alerts, automatic PNR lookup, legal/grievance pages.

## Success metrics (track from day 1)
PNRs added · requests sent · acceptances · paid swaps · confirmed swaps · "you're the first on this train" rate · shares per swap · repeat trips · credit redeemed.

## Growth loops (must ship in v1)
1. **Never a dead end:** zero matches → "You're the first on this train" + share coach link.
2. **Accept from a link:** a shared link opens in the browser; recipient signs in with Google and accepts without installing.
3. **Coach board link** for WhatsApp groups (train + date).
4. **Chart-is-out push:** "Chart's out. 4 people in your coach want to swap."
5. **Share cards** after a swap (no private details) for status/stories.
6. **Acceptor nudge:** "You earned ₹50. Family travelling soon? Add their PNR."
7. **Welcome back** screen leading with waiting credit.
8. **Free berth check** by PNR (useful even without swapping).
