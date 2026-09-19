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
- Tap your berth → the bay opens as a **cross-section** (TOP/MID/FLOOR rows × two facing benches + corridor side) → tap target berths → Post → Marketplace scores by same-bay proximity.

## Layout engine

- `js/data.js` — train numbers → coach composition; flight numbers → airline + aircraft; `COACH_SPECS` (SL/3A/3E/2A/1A/CC/2S/EC + global) + `AIRCRAFT` (15 types, 55 flights); berth-type math; **confidence vocabulary** (`verified` / `expected` / `illustrative`).
- `js/flights.js` — display meta (`seatDisplay`, `chairSeatInfo`, `flightSeatMeta`) and peer-state scoring helpers.
- `js/seatmaps.js` — `renderTrainCoach` (top-view bays, doors, toilets), `renderCompartmentZoom` (level lists), `renderBerthElevation` (true cross-section), `renderFlightCabin` (fuselage, exits, wings), `trainConfBadge` / `flightConfBadge` (source + version + last-checked), `stateLegendHTML` (icon + text, `unknown` spelled out).
- Extend with live APIs: IR/UIC coach APIs → `TRAINS`; airline/aircraft APIs → `FLIGHTS`.
- IR geometry cross-checked berth-by-berth against etrain.info's coach diagrams: SL 72, 3A 64, 2A 46 (end bay LB/UB/SL/SU), 1A 22, CC 73 (3+2), EC 46 (pantry end), 3E 83 (no side-middle), Garib Rath 81 (side-middle). Where etrain serves duplicate placeholders (all LHB/composite variants), templates follow documented LHB capacities instead.

## Tests

```bash
node tests/geometry.test.js   # data layer: templates, positions, gains, seeds
node tests/e2e-smoke.js       # browser: service isolation, preview, lifecycle, offline
node tests/e2e-flows.js       # browser: invites, watchlist, reports+admin, funnel
```
Critical gates: different dates never cross-match · expired requests can't be accepted · maps never invent seats (seeds resolve through geometry or are dropped).

## Honesty rules (product contract)

- Matching is per service instance (mode + number + date + segment) or nothing.
- Agreement in-app is coordination, never a reassignment — crew decides.
- Confidence on every map: Verified / Expected / Illustrative. Unknown seats render as unknown, never as free.
- Free forever: maps, listings, requests, accepts, chat. Paid: trip pass (groups), boost (highlight, no guarantees, unused credit refunded), Plus (unlimited listings, saved prefs, alerts).

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

## Monetization (honest freemium)

- Free forever: maps, listings (5 active), requests, accepts, chat. Paid: trip pass (group listings), boost (24h highlight, no match guarantee, credit refund), Plus/Plus Yearly (unlimited listings, saved household prefs, alerts). No seat selling, no paywalled responses.
