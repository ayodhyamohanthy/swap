# 17 — Mobile-First Contract

SeatSwap is used on a phone, on a train, on flaky 4G. Every screen is
built for that reality first; desktop is the enhancement. /designs is
the visual truth; this file is the engineering truth.

## Baseline device (build for this, then enhance up)
- Viewport 360×640, mid-range Android, 4G with dead zones.
- Breakpoints: base = mobile (no prefix), then sm:/md:/lg: to enhance.
  If a Tailwind class for desktop appears WITHOUT a mobile base style,
  that's a bug.

## Layout & touch
- Touch targets ≥ 44×44px (buttons, list rows, tab items).
- Primary actions live in the thumb zone (bottom half). Persistent
  bottom nav for top-level sections; top-right for secondary actions.
- No hover-only affordances. Every hover state has a visible
  non-hover equivalent; use :active feedback (0–150ms, per docs/07).
- Safe areas: <meta name="viewport" content="width=device-width,
  initial-scale=1, viewport-fit=cover"> and pad fixed bars with
  env(safe-area-inset-bottom/top).
- One-handed reach test: core flow (find trip → request swap → pay)
  must be completable with a right thumb only.

## Forms (swap requests, PNR entry, payment)
- Font size in inputs ≥ 16px (prevents iOS zoom-jump).
- Correct inputmode/autocomplete on every field: inputmode="numeric"
  for PNR/last4, autocomplete where applicable.
- The focused input must never be hidden behind the keyboard; scroll
  it into view on focus.

## PWA install & offline
- Manifest: name, short_name, theme_color, background_color, icons
  192 + 512 including maskable variants, display: standalone,
  start_url with a source tag for analytics.
- Offline: app shell + last-viewed trips cached (vite-plugin-pwa
  workbox). A request made offline queues and syncs on reconnect —
  never silently lost.
- Custom install prompt shown after first successful action, not on
  landing (browsers punish premature prompts).

## Performance budget (CI-enforceable)
- Initial JS ≤ 200KB gzipped; route-level code splitting mandatory.
- LCP < 2.5s on 4G mid-range; interaction latency < 200ms.
- Images: explicit width/height (no layout shift), lazy-load below
  the fold.
- Fonts already self-hosted via @fontsource — never add a Google
  Fonts network request.

## Test matrix (every UI PR)
- 360px (baseline), 390px (modern phone), 768px (tablet), 1024px+.
- Lighthouse mobile: PWA installable = pass, performance ≥ 85.
- Real-device sanity for payment + auth flows before marking a
  payments task done (WebView quirks in Razorpay checkout).

## Native app later (already provisioned)
- Play Store: TWA via PWABuilder — needs the real domain (Student
  Pack), maskable icons, offline = all covered above. $25 one-time.
- iOS: installed-PWA push is supported by iOS Safari; defer the $99/yr
  developer account until revenue exists.
- If truly native is ever needed, Capacitor wraps this same codebase.
  Do not architect for it now.



