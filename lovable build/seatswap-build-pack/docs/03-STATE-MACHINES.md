# 03 — State Machines

## Swap request
```text
draft ──send (free)──> searching ──first acceptance──> accepted_awaiting_payment
  │                       │  │                              │   │
  │                       │  └─ no matches: stays searching │   └─ requester pays ─> locked
  │                       └─ withdraw ─> withdrawn           │        (other offers -> superseded)
  │                                                          └─ acceptor withdraws before payment
  │                                                               -> back to searching
locked ── both confirm "swapped" ─────────────> confirmed  (acceptor +₹50 credit)
locked ── any "no_show"/"not_possible"/"changed_mind" agreed ─> voided (requester +₹99 credit)
locked ── answers differ ──> disputed ──admin──> confirmed | voided
locked ── requester cancels ──> voided (+₹99 credit)
locked ── acceptor cancels ───> voided (+₹99 credit to requester; show other matches)
locked ── PNR cancelled / berth changed (user picks cancel) ─> voided (+₹99 credit)
searching ── journey ends ──> expired (nothing charged)
locked, no answer from one side within 12 h after arrival ─> treated as confirmed
```

## Offer
`sent → accepted | declined | expired`; when another offer on the same request gets paid, all open/accepted offers → `superseded` and those acceptors see "Someone else was faster".

## Payment
`created → pending → paid | failed`. `failed` = nothing charged (bank returns any debit in 3–5 days). Only `paid` locks the swap. Webhook is the source of truth; client polling only updates UI.

## Money outcomes table
| Situation | Requester | Acceptor | SeatSwap |
|---|---|---|---|
| Swap confirmed | paid ₹99 | +₹50 credit | keeps ₹49 |
| Not possible / no-show / changed mind | +₹99 credit | nothing | nothing |
| Requester cancels after paying | +₹99 credit | nothing | nothing |
| Acceptor cancels after payment | +₹99 credit | nothing (counts toward backing-out limit) | nothing |
| Nobody accepts | ₹0 charged | – | – |
| Payment failed at bank | ₹0 (bank auto-return) | – | – |
| Dispute | held until admin decides | held | – |

Credit used on a payment: up to the full ₹99 may be covered by credit; `provider = 'credit'` when fully covered.

## Abuse limits
- Backed out 3 times in 30 days → hidden from matches for 30 days.
- Max outgoing requests per user per day: 10. Acceptor setting `max_requests_per_day` (default 3).
- One berth can be in only one `locked` swap at a time.
