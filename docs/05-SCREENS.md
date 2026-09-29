# 05 — Screen List & Routes

Tab = which bottom tab is highlighted. "—" = no tab bar. Design page refers to `designs/NN *.jpg` (3 screens per page, left→right = a/b/c).

| # | Screen | Route | Tab | Design |
|---|---|---|---|---|
| 1 | First open (empty home) | `/` | Home | 25a |
| 2 | Choose language | `/welcome/language` | — | 10a |
| 3 | Before you start | `/welcome/note` | — | 12a |
| 4 | Home · my trips | `/` | Home | 1a |
| 5 | Add PNR | `/trips/add` | Home | 1b |
| 6 | Your berth | `/trips/$id` | Home | 1c |
| 7 | Waitlisted / RAC | `/trips/$id` | Home | 8c |
| 8 | Quota berth note | `/trips/$id` | Home | 9a |
| 9 | Chair car seat picker | `/request/new` | Swaps | 8b |
| 10 | Rank your choices | `/request/new` | Swaps | 14a |
| 11 | Matches · send free | `/request/$id/matches` | Swaps | 2a |
| 12 | Google sign-in | `/signin` | — | 3b |
| 13 | Privacy | `/welcome/privacy` | — | 11b |
| 14 | Turn on alerts | `/welcome/alerts` | — | 10c |
| 15 | Your request (manage) | `/request/$id` | Swaps | 12b |
| 16 | No reply yet | `/request/$id` | Swaps | 12c |
| 17 | You're the first | `/request/$id` | Swaps | 7b |
| 18 | Invite / share anywhere | `/share/$trainDate` | Swaps | 14b |
| 19 | Chart is out | push → `/trips/$id` | Home | 7c |
| 20 | Updates | `/updates` | Swaps | 13a |
| 21 | Arjun said yes · pay ₹99 | `/pay/$requestId` | Swaps | 3c |
| 22 | 2nd choice match | `/request/$id` | Swaps | 14c |
| 23 | Choose how to pay | `/pay/$requestId/method` | Swaps | 27a |
| 24 | Waiting for UPI | `/pay/$requestId/upi` | Swaps | 27b |
| 25 | Pay with PayPal | `/pay/$requestId/paypal` | Swaps | 28a |
| 26 | Payment pending | `/pay/$requestId/status` | Swaps | 28b |
| 27 | Payment failed | `/pay/$requestId/status` | Swaps | 28c |
| 28 | Payment successful | `/pay/$requestId/done` | Swaps | 27c |
| 29 | Someone else was faster | `/swaps/$id` | Swaps | 20a |
| 30 | Partner cancelled | `/swaps/$id` | Swaps | 25b |
| 31 | Cancel this swap? | `/swaps/$id/cancel` | Swaps | 25c |
| 32 | Swap request (acceptor) | `/incoming/$id` | Swaps | 4a |
| 33 | Accept from link (browser) | `/s/$code` | — | 8a |
| 34 | On the train now board | `/onboard/$tripId` | Home | 7a |
| 35 | Waiting for payment (acceptor) | `/incoming/$id` | Swaps | 19c |
| 36 | Chat | `/chat/$id` | Swaps | 4b |
| 37 | Cash warning | `/chat/$id` | Swaps | 11c |
| 38 | Found each other? | `/swaps/$id/meet` | Swaps | 13b |
| 39 | Swap summary (offline) | `/swaps/$id/summary` | Swaps | 9c |
| 40 | Did you swap? | `/swaps/$id/confirm` | Swaps | 4c |
| 41 | You swapped | `/swaps/$id/done` | Swaps | 2c |
| 42 | Share your trip card | `/swaps/$id/share` | Swaps | 6c |
| 43 | You earned ₹50 | `/swaps/$id/done` | Swaps | 26a |
| 44 | Share good deed | `/swaps/$id/share` | Swaps | 26b |
| 45 | Travelling again? | `/swaps/$id/done` | Swaps | 26c |
| 46 | Rating | `/swaps/$id/rate` | Swaps | 13c |
| 47 | Something went wrong | `/swaps/$id` | Swaps | 6b |
| 48 | Added to your credit | `/swaps/$id` | Swaps | 20b |
| 49 | Answers don't match | `/swaps/$id` | Swaps | 20c |
| 50 | PNR cancelled | `/trips/$id` | Home | 21a |
| 51 | Berth changed | `/trips/$id` | Home | 21b |
| 52 | Family trip | `/groups/$id` | Home | 19a |
| 53 | Seat everyone together | `/groups/$id/plan` | Home | 19b |
| 54 | Swapping for my parents / easy mode | `/profile/easy` | Profile | 10b |
| 55 | Welcome back | `/` | Home | 11a |
| 56 | Swaps list | `/swaps` | Swaps | 5b |
| 57 | Profile & credit | `/profile` | Profile | 5c |
| 58 | Payments & receipts | `/profile/payments` | Profile | 29a |
| 59 | Receipt | `/profile/payments/$id` | Profile | 29b |
| 60 | Settings | `/profile/settings` | Profile | 21c |
| 61 | Help | `/profile/help` | Profile | 22a |
| 62 | Delete account | `/profile/delete` | Profile | 22b |
| 63 | Account deleted | `/goodbye` | — | 22c |
| 64 | No internet | any | current | 29c |
| 65 | Public train page | `/train/$number` | — (web) | – |
| A1–A6 | Admin: Overview, Activity log, Users, Swaps, Payments & reports, Credits | `/admin/*` | desktop sidebar | 23, 15, 16, 17, 18, 24 |

The phone screens are drawn mobile-first (360–430 px) but **must work at every
width from 360 to 1440** — see AGENTS.md rule 12a and docs/07 §Responsive. A
screen is done only after it has been checked at 360 / 430 / 768 / 1440 with no
horizontal scroll and no clipped text. The admin screens are responsive desktop
pages.
