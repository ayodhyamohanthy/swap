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

## Monetization (demo checkout, plug keys to go live)

`js/monetize.js` → set `adsenseClient` + `razorpayKey`.

- Free: 1 swap/mo · Pay-per-swap ₹19 · Plus ₹99/mo unlimited + priority + badge · Boost ₹29 · requester-pays / helper-earns-credits (Swapr model) · ad slots + affiliates (food, hotels, eSIM).
