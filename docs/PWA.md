# SwapSeat PWA — mobile-first behaviour, storage schema, deployment, rollback

This document is the operational reference for the installable PWA layer. It
covers: the local storage schema, the service-worker caching policy and its
never-cache list, environment variables, how to run locally, how to deploy, and
how to roll back a bad release (including purging stale service-worker caches).

Audience: whoever ships SwapSeat next. Everything here is verifiable from the
repository without credentials.

---

## 1. Running locally

No build step. Any static server works; the documented one is:

```bash
cd <repository root>   # the folder containing index.html
python3 -m http.server 8099
# open http://localhost:8099/index.html
```

* The default surface is the **mobile-first flow** (`#flow`). `?legacy=1` opens
  the classic map/marketplace desk for power users and for the existing browser
  test suites.
* `?screen=history` deep-links straight to the local ledger.

### Full validation

```bash
tests/run-all.sh          # geometry + PWA + ledger + all three browser suites
```

Individual suites (a static server must already be on :8099):

```bash
node tests/geometry.test.js     # data layer, no server needed
node tests/pwa.test.js          # PWA layer: precache, manifest, icons, docs
node tests/ledger.test.js       # ledger schema + migration + erase
PLAYWRIGHT_CORE="$HOME/node_modules/playwright-core" \
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
BASE="http://localhost:8099/index.html?legacy=1" \
node tests/e2e-smoke.js         # also e2e-flows.js, e2e-v2.js
```

> **Known pre-existing defect (documented divergence).** The three browser
> suites drive the *classic* engine (`#lookupBtn`, `#seatmap`, `#swapList`,
> `#postBtn`). Now that the mobile flow is the default surface, they time out on
> hidden elements unless they are pointed at `?legacy=1`. This is true of the
> repository before this change as well. `tests/run-all.sh` sets the flag for
> you, so the documented commands work as written. `tests/e2e-v2.js` also had
> two ambiguous `.mode-tabs` selectors that matched both shells; they are now
> scoped to `#classicShell` (assertions unchanged).

---

## 2. Local storage schema

Everything is per-origin, on the device, and never uploaded.

### 2.1 The swap ledger (the reviewable record)

| Key | Contents |
|---|---|
| `swapseat_ledger_meta` | `{"schemaVersion":1,"updatedAt":"<ISO>","migratedFrom":0}` |
| `swapseat_ledger_v1` | array of records, newest first, capped at 200 |

`SCHEMA_VERSION = 1` is declared in `js/ledger.js` and the data key is derived
from it (`'swapseat_ledger_v' + SCHEMA_VERSION`), so a future schema bump writes
to a new key and the migration path can read the old one.

Record fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `lg-…` local identifier |
| `createdAt` | ISO-8601 string | when the attempt was first recorded |
| `updatedAt` | ISO-8601 string | last state change |
| `mode` | `train` \| `bus` \| `flight` | transport mode |
| `serviceNumber` | string | train/flight number or bus service |
| `travelDate` | `YYYY-MM-DD` | travel date of the service instance |
| `coachOrCabin` | string | coach / cabin / deck |
| `ownSeat` | string | the seat the traveller is swapping from |
| `targetSeat` | string | the seat requested, or `your seat` when receiving |
| `status` | `draft` \| `pending` \| `accepted` \| `declined` \| `expired` \| `failed` | lifecycle state |
| `failureReason` | string | populated only for `failed` |
| `quoteSummary` | string | e.g. `search ₹49`, `option A · no additional fee` |
| `sourceId` | string \| null | originating request/listing id, used for idempotent upserts |

**Migration.** Records written by earlier releases carried no schema version.
`SwapLedger.syncFromLegacy()` reads `swapseat_reqs` and `swapseat_swaps` and
maps them into v1 records (`requested→pending`, `accepted→accepted`,
`declined→declined`, `expired→expired`, `cancelled→failed`, listings→`draft`).
It runs when the History screen opens and is idempotent (dedupe by `sourceId`).

**Reviewing and erasing.** The History screen (`Profile → History`, or the
`History & saved swaps` button on My Trips) shows timestamp, service, seats and
status, lets a `pending`/`draft`/`failed` entry be re-opened or retried, copies a
row, exports the whole ledger as JSON, and offers **Erase all local data**.

### 2.2 Other keys

| Key | Purpose |
|---|---|
| `swapseat_current` | the traveller's own journey (masked reference only) |
| `swapseat_bookings`, `swapseat_claims`, `swapseat_prefs`, `swapseat_ratings`, `swapseat_incoming` | booking/provider state |
| `swapseat_swaps`, `swapseat_reqs`, `swapseat_watches`, `swapseat_blocks`, `swapseat_layout_reports` | listings, requests, watchlist, moderation |
| `swapseat_wallet`, `swapseat_txns`, `swapseat_paycfg`, `swapseat_searches` | credits, transactions, gateway config |
| `swapseat_metrics` | local funnel counters |
| `swapseat_thread_<threadId>` | per-journey chat thread |
| `swapseat_draft_v1` | in-progress form draft (see below) |
| `swapseat_last_sync` | ISO timestamp of the last confirmed network sync |
| `swapseat_ios_hint` | session flag: the iOS add-to-home-screen hint was shown |

**Privacy rules enforced by `js/ledger.js` and `js/pwa.js`:**

* The raw PNR is never persisted (only a masked reference + salted hash).
* The form draft **never** stores fields whose id matches
  `pnr|surname|email|phone|name|passenger|paycfg`.
* Payment/booking/gateway configuration is never placed in a service-worker
  cache.
* `SwapLedger.onAccountSwitch()` (used by `Sign out & erase local data`) removes
  the ledger, the draft, the chat threads, the wallet, preferences, claims and
  the saved journey. This is what protects a shared device.

---

## 3. Service worker: caching policy

`sw.js` is versioned (`VERSION = 'swapseat-v3.0.0'`). **Bump this string on every
release** — activation deletes every cache whose name differs.

| Request kind | Strategy |
|---|---|
| Precache (`install`) | per-asset `cache.add()` with a catch: one missing file logs a warning and the install still completes (it is **not** atomic) |
| Navigation (`request.mode === 'navigate'`) | cache-first; network fills the cache on a miss; if the network fails, serve `./offline.html`, then `index.html` as a last resort |
| Same-origin sub-resources (CSS/JS/icons) | cache-first, then network, then cache fill |
| `NEVER_CACHE` hosts | passed straight through — never written to any cache |
| Non-GET | never intercepted |

`NEVER_CACHE` (in `sw.js`): `checkout.razorpay.com`, `razorpay.com`,
`paypal.com`, `paypalobjects.com`, `js.chargebee.com`, `chargebee.com`, `/api/`,
`booking`, `googleapis.com`.

Update flow: an installed worker triggers a non-blocking **“Update ready —
reload”** bar (announced via `aria-live`); tapping it posts `SKIP_WAITING` and
reloads once on `controllerchange`. The page also re-checks for a new release
every 10 minutes.

`offline.html` is a standalone document with no remote assets: it states that the
user is offline, lists what still works and what is paused, shows the
last-updated timestamp from `swapseat_last_sync`, and offers **Retry now** plus a
link to the local history.

---

## 4. Environment variables

**None are required.** The app ships in mock/offline mode: maps come from
`js/data.js`, payments fall back to the demo sheet, and everything runs from a
plain static server with no backend.

Optional, only for live payments (`server/example-server.js`, never in the
client bundle):

| Variable | Used by |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `/api/razorpay/order`, `/api/razorpay/verify` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | `/api/paypal/capture` |
| `CHARGEBEE_SITE`, `CHARGEBEE_API_KEY` | `/api/chargebee/checkout`, `/portal`, `/webhook` |

Client-side (dev convenience only, stored in `localStorage` under
`swapseat_paycfg` or baked into `js/payments-config.js`): Razorpay Key ID,
PayPal Client ID, Chargebee site + publishable key, and the backend base URL.

Any real PNR/booking provider is a **server-side** integration; the client never
holds an operator credential.

---

## 5. Deploying

It is a static bundle — no build, no server runtime required.

1. Publish the repository root (the folder containing `index.html`) to any static
   host: GitHub Pages, Netlify, Cloudflare Pages, S3+CDN, or `nginx`.
2. Serve over **HTTPS** (service workers and install prompts require a secure
   context; `localhost` is exempt).
3. Ensure `manifest.webmanifest`, `sw.js`, `offline.html` and `icons/` are served
   with their real content types; do not rewrite unknown paths to an error page.
4. Do **not** set long `Cache-Control` on `sw.js` or `index.html` (`no-cache` or a
   short max-age): a cached worker is what prevents users from receiving updates.
   Hashed/immutable caching is fine for `icons/`.
5. After deploy: load the site, confirm the console shows no errors, and check
   `chrome://serviceworker-internals` (or DevTools → Application → Service
   Workers) that `swapseat-v3.0.0` is active and `index.html`, `offline.html` and
   the JS modules are in the cache.

---

## 6. Rollback

1. **Revert the release** — `git revert` the merge commit on the branch, or
   re-point the host at the previous artifact.
2. **Bump `VERSION` in `sw.js`.** This is the step people forget: users who
   already installed the bad worker will keep serving it from cache until the
   version string changes, because activation only deletes caches whose name
   differs. Reverting the files without bumping `VERSION` leaves them stuck.
3. Push and redeploy. The next navigation fetches the new `sw.js`, installs it,
   and shows the “Update ready — reload” bar.
4. **Force an immediate purge** (only if users are blocked):
   ```js
   // run once in DevTools on the affected device
   const rs = await navigator.serviceWorker.getRegistrations();
   await Promise.all(rs.map(r => r.unregister()));
   const ks = await caches.keys();
   await Promise.all(ks.map(k => caches.delete(k)));
   location.reload();
   ```
5. Re-verify with `tests/run-all.sh` and a Lighthouse mobile run on the
   production URL before announcing the fix.

---

## 7. Mobile-first acceptance checklist

* No horizontal overflow at **320 px**: wide seat rows scroll inside
  `.seatgrid` / `.fuselage` rather than widening the page.
* Interactive controls are **≥ 44 × 44 CSS px**; body copy ≥ 14 px; inputs 16 px
  so mobile browsers do not zoom.
* `env(safe-area-inset-*)` padding on the flow header and bottom tab bar.
* Focus moves to the new screen on every route change and the screen title is
  announced through `#flowLive`.
* Offline is stated, never simulated: `#offlineBar` shows the last successful
  sync, and an offline acceptance/payment is refused rather than queued.
* Install path: `beforeinstallprompt` → in-app install button; iOS Safari gets an
  add-to-home-screen hint because it never fires that event.
PWEOF
wc -l docs/PWA.md && node tests/pwa.test.js 2>&1 | tail -6