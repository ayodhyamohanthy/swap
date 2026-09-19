# SwapSeat — Global Visual Seat-Swap PWA

See where you sleep, not just "Side Upper". Enter a **train number** → real coach + compartment map. Enter a **flight number** → real cabin map (exits, wings, lavs). Post a swap, match visually, confirm with mutual consent.

Concept synthesized from CoSeat, SeatBadlo, Swapr, XchangeSeat, GoodSeat — all code original.

## Run

No build. Any static server:

```bash
cd swap
python3 -m http.server 8099
# open http://localhost:8099
```

Install as app: Chrome/Edge → Install (service worker + manifest give offline maps).

## Try

- Trains: `12951` Rajdhani · `12002` Shatabdi · `22436` Vande Bharat · `9010` Eurostar · `170` Amtrak
- Flights: `6E2031` A320neo · `AI202` / `BA178` 787 · `EK507` 737
- Tap your berth → bay zooms into TOP/MID/FLOOR levels → tap target berths → Post → Marketplace scores by same-bay proximity.

## Layout engine

- `js/data.js` — train numbers → coach composition; flight numbers → airline + aircraft; `COACH_SPECS` (SL/3A/3E/2A/1A/CC/2S/EC/GEN) + `AIRCRAFT` (A20N/B738/A21N/B788/AT72); berth-type math.
- `js/seatmaps.js` — `renderTrainCoach` (top-view bays, doors, toilets), `renderCompartmentZoom` (side-elevation levels), `renderFlightCabin` (fuselage, exits, wings).
- Extend with live APIs: IR/UIC coach APIs → `TRAINS`; airline/aircraft APIs → `FLIGHTS`.

## Payments — Razorpay + PayPal + Chargebee

| What | Gateway | Where |
|---|---|---|
| One-time UPI/cards/netbanking (India, ₹) | **Razorpay Checkout** | `js/payments.js` → `payRazorpay()` |
| One-time global ($, buyer protection) | **PayPal Buttons** | `js/payments.js` → `renderPayPal()` |
| Recurring Plus Monthly/Yearly + invoices + cancel portal | **Chargebee hosted pages** | `js/payments.js` → `subscribeChargebee()` / `openPortal()` |

Checkout sheet (`Payments.openCheckout(kind)`) picks the gateway: Razorpay 🇮🇳 · PayPal 🌍 · Chargebee 🔁. With no keys it falls back to the mock UPI sheet so the PWA always works offline.

1. **Frontend only (test clicks):** open app → Billing → **⚙ Billing keys** → paste Razorpay Key ID / PayPal Client ID / Chargebee site+publishable key + backend URL. Stored in localStorage. Or bake into `js/payments-config.js`.
2. **Go live:** `npm i express razorpay @paypal/checkout-server-sdk chargebee && node server/example-server.js` with env `RAZORPAY_KEY_ID/SECRET`, `PAYPAL_CLIENT_ID/SECRET`, `CHARGEBEE_SITE/API_KEY`. Implements `/api/razorpay/order+verify`, `/api/paypal/capture`, `/api/chargebee/checkout+portal+webhook`.
3. Prices in `js/payments-config.js` (`single ₹19/$0.49`, `boost ₹29/$0.69`, `plusMonthly ₹99/$2.99`, `plusYearly ₹999/$29`).

## Monetization (demo checkout, plug keys to go live)

- Free: 1 swap/mo · Pay-per-swap · Plus Monthly/Yearly unlimited + priority + badge · Boost 24h · requester-pays / helper-earns-credits (Swapr model) · ad slots + affiliates (food, hotels, eSIM).
