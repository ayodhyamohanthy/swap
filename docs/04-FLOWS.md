# 04 — User Flows with If/Else Rules

## A. Requester
1. **First open** → "Where's your train taking you?" PNR box, "Paste from IRCTC SMS", line "Earn ₹50 credit every time you help someone swap". No sign-in.
2. **Language** (first open only) → English / हिन्दी / more.
3. **Before you start** (once): convenience app · swap only if both agree · keep your original ticket and ID.
4. **Add PNR** → parse → **Your berth** card (coach, berth type, "3 people on this train want to swap").
   - PNR invalid → "Check the 10 digits" + retry.
   - WL/RAC → show ticket, "Swaps open once your berth is confirmed", notify on confirm.
   - CAN → "This ticket is cancelled", cannot swap.
   - Quota berth (SS/LD/HP) → soft note: "This berth was given for a reason; it's only offered to people who qualify."
   - Child without berth → counted in group, never offered.
   - Chair car (CC/EC/2S) → use seat words: Window / Aisle / Middle, facing direction.
5. **What would you like?** Rank 1st/2nd/3rd choice, same coach toggle, keep group together, reason chips.
6. **Matches** → same train, same date, same class, overlapping journey, offers a berth in the choices. Berth shown as "Berth ••". Tick many → "Send to N · free".
   - 0 matches → **You're the first on this train** → share coach link (all platforms).
7. **Google sign-in** (first send only) → **Privacy** consent (alerts unticked) → **Turn on alerts** (Not now allowed).
8. **Your request** (manage): edit, pause, withdraw. No reply → "Share" / "Try another berth type".
9. **Someone says yes** (push + Updates) → **Pay ₹99** screen: breakdown ₹49 + ₹50, credit line only if balance > 0, "No swap? ₹99 goes to your credit".
   - 2nd-choice acceptance → "You got your 2nd choice" · Accept this / Keep waiting (1st choice stays open until paid).
   - Two accept at once → first to be paid for wins; others see "Someone else was faster".
10. **Choose how to pay**: Razorpay (GPay, PhonePe, Paytm, UPI ID, card, net banking) or "International traveller? Pay with PayPal".
    - UPI waiting → approve in app. Pending → "Please don't pay again", Check status. Failed → "No money was taken", Try again / Pay another way.
11. **Payment successful** → receipt → berth numbers revealed → chat opens.
12. **On board**: chat (quick replies "I'm at my berth now", "Meet me near the coach door"), cash-word warning + Report & block, **Found each other?** ("I've met Arjun" / "Can't find them"), **Swap summary** (works offline).
13. **Did you swap?** Yes / Other person didn't come / Swap wasn't possible / We changed our mind.
14. **After**: "You swapped" → share card → rating → add another trip.
    - Went wrong → ₹99 to credit (valid 12 months). Answers differ → held, reply as soon as we can.
15. **Changes**: PNR cancelled → ₹99 to credit. Berth changed after chart → Keep swap / Cancel · move to credit.

## B. Acceptor
1. Adds PNR → "I'm open to swap" (no reward for this).
2. Filters (Settings): women only, families only, same coach, pause, max per day.
3. Request arrives (push / Updates / WhatsApp link / on-board board): shows "You give Lower · you get Upper", first name, reason, "Earn ₹50 credit · you pay nothing". Accept / Decline.
   - From link without app → browser page, Google sign-in, accept.
4. **Waiting for payment**: "Priya pays ₹99. You pay nothing." Can back out until paid.
   - Someone else was faster → friendly message, stay open.
5. After payment → berth revealed, chat, Found each other, Swap summary, Did you swap?
6. Confirmed → **You earned ₹50** → share good deed → rating → "Travelling again? Add PNR".
7. Can back out any time before physically moving; counts toward the limit after payment.

## C. Organiser / family
Link PNRs → see everyone on one coach map → "Seat everyone together" → plan finds swaps → partial result "3 of 4 together" → pay ₹199 once (up to 3 swaps). "Swapping for my parents": organiser handles chat; parents get the Swap summary link.

## D. Admin
Overview (today's PNRs, requests, paid, confirmed, credit issued, busiest trains) → Activity log (every action by every user; filter by action, search by user/PNR last4/train, export CSV) → Users (search, reported/blocked, history, block) → Swaps (by status, timeline, Move to credit, Mark done, resolve dispute) → Payments (Razorpay/PayPal, paid/failed, moved to credit) → Credits (issued, used, expiring, manual adjust with reason) → Reports (review, close, block). Every admin action is itself logged.

## Notifications (web push + in-app Updates)
someone accepted · payment done · chart is out · new request (acceptor) · partner arrived message · did you swap? (after arrival) · credit added · credit expiring in 30 days · request expired.
