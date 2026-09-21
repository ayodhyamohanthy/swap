/* SwapSeat service worker — offline-first PWA.
   ---------------------------------------------------------------------------
   CACHING POLICY (see docs/PWA.md for the full policy):
     · App shell (this repo's own files) is precached, per-asset and fault
       tolerant: one missing file never aborts the whole install.
     · Navigations are cache-first so the shell opens in a tunnel; a navigation
       that is not in the cache falls back to the explicit offline document.
     · Anything on the NEVER_CACHE host list (payment SDKs, checkout, backend
       API, booking lookups) is never written to a shared cache. Private
       counter-party data must never enter the SW cache.
   Bump VERSION on every release; activation deletes every older cache. */
const VERSION = 'swapseat-v3.0.0';
const OFFLINE_URL = './offline.html';
const CORE = [
  './',
  './index.html',
  './offline.html',
  './styles.css',
  './manifest.webmanifest',
  './js/data.js',
  './js/flights.js',
  './js/seatmaps.js',
  './js/monetize.js',
  './js/payments-config.js',
  './js/payments.js',
  './js/policy.js',
  './js/booking.js',
  './js/app.js',
  './js/flow.js',
  './js/flow2.js',
  './js/accept.js',
  './js/journey.js',
  './js/states.js',
  './js/history.js',
  './js/ledger.js',
  './js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];
/* Never cached: payment providers, checkout SDKs, booking/API backends. */
const NEVER_CACHE = ['checkout.razorpay.com', 'razorpay.com', 'paypal.com', 'paypalobjects.com',
  'js.chargebee.com', 'chargebee.com', '/api/', 'booking', 'googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {
        /* Report, never abort: a single 404 must not break the install. */
        console.warn('[sw] precache miss', u);
      }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function neverCache(url) {
  return NEVER_CACHE.some((h) => url.includes(h));
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;                  // mutations: always network
  if (neverCache(request.url)) return;                   // payment/API: always network

  /* Navigations: cache-first shell, explicit offline document as last resort. */
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      const hit = await caches.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      } catch {
        return (await caches.match(OFFLINE_URL)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  /* Sub-resources: cache-first, then network, then cache fill. */
  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(OFFLINE_URL));
    })
  );
});

/* The page asks for an immediate activation when the user taps "Reload". */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
