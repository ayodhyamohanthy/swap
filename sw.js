/* SwapSeat service worker — offline-first PWA (payment SDKs stay network-only) */
const VERSION = 'swapseat-v1.3.0';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './js/data.js',
  './js/flights.js',
  './js/seatmaps.js',
  './js/monetize.js',
  './js/payments-config.js',
  './js/payments.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];
const NEVER_CACHE = ['checkout.razorpay.com', 'paypal.com', 'paypalobjects.com', 'js.chargebee.com', 'chargebee.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (NEVER_CACHE.some(h => request.url.includes(h))) return; // payment SDKs: always network
  e.respondWith(
    caches.match(request, { ignoreSearch: false }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy));
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
