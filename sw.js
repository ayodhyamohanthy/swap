/* SeatSwap service worker — Steps 1-2 PWA.
   NetworkFirst for pages (offline Trips + Swap summary stay readable from
   cache); CacheFirst for hashed static assets. Payment SDKs never cached.
   Kill switch: open the app with ?sw=off (index.html unregisters). Never
   registered in dev/preview/iframe (see index.html). */
const VERSION = 'seatswap-v1-steps-1-2';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './locales/en.json',
  './locales/hi.json',
  './js/seatswap-pnr.js',
  './js/seatswap-store.js',
  './js/seatswap-config.js',
  './js/seatswap-data.js',
  './js/seatswap-engine.js',
  './js/seatswap-pay.js',
  './js/seatswap-demo.js',
  './js/seatswap-auth.js',
  './js/seatswap-screens1.js',
  './js/seatswap-screens2.js',
  './js/seatswap-screens3.js',
  './js/seatswap-i18n.js',
  './js/seatswap-app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];
const NEVER_CACHE = ['checkout.razorpay.com', 'paypal.com', 'paypalobjects.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (NEVER_CACHE.some((h) => request.url.includes(h))) return;
  const url = new URL(request.url);
  if (url.pathname.indexOf('/api/') === 0) return; // live data stays network-only
  if (request.mode === 'navigate' || request.destination === 'document') {
    // NetworkFirst for pages.
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }
  // CacheFirst for static assets.
  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200) return res;
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy));
        return res;
      });
    })
  );
});
