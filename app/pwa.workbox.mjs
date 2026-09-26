/* SeatSwap service-worker options (docs/08-PWA-AND-TECH.md).
 *
 * One source of truth, used twice:
 *   1. vite.config.ts  -> passed to vite-plugin-pwa (manifest, icons, dev tooling).
 *   2. scripts/postbuild.mjs -> the worker file itself, generated with
 *      workbox-build's `generateSW`.
 *
 * Why the worker is generated in postbuild: TanStack Start builds three Vite
 * environments (dist, dist/client, dist/server) in one run. vite-plugin-pwa
 * caches the *last* resolved config, so its client `closeBundle` sees
 * `build.ssr === true` and skips the worker. Generating it after `vite build`
 * also means the prerendered SPA shell (dist/client/index.html) is already on
 * disk and lands in the precache manifest with a real revision hash.
 */

export const swFilename = 'sw.js'

/** Cache names — keep in sync with docs/08. */
export const cacheNames = {
  pages: 'seatswap-pages',
  assets: 'seatswap-assets',
  fonts: 'seatswap-fonts',
}

export const workboxOptions = {
  /* Hashed build output + icons + manifest are precached. Fonts are NOT
     precached (they are ~130 KB of woff2 and get cached on first use by the
     fonts rule below) so the first install stays fast on a slow connection. */
  globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,json}'],
  globIgnores: ['**/sw.js', '**/*.map'],
  dontCacheBustURLsMatching: /^assets\//,
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  inlineWorkboxRuntime: true,
  sourcemap: false,
  offlineGoogleAnalytics: false,
  navigateFallback: '/index.html',
  // Deep links are the app shell; live endpoints are never served from cache.
  navigateFallbackDenylist: [/\/api\//, /\/_serverFn\//, /\/assets\//],
  runtimeCaching: [
    {
      /* Pages: NetworkFirst keeps content fresh, the precached shell answers
         when the phone is offline or the network is slow (docs/08). */
      urlPattern: /^https?:\/\/[^/]+\/(?:[?#]|$|(?:trips|swaps|profile|welcome|signin|pay|chat)(?:[/?#]|$))/,
      handler: 'NetworkFirst',
      options: {
        cacheName: cacheNames.pages,
        networkTimeoutSeconds: 4,
        precacheFallback: { fallbackURL: '/index.html' },
        expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 60 },
      },
    },
    {
      /* Any hashed asset the precache manifest missed (e.g. a later deploy). */
      urlPattern: /\/assets\/[^/]+\.(?:js|css)(?:\?.*)?$/,
      handler: 'CacheFirst',
      options: {
        cacheName: cacheNames.assets,
        expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 },
      },
    },
    {
      /* Self-hosted fonts: Hindi (Noto Sans Devanagari) + Latin. */
      urlPattern: /\/assets\/[^/]+\.(?:woff2?|ttf)(?:\?.*)?$/,
      handler: 'CacheFirst',
      options: {
        cacheName: cacheNames.fonts,
        expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
      },
    },
    {
      /* Payments are never cached, and never served offline. */
      urlPattern: /^https:\/\/(?:[a-z0-9-]+\.)*(?:razorpay\.com|paypal\.com|paypalobjects\.com)\//,
      handler: 'NetworkOnly',
    },
    {
      /* Live data (steps 3+: matches, payments, webhooks). */
      urlPattern: /\/(?:api|_serverFn)\//,
      handler: 'NetworkOnly',
    },
  ],
}
